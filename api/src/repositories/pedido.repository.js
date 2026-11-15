import { prisma } from '../lib/prisma.js';

/** Itens do pedido devolvidos (snapshot gravado na criação). */
const SELECT_ITEM = {
  id: true,
  produtoId: true,
  nomeSnapshot: true,
  precoUnitarioCentavos: true,
  quantidade: true,
  pesoGramas: true,
  totalCentavos: true,
  observacao: true,
};

export const SELECT_PEDIDO = {
  id: true,
  numeroDia: true,
  dataRef: true,
  canal: true,
  status: true,
  clienteId: true,
  nomeCliente: true,
  telefone: true,
  enderecoTexto: true,
  bairroNome: true,
  subtotalCentavos: true,
  taxaEntregaCentavos: true,
  totalCentavos: true,
  formaPagamento: true,
  trocoParaCentavos: true,
  mesaRotulo: true,
  tempoEstimadoMin: true,
  criadoEm: true,
  itens: { where: { canceladoEm: null }, select: SELECT_ITEM, orderBy: { id: 'asc' } },
};

/** Produtos pedidos, com o que é preciso para revalidar, precificar e baixar estoque. */
export function buscarProdutosParaPedido(ids, db = prisma) {
  return db.produto.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      nome: true,
      tipoPreco: true,
      precoCentavos: true,
      ativo: true,
      disponivelHoje: true,
      vendidoNoSite: true,
      controlaEstoque: true,
      categoria: { select: { ativo: true } },
      turnos: { select: { turnoId: true } },
      insumos: { select: { insumoId: true, quantidade: true, insumo: { select: { nome: true } } } },
    },
  });
}

/**
 * Baixa atômica: UPDATE ... SET estoque = estoque - qtd WHERE id = ? AND estoque >= qtd.
 * Devolve quantas linhas mudaram (0 = sem saldo). Concorrente espera a trava
 * da linha e o Postgres reavalia o WHERE com o saldo já baixado.
 */
export async function baixarEstoqueProduto(id, quantidade, db = prisma) {
  const { count } = await db.produto.updateMany({
    where: { id, controlaEstoque: true, estoque: { gte: quantidade } },
    data: { estoque: { decrement: quantidade } },
  });
  return count;
}

export async function baixarEstoqueInsumo(id, quantidade, db = prisma) {
  const { count } = await db.insumo.updateMany({
    where: { id, estoque: { gte: quantidade } },
    data: { estoque: { decrement: quantidade } },
  });
  return count;
}

/**
 * Próximo número do dia, atômico: a linha do contador fica travada até o
 * commit (outro pedido do mesmo dia espera) e volta junto num rollback.
 * @param {string} dia "YYYY-MM-DD" local
 */
export async function proximoNumeroDoDia(dia, db = prisma) {
  const [{ ultimo }] = await db.$queryRaw`
    INSERT INTO "ContadorPedido" ("dataRef", "ultimo") VALUES (${dia}::date, 1)
    ON CONFLICT ("dataRef") DO UPDATE SET "ultimo" = "ContadorPedido"."ultimo" + 1
    RETURNING "ultimo"`;
  return ultimo;
}

export function buscarBairro(id, db = prisma) {
  return db.bairro.findUnique({ where: { id } });
}

export function buscarConfiguracao(db = prisma) {
  return db.configuracao.findUnique({ where: { id: 1 } });
}

export function criarPedido(dados, db = prisma) {
  return db.pedido.create({ data: dados, select: { id: true } });
}

export function criarItem(dados, db = prisma) {
  return db.itemPedido.create({ data: dados, select: { id: true } });
}

export function criarMovimentacoes(dados, db = prisma) {
  return db.movimentacaoEstoque.createMany({ data: dados });
}

export function criarTrabalhoImpressao(dados, db = prisma) {
  return db.trabalhoImpressao.create({ data: dados, select: { id: true, pedidoId: true, tipo: true, status: true } });
}

export function buscarPorId(id, db = prisma) {
  return db.pedido.findUnique({ where: { id }, select: SELECT_PEDIDO });
}

export function buscarPorChave(chaveIdempotencia, db = prisma) {
  return db.pedido.findUnique({ where: { chaveIdempotencia }, select: SELECT_PEDIDO });
}

export function ultimoDoCliente(clienteId, db = prisma) {
  return db.pedido.findFirst({
    where: { clienteId },
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    select: SELECT_PEDIDO,
  });
}

/**
 * Pedidos de um dia local, do mais antigo para o mais novo.
 * @param {{ dataRef: string, canais?: string[], status?: string[] }} filtro
 */
export function listarDoDia({ dataRef, canais, status }, db = prisma) {
  return db.pedido.findMany({
    where: {
      dataRef: new Date(`${dataRef}T00:00:00.000Z`),
      ...(canais?.length ? { canal: { in: canais } } : {}),
      ...(status?.length ? { status: { in: status } } : {}),
    },
    orderBy: [{ numeroDia: 'asc' }],
    select: SELECT_PEDIDO,
  });
}

/**
 * Finaliza só se ainda estiver aberto (UPDATE condicionado ao status: duas
 * atendentes finalizando ao mesmo tempo, só uma vence). Devolve o count.
 */
export async function finalizarSeAberto(id, { formaPagamento, trocoParaCentavos, finalizadoEm }, statusAbertos, db = prisma) {
  const { count } = await db.pedido.updateMany({
    where: { id, status: { in: statusAbertos } },
    data: { status: 'FINALIZADO', formaPagamento, trocoParaCentavos, finalizadoEm },
  });
  return count;
}

export function buscarStatus(id, db = prisma) {
  return db.pedido.findUnique({ where: { id }, select: { id: true, status: true } });
}
