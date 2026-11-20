import { prisma } from '../lib/prisma.js';

const SELECT_BAIRRO = { id: true, nome: true, taxaCentavos: true, ativo: true };

/** Todos os bairros da loja (inclusive inativos), por nome. */
export function listar(lojaId, db = prisma) {
  return db.bairro.findMany({ where: { lojaId }, select: SELECT_BAIRRO, orderBy: { nome: 'asc' } });
}

export function criar(lojaId, dados, db = prisma) {
  return db.bairro.create({ data: { ...dados, lojaId }, select: SELECT_BAIRRO });
}

/** Só da loja: de outra loja = P2025 (não encontrado). */
export function atualizar(lojaId, id, dados, db = prisma) {
  return db.bairro.update({ where: { id, lojaId }, data: dados, select: SELECT_BAIRRO });
}
