/**
 * Formas de pagamento por tipo de loja (Decisão 11 de docs/pagamento-online.md). Pura e testada.
 *
 * - Entregador da plataforma: na entrega só dinheiro (o entregador não leva maquininha nem
 *   recebe Pix da loja); online, Pix e cartão de crédito.
 * - Motoboy próprio: as formas de hoje na entrega (Pix, dinheiro, débito e crédito na
 *   maquininha) e, com a loja conectada, Pix e cartão de crédito online.
 *
 * O online só aparece quando `onlineDisponivel` (flag global + loja ligada + conexão CONECTADA).
 */

export const FORMAS_NA_ENTREGA = Object.freeze(['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']);
export const FORMAS_NA_ENTREGA_PLATAFORMA = Object.freeze(['DINHEIRO']);
export const METODOS_ONLINE = Object.freeze(['PIX', 'CARTAO_ONLINE']);

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
