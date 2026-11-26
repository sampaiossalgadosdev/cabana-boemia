/**
 * Pagamento online (Mercado Pago): flag global, trava de subida e disponibilidade por loja.
 * Plano e decisões: docs/pagamento-online.md.
 *
 * - PAGAMENTO_ONLINE_ATIVO: "sim" liga (sem diferenciar maiúsculas, espaços limpos);
 *   qualquer outro valor (vazio inclusive) = desligado, e tudo fica como antes.
 * - TOKEN_ENCRYPTION_KEY: obrigatória e válida com a flag ligada (a API não sobe sem ela).
 * - FRETE_GRATIS_MINIMO_PLATAFORMA_CENTAVOS: menor pedido mínimo do frete grátis de uma loja
 *   com entregador da plataforma (vazio = R$ 20,00), para a taxa não engolir o pedido.
 * - MP_STATE_SECRET: assina o state do OAuth (32+ caracteres, diferente dos segredos JWT);
 *   obrigatório para conectar uma loja e, com a flag ligada, para a API subir.
 * - CAMPANHA_TELEFONE_SECRET: HMAC do telefone da campanha (mesmas regras); exigido quando a
 *   reserva da campanha for ligada na criação do pedido (Etapa 4).
 * - MP_CLIENT_ID, MP_CLIENT_SECRET, MP_REDIRECT_URI: aplicativo no Mercado Pago (lib/mercadoPago.js).
 */
import { problemaNaChave } from './cifra.js';
import { configMercadoPago, mercadoPagoConfigurado } from './mercadoPago.js';
import { formasDePagamento } from '@restaurante/shared/formasPagamento';

export const MINIMO_FRETE_GRATIS_PLATAFORMA_PADRAO = 2000;

export function pagamentoOnlineLigado(env = process.env) {
  return String(env.PAGAMENTO_ONLINE_ATIVO ?? '').trim().toLowerCase() === 'sim';
}

const SEGREDOS_JWT = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'JWT_CLIENTE_SECRET'];

/** Problema num segredo do pagamento online (texto para o log), ou null. */
export function problemaNoSegredo(nome, env = process.env) {
  const v = String(env[nome] ?? '');
  if (!v) return `${nome} ausente`;
  if (v.length < 32) return `${nome} curto demais (${v.length} caracteres; mínimo 32)`;
  const igual = SEGREDOS_JWT.find((j) => env[j] && env[j] === v);
  if (igual) return `${nome} precisa ser diferente de ${igual}`;
  return null;
}

/** Problemas que impedem a API de subir (lista vazia = ok). */
export function problemasNoPagamentoOnline(env = process.env) {
  if (!pagamentoOnlineLigado(env)) return [];
  return [problemaNaChave(env.TOKEN_ENCRYPTION_KEY), problemaNoSegredo('MP_STATE_SECRET', env)]
    .filter(Boolean)
    .map((p) => `${p} (obrigatória com PAGAMENTO_ONLINE_ATIVO=sim)`);
}

/**
 * O que falta no servidor para uma loja conectar a conta Mercado Pago (lista vazia = pode).
 * Vale com a flag desligada também (Decisão 13 da Etapa 3): só o interruptor fica travado.
 */
export function faltasParaConectar(env = process.env) {
  const faltas = [];
  if (!mercadoPagoConfigurado(configMercadoPago(env))) faltas.push('MP_CLIENT_ID, MP_CLIENT_SECRET e MP_REDIRECT_URI');
  if (problemaNaChave(env.TOKEN_ENCRYPTION_KEY)) faltas.push('TOKEN_ENCRYPTION_KEY');
  if (problemaNoSegredo('MP_STATE_SECRET', env)) faltas.push('MP_STATE_SECRET');
  return faltas;
}

/** Pedido mínimo do frete grátis da loja com entregador da plataforma, em centavos. */
export function minimoFreteGratisPlataforma(env = process.env) {
  const v = String(env.FRETE_GRATIS_MINIMO_PLATAFORMA_CENTAVOS ?? '').trim();
  const n = Number(v);
  return v && Number.isInteger(n) && n > 0 ? n : MINIMO_FRETE_GRATIS_PLATAFORMA_PADRAO;
}

/**
 * A loja pode receber pagamento online agora? Flag global ligada, a loja ligou o
 * pagamento online e a conexão com o Mercado Pago está CONECTADA.
 * @param {{ pagamentoOnlineAtivo?: boolean } | null} loja
 * @param {{ status?: string } | null} conexao
 */
export function pagamentoOnlineDisponivel(loja, conexao, env = process.env) {
  return pagamentoOnlineLigado(env) && Boolean(loja?.pagamentoOnlineAtivo) && conexao?.status === 'CONECTADA';
}

/** Formas que o app deve oferecer na loja (Decisão 11). */
export function formasDaLoja(loja, conexao, env = process.env) {
  return formasDePagamento({
    modoEntrega: loja?.modoEntrega ?? 'PROPRIO',
    onlineDisponivel: pagamentoOnlineDisponivel(loja, conexao, env),
  });
}
