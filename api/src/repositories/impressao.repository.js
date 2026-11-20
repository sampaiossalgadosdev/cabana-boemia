import { prisma } from '../lib/prisma.js';
import { SELECT_PEDIDO } from './pedido.repository.js';

const SELECT_TRABALHO = {
  id: true,
  tipo: true,
  status: true,
  tentativas: true,
  ultimoErro: true,
  criadoEm: true,
  impressoEm: true,
  pedidoId: true,
  caixaId: true,
  dataRelatorio: true,
  reservadoPor: true,
  reservadoAte: true,
};

/** Livre para pegar: sem reserva ou com a reserva vencida. */
const livre = (agora) => ({ OR: [{ reservadoAte: null }, { reservadoAte: { lt: agora } }] });

/**
 * Pendentes da loja criados a partir de `desde`, do mais antigo para o mais novo
 * (ordem de impressão), SEM os reservados por um agente (reserva ainda valendo).
 */
export function listarPendentes({ lojaId, desde, limite, agora }, db = prisma) {
  return db.trabalhoImpressao.findMany({
    where: { lojaId, status: 'PENDENTE', criadoEm: { gte: desde }, ...livre(agora) },
    select: { ...SELECT_TRABALHO, pedido: { select: SELECT_PEDIDO } },
    orderBy: { id: 'asc' },
    take: limite,
  });
}

/** Trabalho da loja (de outra loja = null). */
export function buscar(lojaId, id, db = prisma) {
  return db.trabalhoImpressao.findFirst({ where: { id, lojaId }, select: SELECT_TRABALHO });
}

/**
 * Marca impresso só se ainda não estava (UPDATE condicionado): confirmar de
 * novo não muda nada, nem o `impressoEm`. Devolve quantas linhas mudaram.
 */
export async function confirmarSeNaoImpresso(lojaId, id, agora, db = prisma) {
  const { count } = await db.trabalhoImpressao.updateMany({
    where: { id, lojaId, status: { not: 'IMPRESSO' } },
    data: { status: 'IMPRESSO', impressoEm: agora, ultimoErro: null, reservadoPor: null, reservadoAte: null },
  });
  return count;
}

/**
 * Reserva ATÔMICA: marca até `limite` pendentes livres da loja (sem reserva,
 * reserva vencida ou já deste agente) como do `agente` até `ate`, em ordem de id.
 * `FOR UPDATE SKIP LOCKED`: dois agentes reservando ao mesmo tempo nunca pegam o
 * mesmo trabalho (o segundo pula as linhas travadas pelo primeiro).
 * Datas vão como texto UTC com `::timestamp`: as colunas são TIMESTAMP sem fuso (UTC,
 * como o Prisma grava) e um Date cru viraria timestamptz, convertido pelo fuso da sessão.
 * @returns {Promise<number[]>} ids reservados, em ordem
 */
export async function reservarPendentes({ lojaId, agente, desde, agora, ate, limite }, db = prisma) {
  const utc = (d) => d.toISOString().replace('Z', '');
  const linhas = await db.$queryRaw`
    UPDATE "TrabalhoImpressao" SET "reservadoPor" = ${agente}, "reservadoAte" = ${utc(ate)}::timestamp
    WHERE "id" IN (
      SELECT "id" FROM "TrabalhoImpressao"
      WHERE "lojaId" = ${lojaId} AND "status" = 'PENDENTE' AND "criadoEm" >= ${utc(desde)}::timestamp
        AND ("reservadoAte" IS NULL OR "reservadoAte" < ${utc(agora)}::timestamp OR "reservadoPor" = ${agente})
      ORDER BY "id"
      LIMIT ${limite}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  return linhas.map((l) => l.id).sort((a, b) => a - b);
}

/** Trabalhos pelos ids (com o pedido), em ordem de id. */
export function buscarVarios(lojaId, ids, db = prisma) {
  return db.trabalhoImpressao.findMany({
    where: { lojaId, id: { in: ids } },
    select: { ...SELECT_TRABALHO, pedido: { select: SELECT_PEDIDO } },
    orderBy: { id: 'asc' },
  });
}

/** Falha só conta em trabalho ainda pendente. */
/** Falha libera a reserva: o trabalho volta para a fila (o agente tenta de novo depois). */
export async function registrarFalhaSePendente(lojaId, id, ultimoErro, db = prisma) {
  const { count } = await db.trabalhoImpressao.updateMany({
    where: { id, lojaId, status: 'PENDENTE' },
    data: { tentativas: { increment: 1 }, ultimoErro, reservadoPor: null, reservadoAte: null },
  });
  return count;
}
