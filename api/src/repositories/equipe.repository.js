import { prisma } from '../lib/prisma.js';

const SELECT_ENDERECO = {
  id: true,
  rua: true,
  numero: true,
  complemento: true,
  referencia: true,
  cep: true,
  cidade: true,
  estado: true,
  principal: true,
  bairro: { select: { id: true, nome: true, taxaCentavos: true, ativo: true } },
};

export const SELECT_CLIENTE = {
  id: true,
  googleId: true, // só para saber se é cadastro do site (o id do Google não sai da API)
  nome: true,
  email: true,
  telefone: true,
  observacao: true,
  enderecos: {
    select: SELECT_ENDERECO,
    orderBy: [{ principal: 'desc' }, { criadoEm: 'desc' }, { id: 'desc' }],
  },
};

/**
 * Clientes por nome ou por trecho do telefone (só dígitos, a partir de 3).
 * O nome é comparado pela coluna `nomeBusca` (sem acento, minúsculo):
 * `termo` já precisa vir normalizado com `paraBusca`.
 */
export function buscarClientes({ termo, digitos }, limite, db = prisma) {
  const ou = [{ nomeBusca: { contains: termo } }];
  if (digitos) ou.push({ telefone: { contains: digitos } });
  return db.cliente.findMany({
    where: { OR: ou },
    select: SELECT_CLIENTE,
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    take: limite,
  });
}

export function buscarClientePorId(id, db = prisma) {
  return db.cliente.findUnique({ where: { id }, select: SELECT_CLIENTE });
}

/** Primeiro cliente com o telefone (menos o `exceto`, na edição). */
export function buscarClientePorTelefone(telefone, db = prisma, exceto = null) {
  return db.cliente.findFirst({
    where: { telefone, ...(exceto ? { id: { not: exceto } } : {}) },
    select: SELECT_CLIENTE,
    orderBy: { id: 'asc' },
  });
}

export function criarCliente({ nome, telefone, email = null, observacao = null }, db = prisma) {
  return db.cliente.create({ data: { nome, telefone, email, observacao }, select: { id: true } });
}

export function atualizarCliente(id, dados, db = prisma) {
  return db.cliente.update({ where: { id }, data: dados, select: { id: true } });
}

/**
 * Produtos do turno para o PDV: ativos, de categoria ativa, vendidos por
 * unidade (o "por kg" é do salão). Sem filtrar vendidoNoSite (o PDV vê tudo)
 * nem disponivelHoje/saldo (o service marca, a grade desabilita o esgotado).
 */
export function listarProdutosDoTurno(lojaId, turnoId, db = prisma) {
  return db.produto.findMany({
    where: {
      lojaId,
      ativo: true,
      tipoPreco: 'UNIDADE',
      categoria: { ativo: true },
      turnos: { some: { turnoId } },
    },
    select: {
      id: true,
      nome: true,
      descricao: true,
      precoCentavos: true,
      disponivelHoje: true,
      controlaEstoque: true,
      estoque: true,
      categoria: { select: { id: true, nome: true } },
      insumos: { select: { quantidade: true, insumo: { select: { estoque: true } } } },
    },
    orderBy: [{ categoria: { ordem: 'asc' } }, { ordem: 'asc' }, { nome: 'asc' }],
  });
}

/** Produtos por quilo do turno (o "Prato por kg" do salão): ativos, de categoria ativa. */
export function listarPorKgDoTurno(lojaId, turnoId, db = prisma) {
  return db.produto.findMany({
    where: {
      lojaId,
      ativo: true,
      tipoPreco: 'POR_KG',
      categoria: { ativo: true },
      turnos: { some: { turnoId } },
    },
    select: { id: true, nome: true, precoCentavos: true },
    orderBy: [{ categoria: { ordem: 'asc' } }, { ordem: 'asc' }, { nome: 'asc' }],
  });
}
