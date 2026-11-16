import { prisma } from '../lib/prisma.js';

/** Pedidos que contam como venda no intervalo: FINALIZADOS com finalizadoEm em [inicio, fim). */
export const finalizadosEntre = (inicio, fim) => ({ status: 'FINALIZADO', finalizadoEm: { gte: inicio, lt: fim } });

export function resumo(inicio, fim, db = prisma) {
  return db.pedido.aggregate({
    where: finalizadosEntre(inicio, fim),
    _count: { _all: true },
    _sum: { totalCentavos: true, taxaEntregaCentavos: true, subtotalCentavos: true },
  });
}

export function porFormaPagamento(inicio, fim, db = prisma) {
  return db.pedido.groupBy({
    by: ['formaPagamento'],
    where: finalizadosEntre(inicio, fim),
    _count: { _all: true },
    _sum: { totalCentavos: true },
  });
}

export function porCanal(inicio, fim, db = prisma) {
  return db.pedido.groupBy({
    by: ['canal'],
    where: finalizadosEntre(inicio, fim),
    _count: { _all: true },
    _sum: { totalCentavos: true },
  });
}

/** Itens NÃO cancelados de pedidos finalizados no intervalo, somados por produto. */
export function porProduto(inicio, fim, db = prisma) {
  return db.itemPedido.groupBy({
    by: ['produtoId'],
    where: { canceladoEm: null, pedido: finalizadosEntre(inicio, fim) },
    _count: { _all: true },
    _sum: { quantidade: true, totalCentavos: true, pesoGramas: true },
  });
}

export function nomesDosProdutos(ids, db = prisma) {
  return db.produto.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, tipoPreco: true } });
}

/** Pedidos cancelados no intervalo (canceladoEm), fora dos totais. */
export function cancelados(inicio, fim, db = prisma) {
  return db.pedido.aggregate({
    where: { status: 'CANCELADO', canceladoEm: { gte: inicio, lt: fim } },
    _count: { _all: true },
    _sum: { totalCentavos: true },
  });
}

/** Itens removidos (cancelados) de pedidos que foram finalizados no intervalo. */
export function itensRemovidos(inicio, fim, db = prisma) {
  return db.itemPedido.aggregate({
    where: { canceladoEm: { not: null }, pedido: finalizadosEntre(inicio, fim) },
    _count: { _all: true },
    _sum: { totalCentavos: true },
  });
}
