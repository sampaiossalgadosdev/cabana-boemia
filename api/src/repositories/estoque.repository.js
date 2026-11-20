import { prisma } from '../lib/prisma.js';

const SELECT_INSUMO = {
  id: true,
  nome: true,
  estoque: true,
  estoqueMinimo: true,
  produtos: { select: { produto: { select: { id: true, nome: true } } }, orderBy: { produtoId: 'asc' } },
};

/** Produtos da loja com estoque próprio (bebidas etc.), inclusive inativos. */
export function listarProdutosComEstoque(lojaId, db = prisma) {
  return db.produto.findMany({
    where: { lojaId, controlaEstoque: true },
    select: {
      id: true,
      nome: true,
      ativo: true,
      estoque: true,
      estoqueMinimo: true,
      categoria: { select: { id: true, nome: true } },
    },
    orderBy: [{ categoria: { ordem: 'asc' } }, { ordem: 'asc' }, { nome: 'asc' }],
  });
}

export function listarInsumos(lojaId, db = prisma) {
  return db.insumo.findMany({ where: { lojaId }, select: SELECT_INSUMO, orderBy: { nome: 'asc' } });
}

export function buscarInsumo(lojaId, id, db = prisma) {
  return db.insumo.findFirst({ where: { id, lojaId }, select: SELECT_INSUMO });
}

export function criarInsumo(lojaId, dados, db = prisma) {
  return db.insumo.create({ data: { ...dados, lojaId }, select: SELECT_INSUMO });
}

/** Só da loja: de outra loja = P2025 (não encontrado). */
export function atualizarInsumo(lojaId, id, dados, db = prisma) {
  return db.insumo.update({ where: { id, lojaId }, data: dados, select: SELECT_INSUMO });
}

// ───────── Saldo (sempre atômico) ─────────

/** Entrada: incremento atômico. Produto só se controla estoque. @returns count */
export async function somarProduto(lojaId, id, quantidade, db = prisma) {
  const { count } = await db.produto.updateMany({
    where: { id, lojaId, controlaEstoque: true },
    data: { estoque: { increment: quantidade } },
  });
  return count;
}

export async function somarInsumo(lojaId, id, quantidade, db = prisma) {
  const { count } = await db.insumo.updateMany({ where: { id, lojaId }, data: { estoque: { increment: quantidade } } });
  return count;
}

/**
 * Trava a linha (FOR UPDATE) e devolve o saldo atual. Baixas concorrentes
 * (pedido, comanda) esperam o ajuste terminar e reavaliam `estoque >= qtd`.
 * @returns {Promise<{ id: number, nome: string, estoque: number|null, controlaEstoque: boolean } | null>}
 */
export async function travarProduto(lojaId, id, db) {
  const [linha] = await db.$queryRaw`
    SELECT "id", "nome", "estoque", "controlaEstoque" FROM "Produto" WHERE "id" = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
  return linha ?? null;
}

export async function travarInsumo(lojaId, id, db) {
  const [linha] = await db.$queryRaw`
    SELECT "id", "nome", "estoque" FROM "Insumo" WHERE "id" = ${id} AND "lojaId" = ${lojaId} FOR UPDATE`;
  return linha ? { ...linha, controlaEstoque: true } : null;
}

export function definirSaldoProduto(id, estoque, db) {
  return db.produto.update({ where: { id }, data: { estoque }, select: { id: true } });
}

export function definirSaldoInsumo(id, estoque, db) {
  return db.insumo.update({ where: { id }, data: { estoque }, select: { id: true } });
}

export function saldoProduto(lojaId, id, db = prisma) {
  return db.produto.findFirst({ where: { id, lojaId }, select: { id: true, nome: true, estoque: true, estoqueMinimo: true } });
}

export function saldoInsumo(lojaId, id, db = prisma) {
  return db.insumo.findFirst({ where: { id, lojaId }, select: { id: true, nome: true, estoque: true, estoqueMinimo: true } });
}

// ───────── Histórico ─────────

const SELECT_MOVIMENTACAO = {
  id: true,
  tipo: true,
  quantidade: true,
  motivo: true,
  criadoEm: true,
  produto: { select: { id: true, nome: true } },
  insumo: { select: { id: true, nome: true } },
  usuario: { select: { id: true, nome: true } },
  itemPedido: { select: { pedido: { select: { id: true, numeroDia: true, dataRef: true, canal: true } } } },
};

export function criarMovimentacao(dados, db = prisma) {
  return db.movimentacaoEstoque.create({ data: dados, select: SELECT_MOVIMENTACAO });
}

/**
 * Movimentações da loja (do produto ou do insumo dela), mais recentes primeiro,
 * paginado por id (`antesDeId`).
 * @param {{ lojaId: number, produtoId?: number, insumoId?: number, tipo?: string, antesDeId?: number, limite: number }} filtro
 */
export function listarMovimentacoes({ lojaId, produtoId, insumoId, tipo, antesDeId, limite }, db = prisma) {
  return db.movimentacaoEstoque.findMany({
    where: {
      OR: [{ produto: { lojaId } }, { insumo: { lojaId } }],
      ...(produtoId && { produtoId }),
      ...(insumoId && { insumoId }),
      ...(tipo && { tipo }),
      ...(antesDeId && { id: { lt: antesDeId } }),
    },
    select: SELECT_MOVIMENTACAO,
    orderBy: { id: 'desc' },
    take: limite,
  });
}
