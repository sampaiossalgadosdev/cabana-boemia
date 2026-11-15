import { createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const ACCESS_TOKEN_DURACAO_SEG = 15 * 60; // 15 min
export const REFRESH_TOKEN_DURACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

const SEGREDOS = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
const SEGREDO_MIN = 32;

/**
 * Problemas nos segredos dos tokens (vazio = tudo certo). O server.js recusa
 * iniciar se houver algum, para não subir e só quebrar no primeiro login.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function problemasNosSegredos(env = process.env) {
  const problemas = [];
  for (const nome of SEGREDOS) {
    const valor = env[nome];
    if (!valor) problemas.push(`${nome} ausente`);
    else if (valor.length < SEGREDO_MIN) {
      problemas.push(`${nome} curto demais (${valor.length} caracteres; mínimo ${SEGREDO_MIN})`);
    }
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    problemas.push('JWT_SECRET e JWT_REFRESH_SECRET precisam ser diferentes');
  }
  return problemas;
}

function segredo(nome) {
  const valor = process.env[nome];
  if (!valor || valor.length < SEGREDO_MIN) {
    throw new Error(`${nome} ausente ou curto demais (mínimo ${SEGREDO_MIN} caracteres) no .env`);
  }
  return valor;
}

/** JWT de acesso HS256 com { sub, papel }, válido por 15 min. */
export function gerarAccessToken(usuario) {
  return jwt.sign({ papel: usuario.papel }, segredo('JWT_SECRET'), {
    algorithm: 'HS256',
    subject: String(usuario.id),
    expiresIn: ACCESS_TOKEN_DURACAO_SEG,
  });
}

/** Devolve o payload ou lança o erro do jsonwebtoken (TokenExpiredError, JsonWebTokenError). */
export function verificarAccessToken(token) {
  return jwt.verify(token, segredo('JWT_SECRET'), { algorithms: ['HS256'] });
}

/** Hash guardado no banco: HMAC-SHA256 do token com JWT_REFRESH_SECRET. */
export function hashRefreshToken(token) {
  return createHmac('sha256', segredo('JWT_REFRESH_SECRET')).update(token).digest('hex');
}

/** Refresh token opaco (32 bytes aleatórios) + o hash a guardar + expiração. */
export function gerarRefreshToken(agora = new Date()) {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashRefreshToken(token),
    expiraEm: new Date(agora.getTime() + REFRESH_TOKEN_DURACAO_MS),
  };
}
