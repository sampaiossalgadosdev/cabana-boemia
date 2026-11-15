import { prisma } from '../lib/prisma.js';

/**
 * Produtos que o site pode oferecer no turno: ativos, disponíveis hoje,
 * vendidos no site e de categoria ativa. O saldo é filtrado no service.
 */
export function listarProdutosDoSite(turnoId, db = prisma) {
  return db.produto.findMany({
    where: {
      ativo: true,
      disponivelHoje: true,
      vendidoNoSite: true,
      categoria: { ativo: true },
      turnos: { some: { turnoId } },
    },
    select: {
      id: true,
      nome: true,
      descricao: true,
      tipoPreco: true,
      precoCentavos: true,
      controlaEstoque: true,
      estoque: true,
      categoria: { select: { id: true, nome: true } },
      insumos: { select: { quantidade: true, insumo: { select: { estoque: true } } } },
    },
    orderBy: [{ categoria: { ordem: 'asc' } }, { ordem: 'asc' }, { nome: 'asc' }],
  });
}

export function listarBairrosAtivos(db = prisma) {
  return db.bairro.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, taxaCentavos: true },
    orderBy: { nome: 'asc' },
  });
}

export function buscarConfiguracao(db = prisma) {
  return db.configuracao.findUnique({ where: { id: 1 } });
}
