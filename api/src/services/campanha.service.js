/**
 * Campanha de frete grátis da primeira compra (custo da plataforma). Decisões 4, 16 e
 * as da Etapa 2 em docs/pagamento-online.md:
 *
 * - um por telefone VERIFICADO por código (sem telefone verificado, não ganha);
 * - só no app (quem chama confere o canal; não vale no PDV nem no site);
 * - RESERVADA na criação do pedido (dois pedidos ao mesmo tempo não usam a mesma);
 * - USADA na aprovação do pagamento online ou na finalização do pedido pago na entrega;
 * - LIBERADA (linha apagada) se o pedido expirar ou for cancelado, inclusive depois do aceite.
 *
 * Tudo dentro da transação de quem chama (`tx`). A ligação com a criação e a aprovação
 * do pedido é da etapa 4; finalizar e cancelar já chamam `usar`/`liberar`.
 */
import { Prisma } from '@prisma/client';

/** O cliente ainda pode ganhar a campanha? (telefone verificado, sem reserva nem uso) */
export async function campanhaElegivel(cliente, tx) {
  if (!cliente?.telefoneVerificado || !cliente.telefone) return false;
  return (await tx.usoCampanhaFreteGratis.count({ where: { telefone: cliente.telefone } })) === 0;
}

/**
 * Reserva a campanha para o pedido. Devolve false se o telefone já tem reserva ou uso
 * (inclusive numa corrida com outro pedido do mesmo telefone).
 */
export async function reservarCampanha(tx, { telefone, clienteId = null, pedidoId, agora = new Date() }) {
  try {
    // SAVEPOINT: o erro do único não pode abortar a transação de quem chama.
    await tx.$executeRaw`SAVEPOINT reserva_campanha`;
    await tx.usoCampanhaFreteGratis.create({ data: { telefone, clienteId, pedidoId, reservadoEm: agora } });
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
