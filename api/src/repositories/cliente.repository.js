import { prisma } from '../lib/prisma.js';

export function buscarPorId(id, db = prisma) {
  return db.cliente.findUnique({ where: { id } });
}

/** Cria pelo googleId ou, se já existe, atualiza só o que vem em `atualizar`. */
export function upsertPorGoogleId(googleId, { criar, atualizar }, db = prisma) {
  return db.cliente.upsert({
    where: { googleId },
    create: { googleId, ...criar },
    update: atualizar,
  });
}

export function atualizar(id, dados, db = prisma) {
  return db.cliente.update({ where: { id }, data: dados });
}
