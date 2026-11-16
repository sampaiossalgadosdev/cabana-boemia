import { prisma } from '../lib/prisma.js';

/** Linha única (id = 1). */
export function buscar(db = prisma) {
  return db.configuracao.findUnique({ where: { id: 1 } });
}

/** Grava o tempo manual (ou limpa, com nulls); cria a linha única se faltar. */
export function definirTempoManual({ tempoEstimadoManualMin, tempoManualDefinidoEm }, db = prisma) {
  const dados = { tempoEstimadoManualMin, tempoManualDefinidoEm };
  return db.configuracao.upsert({
    where: { id: 1 },
    update: dados,
    create: { id: 1, ...dados },
  });
}

/** Dados gerais editados pelo dono; cria a linha única se faltar. */
export function atualizarGerais({ nomeRestaurante, whatsappNumero, tempoEstimadoPadraoMin, horaViradaDia }, db = prisma) {
  const dados = { nomeRestaurante, whatsappNumero, tempoEstimadoPadraoMin, horaViradaDia };
  return db.configuracao.upsert({ where: { id: 1 }, update: dados, create: { id: 1, ...dados } });
}
