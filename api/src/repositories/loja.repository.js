import { prisma } from '../lib/prisma.js';

/** Loja com a configuração (nome, WhatsApp, tempo estimado, virada do dia, frete grátis). */
export function buscarPorId(id, db = prisma) {
  return db.loja.findUnique({ where: { id } });
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
