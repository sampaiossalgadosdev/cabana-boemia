/**
 * Pagamento online (Mercado Pago): flag global, trava de subida e disponibilidade por loja.
 * Plano e decisões: docs/pagamento-online.md.
 *
 * - PAGAMENTO_ONLINE_ATIVO: "sim" liga (sem diferenciar maiúsculas, espaços limpos);
 *   qualquer outro valor (vazio inclusive) = desligado, e tudo fica como antes.
 * - TOKEN_ENCRYPTION_KEY: obrigatória e válida com a flag ligada (a API não sobe sem ela).
 * - FRETE_GRATIS_MINIMO_PLATAFORMA_CENTAVOS: menor pedido mínimo do frete grátis de uma loja
 *   com entregador da plataforma (vazio = R$ 20,00), para a taxa não engolir o pedido.
 */
import { problemaNaChave } from './cifra.js';
import { formasDePagamento } from '@restaurante/shared/formasPagamento';

export const MINIMO_FRETE_GRATIS_PLATAFORMA_PADRAO = 2000;

export function pagamentoOnlineLigado(env = process.env) {
  return String(env.PAGAMENTO_ONLINE_ATIVO ?? '').trim().toLowerCase() === 'sim';
}

/** Problemas que impedem a API de subir (lista vazia = ok). */
export function problemasNoPagamentoOnline(env = process.env) {
  if (!pagamentoOnlineLigado(env)) return [];
  const problema = problemaNaChave(env.TOKEN_ENCRYPTION_KEY);
  return problema ? [`${problema} (obrigatória com PAGAMENTO_ONLINE_ATIVO=sim)`] : [];
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
