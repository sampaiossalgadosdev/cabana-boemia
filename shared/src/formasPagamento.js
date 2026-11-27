/**
 * Formas de pagamento por tipo de loja (Decisão 11 de docs/pagamento-online.md). Pura e testada.
 *
 * - Entregador da plataforma: na entrega só dinheiro (o entregador não leva maquininha nem
 *   recebe Pix da loja); online, Pix e cartão pelo app (Checkout Pro: crédito à vista, débito,
 *   pré-pago ou saldo Mercado Pago; Decisão 2 da Etapa 7).
 * - Motoboy próprio: as formas de hoje na entrega (Pix, dinheiro, débito e crédito na
 *   maquininha) e, com a loja conectada, Pix e cartão pelo app.
 *
 * O online só aparece quando `onlineDisponivel` (flag global + loja ligada + conexão CONECTADA).
 */

export const FORMAS_NA_ENTREGA = Object.freeze(['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']);
export const FORMAS_NA_ENTREGA_PLATAFORMA = Object.freeze(['DINHEIRO']);
export const METODOS_ONLINE = Object.freeze(['PIX', 'CARTAO_ONLINE']);

/** Nome do tipo real do cartão pelo app (`Pedido.tipoPagamentoOnline`, Etapa 7). */
export const NOME_TIPO_CARTAO_ONLINE = Object.freeze({
  CREDITO: 'Cartão de crédito',
  DEBITO: 'Cartão de débito',
  PRE_PAGO: 'Cartão pré-pago',
  SALDO_MERCADO_PAGO: 'Saldo Mercado Pago',
  OUTRO: 'Mercado Pago',
});

/**
 * Nome do pagamento online para o cupom, o PDV e o relatório: "Pix", o tipo do cartão quando o
 * Mercado Pago informou ("Cartão de débito") ou só "Cartão" (antes da aprovação, pedidos antigos).
 * @param {{ meio?: string | null, tipo?: string | null } | null} pagamento
 */
export function nomeDoPagamentoOnline(pagamento) {
  if (pagamento?.meio === 'PIX') return 'Pix';
  if (pagamento?.meio === 'CARTAO_ONLINE') return NOME_TIPO_CARTAO_ONLINE[pagamento.tipo] ?? 'Cartão';
  return 'online';
}

/**
 * Linhas do cartão pelo app por tipo no relatório do dia (`pagoOnline[].porTipo`): só quando
 * dizem algo além de "Cartão" (mais de um tipo, ou um tipo que não é crédito). Senão, nenhuma.
 * @param {{ porTipo?: { tipo: string, quantidade: number, totalCentavos: number }[] }} linha
 */
export function linhasPorTipo(linha) {
  const porTipo = (linha?.porTipo ?? []).filter((t) => t.quantidade > 0);
  if (porTipo.length > 1 || (porTipo.length === 1 && porTipo[0].tipo !== 'CREDITO')) return porTipo;
  return [];
}

/**
 * @param {{ modoEntrega?: 'PLATAFORMA' | 'PROPRIO', onlineDisponivel?: boolean }} loja
 * @returns {{ naEntrega: string[], online: string[] }}
 */
export function formasDePagamento({ modoEntrega = 'PROPRIO', onlineDisponivel = false } = {}) {
  return {
    naEntrega: [...(modoEntrega === 'PLATAFORMA' ? FORMAS_NA_ENTREGA_PLATAFORMA : FORMAS_NA_ENTREGA)],
    online: onlineDisponivel ? [...METODOS_ONLINE] : [],
  };
}

/**
 * Forma paga na entrega aceita para o pedido? Só restringe quando o entregador da
 * plataforma vai receber: retirada no balcão e "pago agora" no balcão (PDV) aceitam todas.
 * @param {{ modoEntrega?: string, forma: string, comEntrega?: boolean, pagoAgora?: boolean }} dados
 */
export function formaNaEntregaPermitida({ modoEntrega = 'PROPRIO', forma, comEntrega = true, pagoAgora = false }) {
  if (!FORMAS_NA_ENTREGA.includes(forma)) return false;
  if (modoEntrega !== 'PLATAFORMA' || !comEntrega || pagoAgora) return true;
  return FORMAS_NA_ENTREGA_PLATAFORMA.includes(forma);
}
