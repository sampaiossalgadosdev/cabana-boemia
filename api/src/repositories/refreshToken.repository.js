import { prisma } from '../lib/prisma.js';

export function criar({ usuarioId, hash, expiraEm }, db = prisma) {
  return db.refreshToken.create({ data: { usuarioId, hash, expiraEm } });
}

export function buscarPorHash(hash, db = prisma) {
  return db.refreshToken.findUnique({ where: { hash }, include: { usuario: true } });
}

/**
 * Revoga um token só se ainda não estiver revogado. Devolve quantos foram
 * revogados (0 = outra requisição chegou antes → tratar como reuso).
 */
export async function revogarSeAtivo(id, db = prisma) {
  const r = await db.refreshToken.updateMany({
    where: { id, revogadoEm: null },
    data: { revogadoEm: new Date() },
  });
  return r.count;
}

export async function revogarPorHash(hash, db = prisma) {
  const r = await db.refreshToken.updateMany({
    where: { hash, revogadoEm: null },
    data: { revogadoEm: new Date() },
  });
  return r.count;
}

export async function revogarTodosDoUsuario(usuarioId, db = prisma) {
  const r = await db.refreshToken.updateMany({
    where: { usuarioId, revogadoEm: null },
    data: { revogadoEm: new Date() },
  });
  return r.count;
}
