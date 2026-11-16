import { prisma } from '../lib/prisma.js';

const SELECT_CATEGORIA = {
  id: true,
  nome: true,
  ordem: true,
  ativo: true,
  _count: { select: { produtos: true } },
};

/** Todas as categorias (inclusive inativas), na ordem do cardápio. */
export function listar(db = prisma) {
  return db.categoria.findMany({ select: SELECT_CATEGORIA, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] });
}

export function buscarPorId(id, db = prisma) {
  return db.categoria.findUnique({ where: { id }, select: SELECT_CATEGORIA });
}

export function criar(dados, db = prisma) {
  return db.categoria.create({ data: dados, select: SELECT_CATEGORIA });
}

export function atualizar(id, dados, db = prisma) {
  return db.categoria.update({ where: { id }, data: dados, select: SELECT_CATEGORIA });
}
