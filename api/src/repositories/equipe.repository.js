import { prisma } from '../lib/prisma.js';

const SELECT_ENDERECO = {
  id: true,
  rua: true,
  numero: true,
  complemento: true,
  referencia: true,
  principal: true,
  bairro: { select: { id: true, nome: true, taxaCentavos: true, ativo: true } },
};

export const SELECT_CLIENTE = {
  id: true,
  nome: true,
  telefone: true,
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

export function buscarClientePorTelefone(telefone, db = prisma) {
  return db.cliente.findFirst({ where: { telefone }, select: SELECT_CLIENTE, orderBy: { id: 'asc' } });
}

export function criarCliente({ nome, telefone }, db = prisma) {
  return db.cliente.create({ data: { nome, telefone }, select: { id: true } });
}

/**
 * Produtos do turno para o PDV: ativos, de categoria ativa, vendidos por
 * unidade (o "por kg" é do salão). Sem filtrar vendidoNoSite (o PDV vê tudo)
 * nem disponivelHoje/saldo (o service marca, a grade desabilita o esgotado).
 */
export function listarProdutosDoTurno(turnoId, db = prisma) {
  return db.produto.findMany({
    where: {
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
export function listarPorKgDoTurno(turnoId, db = prisma) {
  return db.produto.findMany({
    where: {
      ativo: true,
      tipoPreco: 'POR_KG',
      categoria: { ativo: true },
      turnos: { some: { turnoId } },
    },
    select: { id: true, nome: true, precoCentavos: true },
    orderBy: [{ categoria: { ordem: 'asc' } }, { ordem: 'asc' }, { nome: 'asc' }],
  });
}
