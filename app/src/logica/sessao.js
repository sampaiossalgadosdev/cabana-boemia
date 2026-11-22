import { lerTexto, gravarTexto, removerTexto, cofrePadrao } from './armazenamento.js';

/**
 * Sessão do cliente no app (adaptada de site/src/cliente/sessao.js). Fica no
 * COFRE do aparelho (expo-secure-store: Keychain no iOS, Keystore no Android),
 * nunca no AsyncStorage: { token (JWT de 7 dias), refreshToken (60 dias,
 * rotativo), provedor ('google' | 'apple' | 'telefone') }. Os dados do cliente (nome,
 * telefone, endereços) ficam na API.
 */
// O SecureStore só aceita letras, números, ".", "-" e "_" na chave.
export const CHAVE_SESSAO = 'delivery-abatia.cliente.v1';

/** Renova quando faltar menos que isto para o token vencer. */
export const MARGEM_RENOVACAO_MS = 24 * 60 * 60 * 1000;

const ehJwt = (t) => typeof t === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t);

const PROVEDORES = ['google', 'apple', 'telefone'];

/** @returns {Promise<{ token: string, refreshToken: string | null, provedor: string | null } | null>} */
export async function carregarSessao(cofre = cofrePadrao()) {
  const texto = await lerTexto(CHAVE_SESSAO, cofre);
  if (!texto) return null;
  try {
    const s = JSON.parse(texto);
    if (!ehJwt(s?.token)) return null;
    return {
      token: s.token,
      refreshToken: typeof s.refreshToken === 'string' && s.refreshToken.length >= 20 ? s.refreshToken : null,
      provedor: PROVEDORES.includes(s.provedor) ? s.provedor : null,
    };
  } catch {
    return null;
  }
}

/** @returns {Promise<boolean>} */
export function salvarSessao({ token, refreshToken = null, provedor = null }, cofre = cofrePadrao()) {
  return gravarTexto(CHAVE_SESSAO, JSON.stringify({ token, refreshToken, provedor }), cofre);
}

export function apagarSessao(cofre = cofrePadrao()) {
  return removerTexto(CHAVE_SESSAO, cofre);
}

/** base64url → texto (sem Buffer: roda no Hermes e no Node). */
function decodificarBase64Url(parte) {
  const b64 = parte.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parte.length / 4) * 4, '=');
  return globalThis.atob(b64);
}

/** Instante (ms) em que o JWT vence, ou null se não dá para ler. Só leitura: quem confere é a API. */
export function expiraEm(token) {
  try {
    const { exp } = JSON.parse(decodificarBase64Url(token.split('.')[1]));
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** O token vence em menos de um dia (ou não dá para saber): renovar antes de usar. */
export function precisaRenovar(token, agora = Date.now(), margem = MARGEM_RENOVACAO_MS) {
  const fim = expiraEm(token);
  return fim == null || fim - agora < margem;
}

/**
 * Qual passo do checkout mostrar.
 * @param {{ status: 'anonimo' | 'carregando' | 'logado' | 'erro', cliente: { precisaTelefone: boolean } | null }} sessao
 * @returns {'carregando' | 'erro' | 'login' | 'telefone' | 'pronto'}
 */
export function etapaCheckout({ status, cliente }) {
  if (status === 'carregando') return 'carregando';
  if (status === 'erro') return 'erro';
  if (status !== 'logado' || !cliente) return 'login';
  // Entrou só pelo celular e ainda não tem nome: o mesmo passo (nome + telefone).
  if (cliente.precisaTelefone || !cliente.telefone || cliente.precisaNome) return 'telefone';
  return 'pronto';
}

/** 401 da API = sessão morta (token expirado, inválido ou cliente apagado). */
export const sessaoExpirou = (erro) => erro?.status === 401;
