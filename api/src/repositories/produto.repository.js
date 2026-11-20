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
  imagemUrl: true,
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

/** Todos os produtos da loja (inclusive inativos), na ordem do cardápio. */
export function listar(lojaId, db = prisma) {
  return db.produto.findMany({ where: { lojaId }, select: SELECT_PRODUTO, orderBy: ORDEM_CARDAPIO });
}

/** Produto da loja (de outra loja = null). */
export function buscarPorId(lojaId, id, db = prisma) {
  return db.produto.findFirst({ where: { id, lojaId }, select: SELECT_PRODUTO });
}

/** Só o necessário para decidir a transição de controle de estoque. */
export function buscarEstado(lojaId, id, db = prisma) {
  return db.produto.findFirst({ where: { id, lojaId }, select: { id: true, controlaEstoque: true, estoque: true } });
}

export function criar(lojaId, dados, db = prisma) {
  return db.produto.create({ data: { ...dados, lojaId }, select: { id: true } });
}

export function atualizar(lojaId, id, dados, db = prisma) {
  return db.produto.update({ where: { id, lojaId }, data: dados, select: { id: true } });
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

// Referências do produto precisam ser da mesma loja (de outra loja não contam).
export function contarCategorias(lojaId, ids, db = prisma) {
  return db.categoria.count({ where: { lojaId, id: { in: ids } } });
}

export function contarTurnos(lojaId, ids, db = prisma) {
  return db.turno.count({ where: { lojaId, id: { in: ids } } });
}

export function contarInsumos(lojaId, ids, db = prisma) {
  return db.insumo.count({ where: { lojaId, id: { in: ids } } });
}

// ───────── Cardápio do dia ─────────

/** Produtos ativos da loja no turno, de categoria ativa (o que pode aparecer hoje), com saldo. */
export function listarDoTurno(lojaId, turnoId, db = prisma) {
  return db.produto.findMany({
    where: { lojaId, ativo: true, categoria: { ativo: true }, turnos: { some: { turnoId } } },
    select: SELECT_PRODUTO,
    orderBy: ORDEM_CARDAPIO,
  });
}

export function definirCampo(lojaId, id, dados, db = prisma) {
  return db.produto.update({ where: { id, lojaId }, data: dados, select: SELECT_PRODUTO });
}

/** Liga disponivelHoje em todos os produtos ativos da loja no turno. */
export async function liberarTudo(lojaId, turnoId, db = prisma) {
  const { count } = await db.produto.updateMany({
    where: { lojaId, ativo: true, disponivelHoje: false, turnos: { some: { turnoId } } },
    data: { disponivelHoje: true },
  });
  return count;
}
