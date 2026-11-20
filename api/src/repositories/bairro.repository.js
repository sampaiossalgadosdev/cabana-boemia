import { prisma } from '../lib/prisma.js';

// ───────── Bairros da cidade (ADMIN) ─────────

const SELECT_CIDADE = { id: true, nome: true, ativo: true, _count: { select: { areas: true, enderecos: true } } };

/** Todos os bairros da cidade (inclusive inativos), por nome. */
export function listarCidade(db = prisma) {
  return db.bairro.findMany({ select: SELECT_CIDADE, orderBy: { nome: 'asc' } });
}

export function buscarCidade(id, db = prisma) {
  return db.bairro.findUnique({ where: { id }, select: { id: true, nome: true, ativo: true } });
}

export function criarCidade(dados, db = prisma) {
  return db.bairro.create({ data: dados, select: SELECT_CIDADE });
}

export function atualizarCidade(id, dados, db = prisma) {
  return db.bairro.update({ where: { id }, data: dados, select: SELECT_CIDADE });
}

/** Lojas que têm o bairro na área de entrega (para avisar o PDV de cada uma). */
export async function lojasDoBairro(bairroId, db = prisma) {
  return (await db.areaEntrega.findMany({ where: { bairroId }, select: { lojaId: true } })).map((a) => a.lojaId);
}

// ───────── Área de entrega da loja (DONO) ─────────

const SELECT_AREA = {
  bairroId: true,
  taxaCentavos: true,
  ativo: true,
  bairro: { select: { nome: true, ativo: true } },
};

/** Área de entrega da loja (inclusive inativa), por nome do bairro. */
export function listarArea(lojaId, db = prisma) {
  return db.areaEntrega.findMany({ where: { lojaId }, select: SELECT_AREA, orderBy: { bairro: { nome: 'asc' } } });
}

/** Bairros onde a loja entrega agora: área ativa e bairro ativo na cidade. */
export function listarAreaAtiva(lojaId, db = prisma) {
  return db.areaEntrega.findMany({
    where: { lojaId, ativo: true, bairro: { ativo: true } },
    select: SELECT_AREA,
    orderBy: { bairro: { nome: 'asc' } },
  });
}

/** Linha da área (ou null): onde a loja entrega e a taxa. */
export function buscarArea(lojaId, bairroId, db = prisma) {
  return db.areaEntrega.findUnique({ where: { lojaId_bairroId: { lojaId, bairroId } }, select: SELECT_AREA });
}

export function criarArea(lojaId, { bairroId, taxaCentavos, ativo = true }, db = prisma) {
  return db.areaEntrega.create({ data: { lojaId, bairroId, taxaCentavos, ativo }, select: SELECT_AREA });
}

/** De bairro fora da área = P2025 (não encontrado). */
export function atualizarArea(lojaId, bairroId, dados, db = prisma) {
  return db.areaEntrega.update({ where: { lojaId_bairroId: { lojaId, bairroId } }, data: dados, select: SELECT_AREA });
}
