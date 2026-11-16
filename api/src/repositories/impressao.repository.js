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
};

/** Pendentes criados a partir de `desde`, do mais antigo para o mais novo (ordem de impressão). */
export function listarPendentes({ desde, limite }, db = prisma) {
  return db.trabalhoImpressao.findMany({
    where: { status: 'PENDENTE', criadoEm: { gte: desde } },
    select: { ...SELECT_TRABALHO, pedido: { select: SELECT_PEDIDO } },
    orderBy: { id: 'asc' },
    take: limite,
  });
}

export function buscar(id, db = prisma) {
  return db.trabalhoImpressao.findUnique({ where: { id }, select: SELECT_TRABALHO });
}

/**
 * Marca impresso só se ainda não estava (UPDATE condicionado): confirmar de
 * novo não muda nada, nem o `impressoEm`. Devolve quantas linhas mudaram.
 */
export async function confirmarSeNaoImpresso(id, agora, db = prisma) {
  const { count } = await db.trabalhoImpressao.updateMany({
    where: { id, status: { not: 'IMPRESSO' } },
    data: { status: 'IMPRESSO', impressoEm: agora, ultimoErro: null },
  });
  return count;
}

/** Falha só conta em trabalho ainda pendente. */
export async function registrarFalhaSePendente(id, ultimoErro, db = prisma) {
  const { count } = await db.trabalhoImpressao.updateMany({
    where: { id, status: 'PENDENTE' },
    data: { tentativas: { increment: 1 }, ultimoErro },
  });
  return count;
}
