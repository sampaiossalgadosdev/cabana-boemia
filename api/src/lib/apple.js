import { createHash, createPublicKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ErroHttp } from './erros.js';

/**
 * "Entrar com Apple" (app iOS). O app recebe da Apple um identity token (JWT
 * RS256) e manda para POST /cliente/auth/apple; aqui ele é conferido com as
 * chaves públicas da Apple (JWKS), emissor, validade, `aud` = bundle id do app
 * e o nonce (contra reaproveitamento do token).
 */
export const EMISSOR_APPLE = 'https://appleid.apple.com';
const URL_CHAVES = 'https://appleid.apple.com/auth/keys';
const URL_TOKEN = 'https://appleid.apple.com/auth/token';
const URL_REVOGAR = 'https://appleid.apple.com/auth/revoke';
const CACHE_CHAVES_MS = 60 * 60 * 1000;

/** Bundle id do app (público). APPLE_BUNDLE_IDS sobrescreve (lista separada por vírgula). */
export const BUNDLE_ID_PADRAO = 'br.com.taaki.app';

/** @returns {string[]} */
export function audiencesApple(env = process.env) {
  const lista = (env.APPLE_BUNDLE_IDS || BUNDLE_ID_PADRAO)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(lista)];
}

export const hashNonce = (bruto) => createHash('sha256').update(String(bruto)).digest('hex');

const tokenInvalido = () =>
  new ErroHttp(401, 'Login com Apple inválido. Tente entrar de novo.', { codigo: 'TOKEN_APPLE_INVALIDO' });

/**
 * @param {{ audiences?: string[], obterChaves?: () => Promise<{ keys: object[] }> }} [opcoes]
 *   `obterChaves` é injetável (testes assinam com chave própria, sem rede).
 * @returns {(identityToken: string, opcoes?: { nonce?: string }) => Promise<{ appleId: string, email: string | null }>}
 */
export function criarVerificadorApple({ audiences = audiencesApple(), obterChaves } = {}) {
  const buscar = obterChaves ?? (async () => (await fetch(URL_CHAVES)).json());
  let cache = null; // { em, porKid: Map }

  async function chave(kid) {
    const vencido = !cache || Date.now() - cache.em > CACHE_CHAVES_MS;
    if (vencido || !cache.porKid.has(kid)) {
      // kid desconhecido: a Apple pode ter girado as chaves; busca de novo.
      let jwks;
      try {
        jwks = await buscar();
      } catch {
        throw new ErroHttp(503, 'Não foi possível falar com a Apple. Tente de novo.', { codigo: 'APPLE_INDISPONIVEL' });
      }
      cache = { em: Date.now(), porKid: new Map((jwks?.keys ?? []).map((k) => [k.kid, k])) };
    }
    const jwk = cache.porKid.get(kid);
    return jwk ? createPublicKey({ key: jwk, format: 'jwk' }) : null;
  }

  return async function verificarIdentityTokenApple(identityToken, { nonce } = {}) {
    const kid = jwt.decode(identityToken, { complete: true })?.header?.kid;
    if (!kid) throw tokenInvalido();
    const publica = await chave(kid);
    if (!publica) throw tokenInvalido();

    let payload;
    try {
      payload = jwt.verify(identityToken, publica, { algorithms: ['RS256'], issuer: EMISSOR_APPLE, audience: audiences });
    } catch {
      throw tokenInvalido();
    }
    if (!payload?.sub) throw tokenInvalido();
    // O app manda o nonce bruto e pediu à Apple o hash dele: o token carrega o hash.
    if (payload.nonce || nonce) {
      if (!nonce || payload.nonce !== hashNonce(nonce)) throw tokenInvalido();
    }

    const verificado = payload.email_verified === true || payload.email_verified === 'true';
    return {
      appleId: payload.sub,
      email: payload.email && verificado ? String(payload.email).toLowerCase() : null,
    };
  };
}

/**
 * Credenciais para falar com a Apple em nome do app (revogar o login ao
 * excluir a conta). Todas obrigatórias; faltando alguma, a revogação é pulada.
 * APPLE_PRIVATE_KEY: conteúdo do .p8 (aceita "\n" escapado numa linha só).
 */
export function credenciaisApple(env = process.env) {
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  const privateKey = env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const clientId = audiencesApple(env)[0];
  return teamId && keyId && privateKey ? { teamId, keyId, privateKey, clientId } : null;
}

/** client_secret da Apple: JWT ES256 assinado com a chave .p8 (vale 5 min aqui). */
export function clientSecretApple({ teamId, keyId, privateKey, clientId }, agora = Date.now()) {
  const iat = Math.floor(agora / 1000);
  return jwt.sign({ iss: teamId, iat, exp: iat + 300, aud: EMISSOR_APPLE, sub: clientId }, privateKey, {
    algorithm: 'ES256',
    keyid: keyId,
  });
}

/**
 * Revoga o "Entrar com Apple" do usuário (exigência da App Store ao excluir a
 * conta). Recebe o authorization code que o app acabou de obter da Apple,
 * troca por um refresh token e revoga esse token. Nunca lança: devolve o
 * motivo, porque a exclusão da conta não pode depender da Apple.
 * @param {{ credenciais?: object | null, fetch?: typeof fetch }} [opcoes]
 * @returns {(authorizationCode: string) => Promise<{ revogado: boolean, motivo?: string }>}
 */
export function criarRevogadorApple({ credenciais = credenciaisApple(), fetch: f = globalThis.fetch } = {}) {
  return async function revogarApple(authorizationCode) {
    if (!credenciais) return { revogado: false, motivo: 'APPLE_NAO_CONFIGURADO' };
    if (!authorizationCode) return { revogado: false, motivo: 'SEM_CODIGO' };
    try {
      const segredo = clientSecretApple(credenciais);
      const base = { client_id: credenciais.clientId, client_secret: segredo };
      const r = await f(URL_TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...base, grant_type: 'authorization_code', code: authorizationCode }),
      });
      const dados = await r.json().catch(() => ({}));
      const token = dados.refresh_token ?? dados.access_token;
      if (!r.ok || !token) return { revogado: false, motivo: 'CODIGO_RECUSADO' };
      const rev = await f(URL_REVOGAR, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...base,
          token,
          token_type_hint: dados.refresh_token ? 'refresh_token' : 'access_token',
        }),
      });
      return rev.ok ? { revogado: true } : { revogado: false, motivo: 'REVOGACAO_RECUSADA' };
    } catch {
      return { revogado: false, motivo: 'APPLE_INDISPONIVEL' };
    }
  };
}
