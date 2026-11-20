import { prisma } from '../lib/prisma.js';

/** Turnos ativos da loja com seus horários; ordem por id desempata sobreposição. */
export function listarAtivosComHorarios(lojaId, db = prisma) {
  return db.turno.findMany({
    where: { lojaId, ativo: true },
    select: {
      id: true,
      nome: true,
      horarios: { select: { diaSemana: true, inicio: true, fim: true } },
    },
    orderBy: { id: 'asc' },
  });
}

/** Todos os turnos da loja (inclusive inativos) com horários, para a retaguarda. */
export function listarComHorarios(lojaId, db = prisma) {
  return db.turno.findMany({
    where: { lojaId },
    select: {
      id: true,
      nome: true,
      ativo: true,
      horarios: {
        select: { id: true, diaSemana: true, inicio: true, fim: true },
        orderBy: [{ diaSemana: 'asc' }, { inicio: 'asc' }],
      },
    },
    orderBy: { id: 'asc' },
  });
}

/** Troca todos os horários do turno pela lista dada (usar dentro de transação). */
export async function substituirHorarios(turnoId, horarios, db = prisma) {
  await db.horarioTurno.deleteMany({ where: { turnoId } });
  if (horarios.length) {
    await db.horarioTurno.createMany({ data: horarios.map((h) => ({ turnoId, ...h })) });
  }
}

/** Serializa edições de horários da loja (duas abas salvando ao mesmo tempo não burlam a checagem de sobreposição). */
export function travarTurnos(lojaId, db) {
  return db.$queryRaw`SELECT "id" FROM "Turno" WHERE "lojaId" = ${lojaId} ORDER BY "id" FOR UPDATE`;
}
