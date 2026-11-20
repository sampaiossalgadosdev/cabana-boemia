import { prisma } from '../lib/prisma.js';
import { SELECT_PEDIDO } from './pedido.repository.js';

/**
 * Trava a linha do pedido da loja até o fim da transação (SELECT ... FOR UPDATE).
 * Lançar, remover item e fechar a mesma comanda ficam em fila: quem fecha
 * espera o lançamento terminar (e vice-versa), então nenhum item entra numa
 * comanda já fechada. Devolve `{ id, canal, status }` ou null.
 */
export async function travar(lojaId, id, tx) {
  const [linha] = await tx.$queryRaw`
    SELECT "id", "canal"::text AS "canal", "status"::text AS "status"
    FROM "Pedido" WHERE "id" = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
  return linha ?? null;
}

/** Subtotal = soma dos itens não cancelados; salão não tem taxa de entrega. */
export async function recalcularTotais(pedidoId, tx) {
  const { _sum } = await tx.itemPedido.aggregate({
    where: { pedidoId, canceladoEm: null },
    _sum: { totalCentavos: true },
  });
  const subtotal = _sum.totalCentavos ?? 0;
  await tx.pedido.update({
    where: { id: pedidoId },
    data: { subtotalCentavos: subtotal, taxaEntregaCentavos: 0, totalCentavos: subtotal },
  });
}

export function contarItensAtivos(pedidoId, tx) {
  return tx.itemPedido.count({ where: { pedidoId, canceladoEm: null } });
}

/** Marca o item como cancelado só se for desta comanda e ainda não estiver cancelado. */
export async function cancelarItemSeAtivo(pedidoId, itemId, canceladoEm, tx) {
  const { count } = await tx.itemPedido.updateMany({
    where: { id: itemId, pedidoId, canceladoEm: null },
    data: { canceladoEm },
  });
  return count;
}

export function buscarItem(pedidoId, itemId, tx) {
  return tx.itemPedido.findFirst({ where: { id: itemId, pedidoId }, select: { id: true, canceladoEm: true } });
}

/** Baixas (VENDA) de um item: é exatamente o que a remoção devolve. */
export function vendasDoItem(itemPedidoId, tx) {
  return tx.movimentacaoEstoque.findMany({
    where: { tipo: 'VENDA', itemPedidoId },
    select: { produtoId: true, insumoId: true, quantidade: true, itemPedidoId: true },
    orderBy: { id: 'asc' },
  });
}

export function fechar(id, { formaPagamento, finalizadoEm, caixaId }, tx) {
  return tx.pedido.update({
    where: { id },
    data: { status: 'FINALIZADO', formaPagamento, trocoParaCentavos: null, finalizadoEm, caixaId },
  });
}

/**
 * Todas as comandas abertas da loja, de qualquer dia (cliente que fica depois
 * da meia-noite continua na grade), da mais antiga para a mais nova.
 */
export function listarAbertas(lojaId, db = prisma) {
  return db.pedido.findMany({
    where: { lojaId, canal: 'SALAO', status: 'ABERTO' },
    orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
    select: SELECT_PEDIDO,
  });
}
