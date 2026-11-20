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
};

/** Pendentes da loja criados a partir de `desde`, do mais antigo para o mais novo (ordem de impressão). */
export function listarPendentes({ lojaId, desde, limite }, db = prisma) {
  return db.trabalhoImpressao.findMany({
    where: { lojaId, status: 'PENDENTE', criadoEm: { gte: desde } },
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
    data: { status: 'IMPRESSO', impressoEm: agora, ultimoErro: null },
  });
  return count;
}

/** Falha só conta em trabalho ainda pendente. */
export async function registrarFalhaSePendente(lojaId, id, ultimoErro, db = prisma) {
  const { count } = await db.trabalhoImpressao.updateMany({
    where: { id, lojaId, status: 'PENDENTE' },
    data: { tentativas: { increment: 1 }, ultimoErro },
  });
  return count;
}
