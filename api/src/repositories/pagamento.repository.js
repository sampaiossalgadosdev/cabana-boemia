import { prisma } from '../lib/prisma.js';

/** Pagamento com a loja e o cliente do pedido (para conferir dono e loja). */
const COM_PEDIDO = { pedido: { select: { id: true, lojaId: true, clienteId: true, status: true } } };

export function criar(dados, db = prisma) {
  return db.pagamento.create({ data: dados });
}

export function buscarPorId(id, db = prisma) {
  return db.pagamento.findUnique({ where: { id }, include: COM_PEDIDO });
}

/** O pagamento online mais recente do pedido (um por tentativa; hoje, um por pedido). */
export function ultimoDoPedido(pedidoId, db = prisma) {
  return db.pagamento.findFirst({ where: { pedidoId }, orderBy: { id: 'desc' }, include: COM_PEDIDO });
}

export function buscarPorMpPaymentId(mpPaymentId, db = prisma) {
  return db.pagamento.findUnique({ where: { mpPaymentId: String(mpPaymentId) }, include: COM_PEDIDO });
}

export function atualizar(id, dados, db = prisma) {
  return db.pagamento.update({ where: { id }, data: dados });
}

/** Muda o pagamento só se ele estiver num dos status dados (transição só para frente). Devolve o count. */
export async function atualizarSeEm(id, status, dados, db = prisma) {
  const { count } = await db.pagamento.updateMany({ where: { id, status: { in: status } }, data: dados });
  return count;
}

/** Pendentes (Pix), mais antigos primeiro; `lojaId` = só os da loja. */
export function pendentes({ lojaId } = {}, db = prisma) {
  return db.pagamento.findMany({
    where: { status: 'PENDENTE', ...(lojaId != null && { pedido: { lojaId } }) },
    orderBy: { id: 'asc' },
    include: COM_PEDIDO,
  });
}

/** Pix que falharam ao ser criados (sem id no Mercado Pago) na loja desde `desde`. */
export function contarFalhasDeCriacao(lojaId, desde, db = prisma) {
  return db.pagamento.count({ where: { status: 'RECUSADO', mpPaymentId: null, criadoEm: { gte: desde }, pedido: { lojaId } } });
}

/**
 * Trava a linha do pedido (FOR UPDATE) e devolve status e loja: aprovação e expiração do
 * mesmo pedido nunca se cruzam (a segunda espera e vê o status novo).
 */
export async function travarPedido(pedidoId, db) {
  const [linha] = await db.$queryRaw`SELECT "status"::text AS "status", "lojaId" FROM "Pedido" WHERE "id" = ${pedidoId} FOR UPDATE`;
  return linha ?? null;
}
