import { prisma } from '../lib/prisma.js';

export function criar(dados, db = prisma) {
  return db.solicitacaoExclusao.create({ data: dados });
}

/** Pendentes primeiro (mais antigas no topo), depois as atendidas mais recentes; até 200. */
export async function listar(db = prisma) {
  const [pendentes, atendidas] = await Promise.all([
    db.solicitacaoExclusao.findMany({ where: { atendidaEm: null }, orderBy: { id: 'asc' }, take: 200 }),
    db.solicitacaoExclusao.findMany({ where: { atendidaEm: { not: null } }, orderBy: { atendidaEm: 'desc' }, take: 50 }),
  ]);
  return { pendentes, atendidas };
}

/** @returns {Promise<number>} 1 se marcou, 0 se não existe ou já estava atendida */
export async function marcarAtendida(id, db = prisma) {
  const r = await db.solicitacaoExclusao.updateMany({ where: { id, atendidaEm: null }, data: { atendidaEm: new Date() } });
  return r.count;
}
