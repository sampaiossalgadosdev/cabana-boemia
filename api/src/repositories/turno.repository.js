import { prisma } from '../lib/prisma.js';

/** Turnos ativos com seus horários; ordem por id desempata sobreposição. */
export function listarAtivosComHorarios(db = prisma) {
  return db.turno.findMany({
    where: { ativo: true },
    select: {
      id: true,
      nome: true,
      horarios: { select: { diaSemana: true, inicio: true, fim: true } },
    },
    orderBy: { id: 'asc' },
  });
}
