import { prisma } from '../lib/prisma.js';

/**
 * Produtos do site no turno: ativos, vendidos no site e de categoria ativa.
 * `somenteDisponiveisHoje` (padrão) também exige disponivelHoje; o saldo é
 * filtrado no service. Sem ele, serve à prévia do cardápio com a loja fechada.
 */
export function listarProdutosDoSite(lojaId, turnoId, { somenteDisponiveisHoje = true } = {}, db = prisma) {
  return db.produto.findMany({
    where: {
      lojaId,
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
      imagemUrl: true,
      controlaEstoque: true,
      estoque: true,
      categoria: { select: { id: true, nome: true } },
      insumos: { select: { quantidade: true, insumo: { select: { estoque: true } } } },
    },
    orderBy: [{ categoria: { ordem: 'asc' } }, { ordem: 'asc' }, { nome: 'asc' }],
  });
}


