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
  lojaId: true, // conferir a loja (não sai em pedidoPublico)
  loja: { select: { nome: true, slug: true, logoUrl: true } },
  chaveNfce: true, // só a equipe vê (pedidoDaEquipe)
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
  descontoCentavos: true,
  totalCentavos: true,
  formaPagamento: true,
  trocoParaCentavos: true,
  pagoEm: true,
  mesaRotulo: true,
  tempoEstimadoMin: true,
  encomenda: true,
  agendadoPara: true,
  retirarNoBalcao: true,
  observacao: true,
  // Pino e distância (só a equipe vê: pedidoDaEquipe e o cupom).
  latitudeEntrega: true,
  longitudeEntrega: true,
  distanciaMetros: true,
  distanciaOrigem: true,
  criadoEm: true,
  finalizadoEm: true,
  canceladoEm: true,
  criadoPor: { select: { nome: true } },
  itens: { where: { canceladoEm: null }, select: SELECT_ITEM, orderBy: { id: 'asc' } },
};

/**
 * Produtos pedidos, DA LOJA, com o que é preciso para revalidar, precificar e
 * baixar estoque. Produto de outra loja não volta (vira "não existe mais").
 */
export function buscarProdutosParaPedido(lojaId, ids, db = prisma) {
  return db.produto.findMany({
    where: { lojaId, id: { in: ids } },
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
 * Próximo número do dia da LOJA, atômico: a linha do contador fica travada até
 * o commit (outro pedido da mesma loja e dia espera) e volta junto num rollback.
 * Cada loja tem a sua numeração.
 * @param {string} dia "YYYY-MM-DD" (dia operacional)
 */
export async function proximoNumeroDoDia(lojaId, dia, db = prisma) {
  const [{ ultimo }] = await db.$queryRaw`
    INSERT INTO "ContadorPedido" ("lojaId", "dataRef", "ultimo") VALUES (${lojaId}, ${dia}::date, 1)
    ON CONFLICT ("lojaId", "dataRef") DO UPDATE SET "ultimo" = "ContadorPedido"."ultimo" + 1
    RETURNING "ultimo"`;
  return ultimo;
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

/** `dados.lojaId` obrigatório: a fila de impressão é por loja. */
export function criarTrabalhoImpressao(dados, db = prisma) {
  return db.trabalhoImpressao.create({ data: dados, select: { id: true, pedidoId: true, caixaId: true, tipo: true, status: true } });
}

export function buscarPorId(id, db = prisma) {
  return db.pedido.findUnique({ where: { id }, select: SELECT_PEDIDO });
}

export function buscarPorChave(chaveIdempotencia, db = prisma) {
  return db.pedido.findUnique({ where: { chaveIdempotencia }, select: SELECT_PEDIDO });
}

/** Histórico do cliente (todas as lojas, ou só `lojaId`), mais novo primeiro; `antesDeId` pagina (ids menores). */
export function listarDoCliente(clienteId, { antesDeId, limite, lojaId }, db = prisma) {
  return db.pedido.findMany({
    where: { clienteId, ...(lojaId ? { lojaId } : {}), ...(antesDeId ? { id: { lt: antesDeId } } : {}) },
    orderBy: { id: 'desc' },
    take: limite,
    select: SELECT_PEDIDO,
  });
}

export function ultimoDoCliente(clienteId, lojaId, db = prisma) {
  return db.pedido.findFirst({
    where: { clienteId, lojaId },
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    select: SELECT_PEDIDO,
  });
}

/**
 * Pedidos da loja num dia operacional, do mais antigo para o mais novo.
 * @param {{ lojaId: number, dataRef: string, canais?: string[], status?: string[] }} filtro
 */
export function listarDoDia({ lojaId, dataRef, canais, status }, db = prisma) {
  return db.pedido.findMany({
    where: {
      lojaId,
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
export async function finalizarSeAberto(id, { formaPagamento, trocoParaCentavos, finalizadoEm, caixaId }, statusAbertos, db = prisma) {
  const { count } = await db.pedido.updateMany({
    where: { id, status: { in: statusAbertos } },
    data: { status: 'FINALIZADO', formaPagamento, trocoParaCentavos, finalizadoEm, caixaId },
  });
  return count;
}

export function buscarStatus(id, db = prisma) {
  return db.pedido.findUnique({ where: { id }, select: { id: true, lojaId: true, status: true, canal: true, pagoEm: true } });
}

/** Atualiza só se ainda estiver aberto (UPDATE condicionado ao status). Devolve o count. */
export async function atualizarSeAberto(id, dados, statusAbertos, db = prisma) {
  const { count } = await db.pedido.updateMany({ where: { id, status: { in: statusAbertos } }, data: dados });
  return count;
}

/**
 * Cancela só se ainda estiver aberto (UPDATE condicionado: cancelar duas
 * vezes, ou cancelar e finalizar ao mesmo tempo, só um vence). Devolve o count.
 */
export async function cancelarSeAberto(lojaId, id, canceladoEm, statusAbertos, db = prisma) {
  const { count } = await db.pedido.updateMany({
    where: { id, lojaId, status: { in: statusAbertos } },
    data: { status: 'CANCELADO', canceladoEm },
  });
  return count;
}

/**
 * Baixas (VENDA) dos itens ainda não cancelados do pedido: é exatamente o que
 * o estorno devolve (não a receita atual, que pode ter mudado desde a venda).
 */
export function vendasDoPedido(pedidoId, db = prisma) {
  return db.movimentacaoEstoque.findMany({
    where: { tipo: 'VENDA', itemPedido: { pedidoId, canceladoEm: null } },
    select: { produtoId: true, insumoId: true, quantidade: true, itemPedidoId: true },
    orderBy: { id: 'asc' },
  });
}

export async function devolverEstoqueProduto(id, quantidade, db = prisma) {
  await db.produto.update({ where: { id }, data: { estoque: { increment: quantidade } } });
}

export async function devolverEstoqueInsumo(id, quantidade, db = prisma) {
  await db.insumo.update({ where: { id }, data: { estoque: { increment: quantidade } } });
}

export function definirChaveNfce(id, chaveNfce, db = prisma) {
  return db.pedido.update({ where: { id }, data: { chaveNfce }, select: { id: true } });
}
