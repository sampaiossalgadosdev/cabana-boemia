import { prisma } from '../lib/prisma.js';

export function buscarPorId(id, db = prisma) {
  return db.cliente.findUnique({ where: { id } });
}

/** Cria pelo googleId ou, se já existe, atualiza só o que vem em `atualizar`. */
export function upsertPorGoogleId(googleId, { criar, atualizar }, db = prisma) {
  return db.cliente.upsert({
    where: { googleId },
    create: { googleId, ...criar },
    update: atualizar,
  });
}

/** Como upsertPorGoogleId, pelo "sub" do Entrar com Apple. */
export function upsertPorAppleId(appleId, { criar, atualizar }, db = prisma) {
  return db.cliente.upsert({
    where: { appleId },
    create: { appleId, ...criar },
    update: atualizar,
  });
}

export function atualizar(id, dados, db = prisma) {
  return db.cliente.update({ where: { id }, data: dados });
}

/**
 * Pedidos "em andamento" para a exclusão da conta: não cancelados e criados a
 * partir de `desde`. Não olha FINALIZADO/ABERTO de propósito: se o PDV nunca
 * finalizar um pedido, o cliente não fica preso para sempre.
 */
export function contarPedidosRecentes(clienteId, desde, db = prisma) {
  return db.pedido.count({ where: { clienteId, status: { not: 'CANCELADO' }, criadoEm: { gte: desde } } });
}

/** Nome que fica nos pedidos de quem excluiu a conta. */
export const NOME_EXCLUIDO = 'Cliente excluído';

/**
 * Exclusão de conta: os pedidos ficam (valores e itens são registro fiscal),
 * mas sem os dados pessoais do snapshot (nome, telefone, endereço e bairro).
 * Depois apaga o cliente: endereços e refresh tokens vão junto (CASCADE) e o
 * `clienteId` dos pedidos vira null (SET NULL). Tudo numa transação.
 * @returns {Promise<{ pedidosAnonimizados: number }>}
 */
export async function excluirComAnonimizacao(clienteId, db = prisma) {
  return db.$transaction(async (tx) => {
    const r = await tx.pedido.updateMany({
      where: { clienteId },
      data: { nomeCliente: NOME_EXCLUIDO, telefone: null, enderecoTexto: null, bairroNome: null },
    });
    await tx.cliente.delete({ where: { id: clienteId } });
    return { pedidosAnonimizados: r.count };
  });
}
