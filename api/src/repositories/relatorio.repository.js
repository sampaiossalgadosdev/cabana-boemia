import { prisma } from '../lib/prisma.js';

/** Pedidos da loja que contam como venda no intervalo: FINALIZADOS com finalizadoEm em [inicio, fim). */
export const finalizadosEntre = (lojaId, inicio, fim) => ({
  lojaId,
  status: 'FINALIZADO',
  finalizadoEm: { gte: inicio, lt: fim },
});

export function resumo(lojaId, inicio, fim, db = prisma) {
  return db.pedido.aggregate({
    where: finalizadosEntre(lojaId, inicio, fim),
    _count: { _all: true },
    _sum: { totalCentavos: true, taxaEntregaCentavos: true, subtotalCentavos: true, descontoCentavos: true },
  });
}

/** Formas pagas NA ENTREGA (o pago online fica à parte, Decisão 19). */
export function porFormaPagamento(lojaId, inicio, fim, db = prisma) {
  return db.pedido.groupBy({
    by: ['formaPagamento'],
    where: { ...finalizadosEntre(lojaId, inicio, fim), meioOnline: null },
    _count: { _all: true },
    _sum: { totalCentavos: true },
  });
}

/** Pago online (Pix e cartão pelo app), por meio. */
export function porMeioOnline(lojaId, inicio, fim, db = prisma) {
  return db.pedido.groupBy({
    by: ['meioOnline'],
    where: { ...finalizadosEntre(lojaId, inicio, fim), meioOnline: { not: null } },
    _count: { _all: true },
    _sum: { totalCentavos: true },
  });
}

/**
 * Estornos concluídos no intervalo de pedidos FINALIZADOS (o ADMIN estornou depois da entrega,
 * Decisão 2 da Etapa 5): à parte, fora dos totais. O pedido cancelado já está nos cancelados.
 */
export function estornosDeFinalizados(lojaId, inicio, fim, db = prisma) {
  return db.estorno.aggregate({
    where: {
      status: { in: ['CONCLUIDO', 'RESOLVIDO_POR_FORA'] },
      concluidoEm: { gte: inicio, lt: fim },
      pagamento: { pedido: { lojaId, status: 'FINALIZADO' } },
    },
    _count: { _all: true },
    _sum: { valorCentavos: true },
  });
}

export function porCanal(lojaId, inicio, fim, db = prisma) {
  return db.pedido.groupBy({
    by: ['canal'],
    where: finalizadosEntre(lojaId, inicio, fim),
    _count: { _all: true },
    _sum: { totalCentavos: true },
  });
}

/** Itens NÃO cancelados de pedidos finalizados no intervalo, somados por produto. */
export function porProduto(lojaId, inicio, fim, db = prisma) {
  return db.itemPedido.groupBy({
    by: ['produtoId'],
    where: { canceladoEm: null, pedido: finalizadosEntre(lojaId, inicio, fim) },
    _count: { _all: true },
    _sum: { quantidade: true, totalCentavos: true, pesoGramas: true },
  });
}

export function nomesDosProdutos(ids, db = prisma) {
  return db.produto.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, tipoPreco: true } });
}

/** Pedidos cancelados no intervalo (canceladoEm), fora dos totais. */
export function cancelados(lojaId, inicio, fim, db = prisma) {
  return db.pedido.aggregate({
    where: { lojaId, status: 'CANCELADO', canceladoEm: { gte: inicio, lt: fim } },
    _count: { _all: true },
    _sum: { totalCentavos: true },
  });
}

/** Itens removidos (cancelados) de pedidos que foram finalizados no intervalo. */
export function itensRemovidos(lojaId, inicio, fim, db = prisma) {
  return db.itemPedido.aggregate({
    where: { canceladoEm: { not: null }, pedido: finalizadosEntre(lojaId, inicio, fim) },
    _count: { _all: true },
    _sum: { totalCentavos: true },
  });
}
