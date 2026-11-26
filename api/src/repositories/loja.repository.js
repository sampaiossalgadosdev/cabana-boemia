import { prisma } from '../lib/prisma.js';

/** Loja com a configuração (nome, WhatsApp, tempo estimado, virada do dia, frete grátis). */
export function buscarPorId(id, db = prisma) {
  return db.loja.findUnique({ where: { id } });
}

/** Situação da conexão da loja com o Mercado Pago (sem os tokens), ou null. */
export function buscarConexaoMp(lojaId, db = prisma) {
  return db.conexaoMercadoPago.findUnique({ where: { lojaId }, select: { status: true } });
}

export function buscarPorSlug(slug, db = prisma) {
  return db.loja.findUnique({ where: { slug } });
}

/** Grava o tempo manual do dia (ou limpa, com nulls). */
export function definirTempoManual(id, { tempoEstimadoManualMin, tempoManualDefinidoEm }, db = prisma) {
  return db.loja.update({ where: { id }, data: { tempoEstimadoManualMin, tempoManualDefinidoEm } });
}

/** Dados gerais editados pelo dono na retaguarda (Configurações). */
export function atualizarGerais(
  id,
  {
    nomeRestaurante,
    whatsappNumero,
    tempoEstimadoPadraoMin,
    horaViradaDia,
    freteGratisAtivo,
    freteGratisMinimoCentavos,
    freteGratisWhatsapp,
  },
  db = prisma,
) {
  return db.loja.update({
    where: { id },
    data: {
      nome: nomeRestaurante,
      whatsapp: whatsappNumero,
      tempoEstimadoPadraoMin,
      horaViradaDia,
      freteGratisAtivo,
      freteGratisMinimoCentavos,
      freteGratisWhatsapp,
    },
  });
}

/** Lojas ativas na ordem da vitrine (ordem, nome). */
export function listarAtivas(db = prisma) {
  return db.loja.findMany({ where: { ativa: true }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] });
}

/** Todas as lojas (ADMIN), com quantos usuários e pedidos têm. */
export function listarTodas(db = prisma) {
  return db.loja.findMany({
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    include: {
      _count: { select: { usuarios: true, pedidos: true } },
      conexaoMercadoPago: { select: { status: true, mpUserId: true } },
    },
  });
}

export function criar(dados, db = prisma) {
  return db.loja.create({ data: dados });
}

export function atualizar(id, dados, db = prisma) {
  return db.loja.update({ where: { id }, data: dados });
}
