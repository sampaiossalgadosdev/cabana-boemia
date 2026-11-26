/**
 * Campanha de frete grátis da primeira compra (custo da plataforma). Decisões 4, 16 e
 * as da Etapa 2 em docs/pagamento-online.md:
 *
 * - um por telefone VERIFICADO por código (sem telefone verificado, não ganha), e só se o
 *   telefone (ou o cliente) nunca teve pedido FINALIZADO: é a PRIMEIRA compra (Decisão 6 da Etapa 3);
 * - a tabela guarda só o HMAC-SHA256 do telefone (CAMPANHA_TELEFONE_SECRET), nunca o número:
 *   a regra sobrevive à exclusão da conta sem manter o telefone (Decisão 7 da Etapa 3);
 * - só no app (quem chama confere o canal; não vale no PDV nem no site);
 * - RESERVADA na criação do pedido (dois pedidos ao mesmo tempo não usam a mesma);
 * - USADA na aprovação do pagamento online ou na finalização do pedido pago na entrega;
 * - LIBERADA (linha apagada) se o pedido expirar ou for cancelado, inclusive depois do aceite.
 *
 * Tudo dentro da transação de quem chama (`tx`). A ligação com a criação e a aprovação
 * do pedido é da etapa 4; finalizar e cancelar já chamam `usar`/`liberar`.
 */
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { problemaNoSegredo } from '../lib/pagamentoOnline.js';

/** HMAC-SHA256 (hex) do telefone, só com os dígitos. Sem o segredo válido, lança. */
export function hashTelefone(telefone, env = process.env) {
  const problema = problemaNoSegredo('CAMPANHA_TELEFONE_SECRET', env);
  if (problema) throw new Error(`Campanha de frete grátis: ${problema}`);
  return createHmac('sha256', env.CAMPANHA_TELEFONE_SECRET).update(String(telefone).replace(/\D/g, '')).digest('hex');
}

/**
 * O cliente ainda pode ganhar a campanha? Telefone verificado, sem reserva nem uso daquele
 * telefone e nenhum pedido FINALIZADO anterior (do telefone ou do próprio cliente).
 */
export async function campanhaElegivel(cliente, tx, env = process.env) {
  if (!cliente?.telefoneVerificado || !cliente.telefone) return false;
  if ((await tx.usoCampanhaFreteGratis.count({ where: { telefoneHash: hashTelefone(cliente.telefone, env) } })) > 0) return false;
  const jaComprou = await tx.pedido.count({
    where: {
      status: 'FINALIZADO',
      OR: [{ telefone: cliente.telefone }, ...(Number.isInteger(cliente.id) ? [{ clienteId: cliente.id }] : [])],
    },
  });
  return jaComprou === 0;
}

/**
 * Reserva a campanha para o pedido. Devolve false se o telefone já tem reserva ou uso
 * (inclusive numa corrida com outro pedido do mesmo telefone).
 */
export async function reservarCampanha(tx, { telefone, clienteId = null, pedidoId, agora = new Date() }, env = process.env) {
  const telefoneHash = hashTelefone(telefone, env);
  try {
    // SAVEPOINT: o erro do único não pode abortar a transação de quem chama.
    await tx.$executeRaw`SAVEPOINT reserva_campanha`;
    await tx.usoCampanhaFreteGratis.create({ data: { telefoneHash, clienteId, pedidoId, reservadoEm: agora } });
    await tx.$executeRaw`RELEASE SAVEPOINT reserva_campanha`;
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT reserva_campanha`;
      return false;
    }
    throw err;
  }
}

/** Pedido aprovado ou finalizado: a reserva vira uso (sem reserva, nada acontece). */
export async function usarCampanha(tx, pedidoId, agora = new Date()) {
  const { count } = await tx.usoCampanhaFreteGratis.updateMany({
    where: { pedidoId, situacao: 'RESERVADO' },
    data: { situacao: 'USADO', usadoEm: agora },
  });
  return count > 0;
}

/** Pedido expirado ou cancelado: devolve a campanha ao telefone (reservada ou já usada). */
export async function liberarCampanha(tx, pedidoId) {
  const { count } = await tx.usoCampanhaFreteGratis.deleteMany({ where: { pedidoId } });
  return count > 0;
}
