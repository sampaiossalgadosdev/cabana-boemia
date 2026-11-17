import { prisma } from '../lib/prisma.js';

/**
 * Produtos do site no turno: ativos, vendidos no site e de categoria ativa.
 * `somenteDisponiveisHoje` (padrão) também exige disponivelHoje; o saldo é
 * filtrado no service. Sem ele, serve à prévia do cardápio com a loja fechada.
 */
export function listarProdutosDoSite(turnoId, { somenteDisponiveisHoje = true } = {}, db = prisma) {
  return db.produto.findMany({
    where: {
      ativo: true,
      ...(somenteDisponiveisHoje && { disponivelHoje: true }),
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
      sugerirNaSacola: true,
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
