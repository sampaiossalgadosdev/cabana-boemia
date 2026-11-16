import { prisma } from '../lib/prisma.js';

const SELECT_BAIRRO = { id: true, nome: true, taxaCentavos: true, ativo: true };

/** Todos os bairros (inclusive inativos), por nome. */
export function listar(db = prisma) {
  return db.bairro.findMany({ select: SELECT_BAIRRO, orderBy: { nome: 'asc' } });
}

export function criar(dados, db = prisma) {
  return db.bairro.create({ data: dados, select: SELECT_BAIRRO });
}

export function atualizar(id, dados, db = prisma) {
  return db.bairro.update({ where: { id }, data: dados, select: SELECT_BAIRRO });
}
