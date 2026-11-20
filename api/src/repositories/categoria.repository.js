import { prisma } from '../lib/prisma.js';

const SELECT_CATEGORIA = {
  id: true,
  nome: true,
  ordem: true,
  ativo: true,
  _count: { select: { produtos: true } },
};

/** Todas as categorias da loja (inclusive inativas), na ordem do cardápio. */
export function listar(lojaId, db = prisma) {
  return db.categoria.findMany({ where: { lojaId }, select: SELECT_CATEGORIA, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] });
}

export function buscarPorId(lojaId, id, db = prisma) {
  return db.categoria.findFirst({ where: { id, lojaId }, select: SELECT_CATEGORIA });
}

export function criar(lojaId, dados, db = prisma) {
  return db.categoria.create({ data: { ...dados, lojaId }, select: SELECT_CATEGORIA });
}

/** Só da loja: de outra loja = P2025 (não encontrada). */
export function atualizar(lojaId, id, dados, db = prisma) {
  return db.categoria.update({ where: { id, lojaId }, data: dados, select: SELECT_CATEGORIA });
}
