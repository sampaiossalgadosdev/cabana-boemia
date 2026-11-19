import { createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const ACCESS_TOKEN_DURACAO_SEG = 15 * 60; // 15 min
export const REFRESH_TOKEN_DURACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
export const CLIENTE_TOKEN_DURACAO_SEG = 7 * 24 * 60 * 60; // 7 dias, sem refresh

// Audiences: um token da equipe nunca vale como token de cliente e vice-versa
// (além disso, cada um é assinado com um segredo diferente).
const AUD_EQUIPE = 'equipe';
const AUD_CLIENTE = 'cliente';

const SEGREDOS = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'JWT_CLIENTE_SECRET'];
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
  for (let i = 0; i < SEGREDOS.length; i++) {
    for (let j = i + 1; j < SEGREDOS.length; j++) {
      const [a, b] = [SEGREDOS[i], SEGREDOS[j]];
      if (env[a] && env[a] === env[b]) problemas.push(`${a} e ${b} precisam ser diferentes`);
    }
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

/** JWT de acesso da equipe, HS256 com { sub, papel, aud: "equipe" }, válido por 15 min. */
export function gerarAccessToken(usuario) {
  return jwt.sign({ papel: usuario.papel }, segredo('JWT_SECRET'), {
    algorithm: 'HS256',
    subject: String(usuario.id),
    audience: AUD_EQUIPE,
    expiresIn: ACCESS_TOKEN_DURACAO_SEG,
  });
}

/** Devolve o payload ou lança o erro do jsonwebtoken (TokenExpiredError, JsonWebTokenError). */
export function verificarAccessToken(token) {
  return jwt.verify(token, segredo('JWT_SECRET'), { algorithms: ['HS256'], audience: AUD_EQUIPE });
}

/** JWT do cliente do site, HS256 com { sub, aud: "cliente" } e segredo próprio, válido por 7 dias. */
export function gerarTokenCliente(cliente) {
  return jwt.sign({}, segredo('JWT_CLIENTE_SECRET'), {
    algorithm: 'HS256',
    subject: String(cliente.id),
    audience: AUD_CLIENTE,
    expiresIn: CLIENTE_TOKEN_DURACAO_SEG,
  });
}

/** Como verificarAccessToken, mas para o token do cliente. */
export function verificarTokenCliente(token) {
  return jwt.verify(token, segredo('JWT_CLIENTE_SECRET'), {
    algorithms: ['HS256'],
    audience: AUD_CLIENTE,
  });
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

/** Refresh do cliente (app): 60 dias, renovado a cada uso (rotativo). O site não usa. */
export const CLIENTE_REFRESH_DURACAO_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Hash do refresh do cliente: HMAC com o segredo do cliente e um prefixo, para
 * nunca coincidir com o hash de um refresh da equipe (outra tabela, outro segredo).
 */
export function hashRefreshTokenCliente(token) {
  return createHmac('sha256', segredo('JWT_CLIENTE_SECRET')).update(`cliente:${token}`).digest('hex');
}

export function gerarRefreshTokenCliente(agora = new Date()) {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashRefreshTokenCliente(token),
    expiraEm: new Date(agora.getTime() + CLIENTE_REFRESH_DURACAO_MS),
  };
}
