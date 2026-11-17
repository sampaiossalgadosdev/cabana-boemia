import { prisma } from '../lib/prisma.js';

/** Produto completo para a retaguarda (com turnos e insumos da receita). */
export const SELECT_PRODUTO = {
  id: true,
  nome: true,
  descricao: true,
  categoriaId: true,
  tipoPreco: true,
  precoCentavos: true,
  ativo: true,
  disponivelHoje: true,
  vendidoNoSite: true,
  sugerirNaSacola: true,
  controlaEstoque: true,
  estoque: true,
  estoqueMinimo: true,
  ordem: true,
  categoria: { select: { id: true, nome: true, ativo: true } },
  turnos: { select: { turno: { select: { id: true, nome: true } } }, orderBy: { turnoId: 'asc' } },
  insumos: {
    select: { quantidade: true, insumo: { select: { id: true, nome: true, estoque: true } } },
    orderBy: { insumoId: 'asc' },
  },
};

const ORDEM_CARDAPIO = [{ categoria: { ordem: 'asc' } }, { ordem: 'asc' }, { nome: 'asc' }];

/** Todos os produtos (inclusive inativos), na ordem do cardápio. */
export function listar(db = prisma) {
  return db.produto.findMany({ select: SELECT_PRODUTO, orderBy: ORDEM_CARDAPIO });
}

export function buscarPorId(id, db = prisma) {
  return db.produto.findUnique({ where: { id }, select: SELECT_PRODUTO });
}

/** Só o necessário para decidir a transição de controle de estoque. */
export function buscarEstado(id, db = prisma) {
  return db.produto.findUnique({ where: { id }, select: { id: true, controlaEstoque: true, estoque: true } });
}

export function criar(dados, db = prisma) {
  return db.produto.create({ data: dados, select: { id: true } });
}

export function atualizar(id, dados, db = prisma) {
  return db.produto.update({ where: { id }, data: dados, select: { id: true } });
}

/** Troca os turnos do produto pela lista dada. */
export async function definirTurnos(produtoId, turnoIds, db = prisma) {
  await db.produtoTurno.deleteMany({ where: { produtoId } });
  if (turnoIds.length) {
    await db.produtoTurno.createMany({ data: turnoIds.map((turnoId) => ({ produtoId, turnoId })) });
  }
}

/** Troca a receita (insumos consumidos por unidade) pela lista dada. */
export async function definirInsumos(produtoId, insumos, db = prisma) {
  await db.produtoInsumo.deleteMany({ where: { produtoId } });
  if (insumos.length) {
    await db.produtoInsumo.createMany({
      data: insumos.map((i) => ({ produtoId, insumoId: i.insumoId, quantidade: i.quantidade })),
    });
  }
}

export function contarCategorias(ids, db = prisma) {
  return db.categoria.count({ where: { id: { in: ids } } });
}

export function contarTurnos(ids, db = prisma) {
  return db.turno.count({ where: { id: { in: ids } } });
}

export function contarInsumos(ids, db = prisma) {
  return db.insumo.count({ where: { id: { in: ids } } });
}

// ───────── Cardápio do dia ─────────

/** Produtos ativos do turno, de categoria ativa (o que pode aparecer hoje), com saldo. */
export function listarDoTurno(turnoId, db = prisma) {
  return db.produto.findMany({
    where: { ativo: true, categoria: { ativo: true }, turnos: { some: { turnoId } } },
    select: SELECT_PRODUTO,
    orderBy: ORDEM_CARDAPIO,
  });
}

export function definirCampo(id, dados, db = prisma) {
  return db.produto.update({ where: { id }, data: dados, select: SELECT_PRODUTO });
}

/** Liga disponivelHoje em todos os produtos ativos do turno. */
export async function liberarTudo(turnoId, db = prisma) {
  const { count } = await db.produto.updateMany({
    where: { ativo: true, disponivelHoje: false, turnos: { some: { turnoId } } },
    data: { disponivelHoje: true },
  });
  return count;
}
