import { prisma } from '../lib/prisma.js';

export function criar({ clienteId, hash, expiraEm }, db = prisma) {
  return db.refreshTokenCliente.create({ data: { clienteId, hash, expiraEm } });
}

export function buscarPorHash(hash, db = prisma) {
  return db.refreshTokenCliente.findUnique({ where: { hash }, include: { cliente: true } });
}

/** Revoga só se ainda ativo. 0 = outra requisição chegou antes (tratar como reuso). */
export async function revogarSeAtivo(id, db = prisma) {
  const r = await db.refreshTokenCliente.updateMany({ where: { id, revogadoEm: null }, data: { revogadoEm: new Date() } });
  return r.count;
}

export async function revogarPorHash(hash, db = prisma) {
  const r = await db.refreshTokenCliente.updateMany({ where: { hash, revogadoEm: null }, data: { revogadoEm: new Date() } });
  return r.count;
}

export async function revogarTodosDoCliente(clienteId, db = prisma) {
  const r = await db.refreshTokenCliente.updateMany({
    where: { clienteId, revogadoEm: null },
    data: { revogadoEm: new Date() },
  });
  return r.count;
}
