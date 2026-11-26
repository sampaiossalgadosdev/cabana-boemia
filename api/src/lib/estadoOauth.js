/**
 * State do OAuth do Mercado Pago: diz para qual loja é a conexão, quem pediu, para onde
 * voltar e até quando vale (10 minutos). Assinado com HMAC-SHA256 (MP_STATE_SECRET):
 * adulterado, vencido ou com outro segredo = recusado. Sem PKCE por enquanto (Decisão 15).
 *
 * Formato: "<payload base64url>.<assinatura base64url>", payload = { l, u, o, e, n }
 * (loja, usuário, origem, expira em ms, nonce aleatório).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const VALIDADE_STATE_MS = 10 * 60 * 1000;

/** Retaguarda de produção (DECISÃO 11 da Etapa 3): `cabana.managerpix.com.br` não é mais usada. */
export const ORIGEM_RETAGUARDA = 'https://taakidelivery.com.br';
/** Para onde volta quando a origem não é aceita (ou o state não vale). */
export const RETORNO_PADRAO = 'https://taakidelivery.com.br/parceiro';

/**
 * Origem aceita para voltar depois do Mercado Pago: só https://taakidelivery.com.br e,
 * fora de produção, http://localhost / http://127.0.0.1 em qualquer porta.
 * @returns {string | null} a origem normalizada, ou null
 */
export function origemPermitida(origem, { producao = false } = {}) {
  if (typeof origem !== 'string' || !URL.canParse(origem)) return null;
  const u = new URL(origem);
  if (u.origin === ORIGEM_RETAGUARDA) return u.origin;
  if (!producao && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin;
  return null;
}

/** Destino do retorno: a tela "Pagamento online" na origem aceita, ou o padrão da retaguarda. */
export function urlDeRetorno(origem, parametros, { producao = false } = {}) {
  const valida = origemPermitida(origem, { producao });
  const url = new URL(valida ? `${valida}/admin/pagamento-online` : RETORNO_PADRAO);
  for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
  return url.toString();
}

const assinar = (payload, segredo) => createHmac('sha256', segredo).update(payload).digest('base64url');

/**
 * @param {{ lojaId: number, usuarioId: number, origem: string | null }} dados
 * @param {string} segredo MP_STATE_SECRET
 */
export function criarState({ lojaId, usuarioId, origem }, segredo, agora = new Date()) {
  const payload = Buffer.from(
    JSON.stringify({ l: lojaId, u: usuarioId, o: origem ?? null, e: agora.getTime() + VALIDADE_STATE_MS, n: randomBytes(9).toString('base64url') }),
  ).toString('base64url');
  return `${payload}.${assinar(payload, segredo)}`;
}

/**
 * @returns {{ ok: true, lojaId: number, usuarioId: number, origem: string | null }
 *   | { ok: false, motivo: 'STATE_INVALIDO' | 'STATE_EXPIRADO', origem: string | null }}
 *   Mesmo recusado, devolve a origem só se a assinatura conferir (para voltar ao lugar certo).
 */
export function lerState(state, segredo, agora = new Date()) {
  const [payload, assinatura, ...resto] = String(state ?? '').split('.');
  if (!payload || !assinatura || resto.length) return { ok: false, motivo: 'STATE_INVALIDO', origem: null };
  const esperada = Buffer.from(assinar(payload, segredo));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) {
    return { ok: false, motivo: 'STATE_INVALIDO', origem: null };
  }
  let dados;
  try {
    dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, motivo: 'STATE_INVALIDO', origem: null };
  }
  if (!Number.isInteger(dados?.l) || !Number.isInteger(dados?.u) || !Number.isFinite(dados?.e)) {
    return { ok: false, motivo: 'STATE_INVALIDO', origem: null };
  }
  if (agora.getTime() > dados.e) return { ok: false, motivo: 'STATE_EXPIRADO', origem: dados.o ?? null };
  return { ok: true, lojaId: dados.l, usuarioId: dados.u, origem: dados.o ?? null };
}
