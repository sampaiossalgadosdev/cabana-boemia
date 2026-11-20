import { prisma } from '../lib/prisma.js';
import { SELECT_BAIRRO_ENDERECO } from '../services/bairro.service.js';

const SELECT = {
  id: true,
  rua: true,
  numero: true,
  complemento: true,
  referencia: true,
  principal: true,
  bairro: SELECT_BAIRRO_ENDERECO, // bairro da cidade + áreas (o service mostra pela loja)
};

export function listarDoCliente(clienteId, db = prisma) {
  return db.endereco.findMany({
    where: { clienteId },
    select: SELECT,
    orderBy: [{ principal: 'desc' }, { criadoEm: 'desc' }, { id: 'desc' }],
  });
}

export function contarDoCliente(clienteId, db = prisma) {
  return db.endereco.count({ where: { clienteId } });
}

/** Só encontra se o endereço for do cliente (endereço de outro = inexistente). */
export function buscarDoCliente(clienteId, id, db = prisma) {
  return db.endereco.findFirst({ where: { id, clienteId }, select: SELECT });
}

export function criar(dados, db = prisma) {
  return db.endereco.create({ data: dados, select: SELECT });
}

export function atualizar(id, dados, db = prisma) {
  return db.endereco.update({ where: { id }, data: dados, select: SELECT });
}

export function remover(id, db = prisma) {
  return db.endereco.delete({ where: { id } });
}

/** Desmarca o principal do cliente (menos o `exceto`, se vier). */
export function desmarcarPrincipais(clienteId, exceto, db = prisma) {
  return db.endereco.updateMany({
    where: { clienteId, principal: true, ...(exceto && { id: { not: exceto } }) },
    data: { principal: false },
  });
}

export function maisRecente(clienteId, db = prisma) {
  return db.endereco.findFirst({
    where: { clienteId },
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
}

/** Bairro da cidade (vale para qualquer loja). */
export function buscarBairro(id, db = prisma) {
  return db.bairro.findUnique({ where: { id } });
}
