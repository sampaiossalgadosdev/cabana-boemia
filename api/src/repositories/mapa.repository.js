import { prisma } from '../lib/prisma.js';

/**
 * Reserva uma chamada do dia ao serviço, sem passar do limite: INSERT … ON
 * CONFLICT com o UPDATE condicionado (atômico, várias requisições ao mesmo
 * tempo não passam do limite). Devolve o total do dia com esta chamada, ou
 * null se o limite já tinha sido atingido.
 * @param {string} dia "YYYY-MM-DD" (dia civil de Brasília)
 */
export async function reservarChamada(dia, servico, limite, db = prisma) {
  if (!(limite > 0)) return null;
  const linhas = await db.$queryRaw`
    INSERT INTO "UsoMapa" ("dia", "servico", "chamadas") VALUES (${dia}::date, ${servico}, 1)
    ON CONFLICT ("dia", "servico") DO UPDATE SET "chamadas" = "UsoMapa"."chamadas" + 1
      WHERE "UsoMapa"."chamadas" < ${limite}
    RETURNING "chamadas"`;
  return linhas[0]?.chamadas ?? null;
}

/** Uso entre os dias dados (inclusive), mais novo primeiro. */
export function usoEntre(desde, ate, db = prisma) {
  return db.usoMapa.findMany({ where: { dia: { gte: desde, lte: ate } }, orderBy: [{ dia: 'desc' }, { servico: 'asc' }] });
}

/** Distância em cache, só se for mais nova que `validoDesde`. */
export async function buscarRota(chave, validoDesde, db = prisma) {
  const r = await db.cacheRota.findUnique({ where: { origemLat_origemLng_destinoLat_destinoLng: chave } });
  return r && r.criadoEm >= validoDesde ? r.distanciaMetros : null;
}

export function guardarRota(chave, distanciaMetros, agora, db = prisma) {
  return db.cacheRota.upsert({
    where: { origemLat_origemLng_destinoLat_destinoLng: chave },
    create: { ...chave, distanciaMetros, criadoEm: agora },
    update: { distanciaMetros, criadoEm: agora },
  });
}

/** Apaga o cache vencido (o Google limita por quanto tempo o resultado pode ficar guardado). */
export function apagarRotasAntigas(antesDe, db = prisma) {
  return db.cacheRota.deleteMany({ where: { criadoEm: { lt: antesDe } } });
}

/** Pino da loja (origem da distância). */
export function pinDaLoja(lojaId, db = prisma) {
  return db.loja.findUnique({ where: { id: lojaId }, select: { latitude: true, longitude: true } });
}
