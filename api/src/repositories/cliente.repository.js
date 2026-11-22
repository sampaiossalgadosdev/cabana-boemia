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

/**
 * Conta para o login com celular: a que já verificou o telefone (no máximo
 * uma, pelo índice único parcial); senão a mais antiga com esse telefone.
 */
export function buscarParaLoginPorTelefone(telefone, db = prisma) {
  return db.cliente.findFirst({
    where: { telefone },
    orderBy: [{ telefoneVerificado: 'desc' }, { id: 'asc' }],
  });
}

/** Conta nova do login com celular: sem nome ainda (o app pede logo depois). */
export function criarComTelefoneVerificado(telefone, agora, db = prisma) {
  return db.cliente.create({ data: { nome: '', telefone, telefoneVerificado: true, telefoneVerificadoEm: agora } });
}

export function marcarTelefoneVerificado(id, agora, db = prisma) {
  return db.cliente.update({ where: { id }, data: { telefoneVerificado: true, telefoneVerificadoEm: agora } });
}

export function atualizar(id, dados, db = prisma) {
  return db.cliente.update({ where: { id }, data: dados });
}

/**
 * Pedidos "em andamento" para a exclusão da conta: nem cancelados nem
 * finalizados, criados a partir de `desde`. A janela de tempo existe para não
 * depender do PDV: se ele nunca finalizar um pedido, o cliente não fica preso.
 */
export function contarPedidosRecentes(clienteId, desde, db = prisma) {
  return db.pedido.count({
    where: { clienteId, status: { notIn: ['CANCELADO', 'FINALIZADO'] }, criadoEm: { gte: desde } },
  });
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

/**
 * Aceite dos termos/política do app (versão `versao`): grava o estado no
 * cliente e o histórico em `Consentimento`, juntos.
 */
export function registrarAceite(clienteId, { versao, ip, agora }, db = prisma) {
  return db.$transaction(async (tx) => {
    await tx.consentimento.create({ data: { clienteId, tipo: 'TERMOS', versao, ip, criadoEm: agora } });
    return tx.cliente.update({ where: { id: clienteId }, data: { termosVersao: versao, termosAceitosEm: agora } });
  });
}

/** Marketing (opcional): liga/desliga e guarda a escolha no histórico. */
export function registrarMarketing(clienteId, { aceito, ip, agora }, db = prisma) {
  return db.$transaction(async (tx) => {
    await tx.consentimento.create({
      data: { clienteId, tipo: aceito ? 'MARKETING_CONCEDIDO' : 'MARKETING_REVOGADO', ip, criadoEm: agora },
    });
    return tx.cliente.update({ where: { id: clienteId }, data: { marketing: aceito, marketingEm: agora } });
  });
}
