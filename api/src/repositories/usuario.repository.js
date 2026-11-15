import { prisma } from '../lib/prisma.js';

/** Campos seguros para devolver ao cliente (nunca senhaHash). */
export const CAMPOS_PUBLICOS = {
  id: true,
  nome: true,
  email: true,
  papel: true,
  ativo: true,
  criadoEm: true,
};

export function buscarPorEmail(email, db = prisma) {
  return db.usuario.findUnique({ where: { email } });
}

export function buscarPorId(id, db = prisma) {
  return db.usuario.findUnique({ where: { id } });
}

export function criar(dados, db = prisma) {
  return db.usuario.create({ data: dados, select: CAMPOS_PUBLICOS });
}

export function listar(db = prisma) {
  return db.usuario.findMany({
    select: CAMPOS_PUBLICOS,
    orderBy: [{ papel: 'asc' }, { nome: 'asc' }],
  });
}

export function atualizar(id, dados, db = prisma) {
  return db.usuario.update({ where: { id }, data: dados, select: CAMPOS_PUBLICOS });
}
