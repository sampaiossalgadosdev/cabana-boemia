import { prisma } from '../lib/prisma.js';

/** Imagem guardada no banco (logo da loja). */
export function buscar(id, db = prisma) {
  return db.imagemLoja.findUnique({ where: { id } });
}

export function criar({ lojaId, mime, dados }, db = prisma) {
  return db.imagemLoja.create({ data: { lojaId, mime, dados }, select: { id: true } });
}

/** Apaga as imagens da loja que não estão nos ids informados (logo atual e padrão). */
export function apagarOutras(lojaId, manter, db = prisma) {
  return db.imagemLoja.deleteMany({ where: { lojaId, id: { notIn: manter } } });
}
