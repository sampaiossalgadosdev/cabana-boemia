import { prisma } from '../lib/prisma.js';

const SELECT_USUARIO = { select: { id: true, nome: true } };

const SELECT_MOVIMENTO = {
  id: true,
  tipo: true,
  valorCentavos: true,
  motivo: true,
  criadoEm: true,
  usuario: SELECT_USUARIO,
};

export const SELECT_CAIXA = {
  id: true,
  abertoEm: true,
  valorInicialCentavos: true,
  fechadoEm: true,
  valorContadoCentavos: true,
  esperadoCentavos: true,
  diferencaCentavos: true,
  observacao: true,
  abertoPor: SELECT_USUARIO,
  fechadoPor: SELECT_USUARIO,
  movimentos: { select: SELECT_MOVIMENTO, orderBy: { id: 'asc' } },
};

/**
 * Trava o caixa aberto DA LOJA em modo COMPARTILHADO até o fim da transação: várias
 * finalizações/movimentos ao mesmo tempo, mas o fechamento (FOR UPDATE)
 * espera todas terminarem. Se o fechamento vencer, o WHERE é reavaliado
 * depois do commit dele e não volta linha (caixa fechado). Devolve o id ou null.
 */
export async function travarAbertoCompartilhado(lojaId, tx) {
  const [linha] = await tx.$queryRaw`
    SELECT "id" FROM "Caixa" WHERE "lojaId" = ${lojaId} AND "fechadoEm" IS NULL FOR SHARE`;
  return linha?.id ?? null;
}

/** Trava o caixa aberto da loja em modo EXCLUSIVO (fechamento). Devolve a linha ou null. */
export async function travarAbertoExclusivo(lojaId, tx) {
  const [linha] = await tx.$queryRaw`
    SELECT "id", "valorInicialCentavos" FROM "Caixa" WHERE "lojaId" = ${lojaId} AND "fechadoEm" IS NULL FOR UPDATE`;
  return linha ?? null;
}

export function criar({ lojaId, abertoPorId, valorInicialCentavos, abertoEm }, db = prisma) {
  return db.caixa.create({ data: { lojaId, abertoPorId, valorInicialCentavos, abertoEm }, select: SELECT_CAIXA });
}

export function buscarAberto(lojaId, db = prisma) {
  return db.caixa.findFirst({ where: { lojaId, fechadoEm: null }, select: SELECT_CAIXA });
}

export function buscarPorId(id, db = prisma) {
  return db.caixa.findUnique({ where: { id }, select: SELECT_CAIXA });
}

export function criarMovimento(dados, db = prisma) {
  return db.movimentoCaixa.create({ data: dados, select: SELECT_MOVIMENTO });
}

/** Soma dos pedidos FINALIZADOS em DINHEIRO neste caixa. */
export async function somarVendasEmDinheiro(caixaId, db = prisma) {
  const { _sum } = await db.pedido.aggregate({
    where: { caixaId, status: 'FINALIZADO', formaPagamento: 'DINHEIRO' },
    _sum: { totalCentavos: true },
  });
  return _sum.totalCentavos ?? 0;
}

/** { SANGRIA: n, SUPRIMENTO: n } em centavos. */
export async function somarMovimentos(caixaId, db = prisma) {
  const grupos = await db.movimentoCaixa.groupBy({
    by: ['tipo'],
    where: { caixaId },
    _sum: { valorCentavos: true },
  });
  const soma = { SANGRIA: 0, SUPRIMENTO: 0 };
  for (const g of grupos) soma[g.tipo] = g._sum.valorCentavos ?? 0;
  return soma;
}

/** Pedidos finalizados neste caixa por forma de pagamento: [{ forma, quantidade, totalCentavos }]. */
export async function totaisPorForma(caixaId, db = prisma) {
  const grupos = await db.pedido.groupBy({
    by: ['formaPagamento'],
    where: { caixaId, status: 'FINALIZADO' },
    _sum: { totalCentavos: true },
    _count: { _all: true },
  });
  return grupos.map((g) => ({
    forma: g.formaPagamento,
    quantidade: g._count._all,
    totalCentavos: g._sum.totalCentavos ?? 0,
  }));
}

/**
 * Pedidos ainda abertos da loja, de QUALQUER dia (comandas do salão, delivery e
 * site confirmados): bloqueiam o fechamento do caixa dela.
 */
export function pedidosAbertos(lojaId, statusAbertos, db = prisma) {
  return db.pedido.findMany({
    where: { lojaId, status: { in: statusAbertos } },
    select: {
      id: true,
      numeroDia: true,
      canal: true,
      status: true,
      nomeCliente: true,
      mesaRotulo: true,
      totalCentavos: true,
      formaPagamento: true,
      criadoEm: true,
      _count: { select: { itens: { where: { canceladoEm: null } } } },
    },
    orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
  });
}

export function fechar(id, dados, db = prisma) {
  return db.caixa.update({ where: { id }, data: dados, select: SELECT_CAIXA });
}

/** Caixas da loja abertos entre `inicio` (incluso) e `fim` (excluso), do mais antigo ao mais novo. */
export function listarAbertosEntre(lojaId, inicio, fim, db = prisma) {
  return db.caixa.findMany({
    where: { lojaId, abertoEm: { gte: inicio, lt: fim } },
    select: SELECT_CAIXA,
    orderBy: [{ abertoEm: 'asc' }, { id: 'asc' }],
  });
}
