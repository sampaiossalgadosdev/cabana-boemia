import { prisma } from '../lib/prisma.js';

const comLoja = { destinoLoja: { select: { id: true, slug: true, nome: true, ativa: true } } };

/** Todos (retaguarda da plataforma), do mais novo para o mais antigo. */
export function listar(db = prisma) {
  return db.anuncio.findMany({ include: comLoja, orderBy: [{ inicio: 'desc' }, { id: 'desc' }] });
}

export function buscar(id, db = prisma) {
  return db.anuncio.findUnique({ where: { id }, include: comLoja });
}

/** No ar agora: ativo e `inicio <= agora < fim` (a loja de destino é conferida no service). */
export function noAr(agora, limite, db = prisma) {
  return db.anuncio.findMany({
    where: { ativo: true, inicio: { lte: agora }, fim: { gt: agora } },
    include: comLoja,
    orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
    take: limite,
  });
}

export function criar(dados, db = prisma) {
  return db.anuncio.create({ data: dados, include: comLoja });
}

export function atualizar(id, dados, db = prisma) {
  return db.anuncio.update({ where: { id }, data: dados, include: comLoja });
}

export function criarImagem({ mime, dados }, db = prisma) {
  return db.imagemAnuncio.create({ data: { mime, dados }, select: { id: true } });
}

export function buscarImagem(id, db = prisma) {
  return db.imagemAnuncio.findUnique({ where: { id } });
}

export async function imagemExiste(id, db = prisma) {
  return (await db.imagemAnuncio.count({ where: { id } })) > 0;
}

/**
 * Apaga imagens que nenhum anúncio usa: a `id` (trocada agora) e as enviadas
 * antes de `antesDe` sem virar anúncio (formulário abandonado).
 */
export function apagarSoltas({ id, antesDe }, db = prisma) {
  const OR = [];
  if (id != null) OR.push({ id });
  if (antesDe) OR.push({ criadoEm: { lt: antesDe } });
  if (!OR.length) return Promise.resolve({ count: 0 });
  return db.imagemAnuncio.deleteMany({ where: { anuncios: { none: {} }, OR } });
}
