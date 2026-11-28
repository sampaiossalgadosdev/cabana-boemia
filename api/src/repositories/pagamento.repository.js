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

// ───────── Etapa 5: estornos ─────────

/** Trava a linha do pedido com o que o cancelamento confere (loja, dono, aceite, meio). */
export async function travarPedidoParaCancelar(pedidoId, db) {
  const [linha] = await db.$queryRaw`
    SELECT "status"::text AS "status", "lojaId", "clienteId", "aceitoEm", "meioOnline"::text AS "meioOnline"
    FROM "Pedido" WHERE "id" = ${pedidoId} FOR UPDATE`;
  return linha ?? null;
}

/** Trava a linha do pagamento (tentar de novo e resolver por fora não se cruzam). */
export async function travarPagamento(id, db) {
  const [linha] = await db.$queryRaw`SELECT "id", "status"::text AS "status" FROM "Pagamento" WHERE "id" = ${id} FOR UPDATE`;
  return linha ?? null;
}

const COM_PAGAMENTO = { pagamento: { include: COM_PEDIDO } };

export function criarEstorno(dados, db = prisma) {
  return db.estorno.create({ data: dados, include: COM_PAGAMENTO });
}

export function buscarEstorno(id, db = prisma) {
  return db.estorno.findUnique({ where: { id }, include: COM_PAGAMENTO });
}

/** O estorno ainda em aberto do pagamento (processando ou que falhou), o mais recente. */
export function estornoAberto(pagamentoId, db = prisma) {
  return db.estorno.findFirst({
    where: { pagamentoId, status: { in: ['PROCESSANDO', 'FALHOU'] } },
    orderBy: { id: 'desc' },
    include: COM_PAGAMENTO,
  });
}

/** Ids no Mercado Pago dos estornos já concluídos (ou resolvidos) do pagamento. */
export async function idsDeEstornosConcluidos(pagamentoId, db = prisma) {
  const lista = await db.estorno.findMany({
    where: { pagamentoId, status: { in: ['CONCLUIDO', 'RESOLVIDO_POR_FORA'] }, mpRefundId: { not: null } },
    select: { mpRefundId: true },
  });
  return new Set(lista.map((e) => e.mpRefundId));
}

/** Muda o estorno só se ele estiver num dos status dados. Devolve o count. */
export async function atualizarEstornoSeEm(id, status, dados, db = prisma) {
  const { count } = await db.estorno.updateMany({ where: { id, status: { in: status } }, data: dados });
  return count;
}

/** Pagamentos aprovados depois de o pedido expirar que ainda não foram estornados. */
export function aEstornar(db = prisma) {
  return db.pagamento.findMany({ where: { status: 'A_ESTORNAR' }, orderBy: { id: 'asc' }, include: COM_PEDIDO });
}

/**
 * Pedidos pagos online, abertos, sem o aceite da loja e aprovados até `limite`, que ainda não
 * tiveram o alerta PEDIDO_SEM_ACEITE (aberto ou resolvido: um por pedido).
 */
export function semAceiteDesde(limite, db = prisma) {
  return db.pedido.findMany({
    where: {
      meioOnline: { not: null },
      aceitoEm: null,
      status: { in: ['ABERTO', 'CONFIRMADO', 'EM_PREPARO', 'SAIU_ENTREGA'] },
      pagamentos: { some: { status: 'APROVADO', aprovadoEm: { lte: limite } } },
      alertas: { none: { tipo: 'PEDIDO_SEM_ACEITE' } },
    },
    select: { id: true, lojaId: true, numeroDia: true, loja: { select: { nome: true } } },
  });
}

/** Status de pagamento que aparecem na tela "Pagamentos online" do ADMIN. */
export const STATUS_PAGOS = ['APROVADO', 'REEMBOLSADO', 'REEMBOLSO_PARCIAL', 'REEMBOLSO_PENDENTE', 'A_ESTORNAR', 'CONTESTADO'];
/** Os que pedem ação do ADMIN. */
export const STATUS_DE_ACAO = ['REEMBOLSO_PENDENTE', 'A_ESTORNAR', 'CONTESTADO'];

/** Lista para o ADMIN (mais novos primeiro, até 100), com o pedido, a loja e os estornos. */
export function listarParaAdmin({ status, lojaId, pedidoId, numeroDia }, db = prisma) {
  return db.pagamento.findMany({
    where: {
      status: { in: status },
      ...((lojaId || pedidoId || numeroDia) && {
        pedido: { ...(lojaId && { lojaId }), ...(pedidoId && { id: pedidoId }), ...(numeroDia && { numeroDia }) },
      }),
    },
    orderBy: { id: 'desc' },
    take: 100,
    include: {
      pedido: {
        select: {
          id: true,
          numeroDia: true,
          dataRef: true,
          status: true,
          aceitoEm: true,
          criadoEm: true,
          finalizadoEm: true,
          canceladoEm: true,
          nomeCliente: true,
          totalCentavos: true,
          meioOnline: true,
          origemTaxaEntrega: true, // entrega pelo Taaki (lembrete do ajuste no estorno de finalizado)
          loja: { select: { id: true, nome: true, slug: true } },
        },
      },
      estornos: {
        orderBy: { id: 'asc' },
        include: { usuario: { select: { nome: true } }, resolvidoPor: { select: { nome: true } } },
      },
    },
  });
}

/** Pix expirados do nosso lado ainda com o cancelamento no Mercado Pago a refazer (até `cancelarNoMpAte`). */
export function cancelamentosPendentes(agora, db = prisma) {
  return db.pagamento.findMany({
    where: { metodo: 'PIX', mpPaymentId: { not: null }, cancelarNoMpAte: { gt: agora } },
    orderBy: { id: 'asc' },
    include: COM_PEDIDO,
  });
}
