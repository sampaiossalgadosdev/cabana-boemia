import { prisma } from '../lib/prisma.js';

const SELECT = {
  id: true,
  tipo: true,
  mensagem: true,
  criadoEm: true,
  resolvidoEm: true,
  pedidoId: true,
  fechamentoId: true,
  loja: { select: { id: true, nome: true, slug: true } },
  resolvidoPor: { select: { nome: true } },
};

export function criar(dados, db = prisma) {
  return db.alertaPlataforma.create({ data: dados });
}

export function listarAbertos(db = prisma) {
  return db.alertaPlataforma.findMany({ where: { resolvidoEm: null }, orderBy: { id: 'desc' }, select: SELECT });
}

export function listarResolvidos(limite, db = prisma) {
  return db.alertaPlataforma.findMany({ where: { resolvidoEm: { not: null } }, orderBy: { resolvidoEm: 'desc' }, take: limite, select: SELECT });
}

export function contarAbertos(db = prisma) {
  return db.alertaPlataforma.count({ where: { resolvidoEm: null } });
}

/** Resolve só se ainda aberto; devolve o count (0 = inexistente ou já resolvido). */
export async function resolverSeAberto(id, usuarioId, agora, db = prisma) {
  const { count } = await db.alertaPlataforma.updateMany({
    where: { id, resolvidoEm: null },
    data: { resolvidoEm: agora, resolvidoPorId: usuarioId },
  });
  return count;
}

/** Já existe alerta aberto deste tipo para a loja (desde `desde`, se dado)? */
export function existeAberto({ tipo, lojaId = null, pedidoId = null, desde = null }, db = prisma) {
  return db.alertaPlataforma.findFirst({
    where: {
      tipo,
      resolvidoEm: null,
      ...(lojaId != null && { lojaId }),
      ...(pedidoId != null && { pedidoId }),
      ...(desde && { criadoEm: { gte: desde } }),
    },
    select: { id: true },
  });
}
