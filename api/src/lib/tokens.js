import { createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const ACCESS_TOKEN_DURACAO_SEG = 15 * 60; // 15 min
export const REFRESH_TOKEN_DURACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function segredo(nome) {
  const valor = process.env[nome];
  if (!valor || valor.length < 32) {
    throw new Error(`${nome} ausente ou curto demais (mínimo 32 caracteres) no .env`);
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
