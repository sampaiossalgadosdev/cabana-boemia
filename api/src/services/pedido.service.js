/**
 * Criação de pedido, reutilizável por SITE, WHATSAPP e SALAO.
 *
 * Tudo numa transação: revalida turno e produtos, recalcula preços SÓ com o
 * banco (o front nunca manda preço), baixa estoque com decremento condicionado
 * (estoque >= qtd), gera o numeroDia, grava snapshots, movimentações e o
 * trabalho de impressão. Eventos para a equipe só depois do commit.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { diaLocal } from '../lib/fuso.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import * as turnoRepo from '../repositories/turno.repository.js';
import * as enderecoRepo from '../repositories/endereco.repository.js';
import * as clienteRepo from '../repositories/cliente.repository.js';
import { calcularTurnoAtivo } from './turno.service.js';
import { calcularTempoEstimado } from './publico.service.js';
import { garantirTelefone } from './cliente.service.js';

export const CANAIS = ['SITE', 'WHATSAPP', 'SALAO'];
export const FORMAS_PAGAMENTO = ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'];

/**
 * Só o SITE depende do horário: a equipe (WHATSAPP, SALAO) lança fora do
 * turno, ex.: cliente do salão que continua comendo depois do fim do turno.
 */
export const canalExigeLojaAberta = (canal) => canal === 'SITE';

/** Comanda do salão nasce aberta; site e WhatsApp já confirmados (é quando baixa o estoque). */
const STATUS_INICIAL = { SITE: 'CONFIRMADO', WHATSAPP: 'CONFIRMADO', SALAO: 'ABERTO' };

/** Status de pedido "ainda aberto" (na fila; pode ser finalizado ou cancelado). */
export const STATUS_ABERTOS = ['ABERTO', 'CONFIRMADO'];

export const OPCOES_TRANSACAO = { maxWait: 10_000, timeout: 15_000 };

// ───────── Funções puras (testáveis sem banco) ─────────

/**
 * Motivo para o produto não poder ser vendido agora no canal, ou null.
 * Todos os canais: produto (e categoria) ativo. Só o SITE: disponível hoje,
 * do turno ativo e vendido no site. O saldo é conferido na baixa.
 * @param {object | undefined} produto linha de buscarProdutosParaPedido
 */
export function motivoIndisponivel(produto, { canal, turnoId }) {
  if (!produto) return 'não existe mais';
  if (!produto.ativo || !produto.categoria.ativo) return 'saiu do cardápio';
  if (canal !== 'SITE') return null;
  if (!produto.disponivelHoje) return 'não está disponível hoje';
  if (!produto.turnos.some((t) => t.turnoId === turnoId)) return 'não é servido neste horário';
  if (!produto.vendidoNoSite) return 'não é vendido pelo site';
  return null;
}

/**
 * SITE: o total que o cliente viu precisa bater com o recalculado. Se não
 * bater (o dono mudou um preço), 409 com os preços novos, antes de baixar estoque.
 */
export function conferirTotalEsperado(totalEsperadoCentavos, valores) {
  if (totalEsperadoCentavos === valores.totalCentavos) return;
  throw new ErroHttp(409, 'Os preços mudaram. Confira o novo total e confirme de novo.', {
    codigo: 'PRECO_ALTERADO',
    detalhes: {
      subtotalCentavos: valores.subtotalCentavos,
      taxaEntregaCentavos: valores.taxaEntregaCentavos,
      totalCentavos: valores.totalCentavos,
      itens: [...new Map(valores.linhas.map((l) => [l.produto.id, l])).values()].map((l) => ({
        produtoId: l.produto.id,
        nome: l.produto.nome,
        precoUnitarioCentavos: l.precoUnitarioCentavos,
      })),
    },
  });
}

/**
 * Preço de cada linha e totais, só com dados do banco.
 * UNIDADE: preço × quantidade. POR_KG: preço do quilo × gramas / 1000 (arredondado).
 */
export function calcularValores(itens, produtosPorId, taxaEntregaCentavos = 0) {
  const linhas = itens.map((item) => {
    const produto = produtosPorId.get(item.produtoId);
    if (produto.tipoPreco === 'POR_KG') {
      if (!Number.isInteger(item.pesoGramas) || item.pesoGramas <= 0) {
        throw new ErroHttp(400, `Informe o peso de "${produto.nome}"`, { codigo: 'PESO_OBRIGATORIO' });
      }
      return {
        produto,
        quantidade: 1,
        pesoGramas: item.pesoGramas,
        observacao: item.observacao ?? null,
        precoUnitarioCentavos: produto.precoCentavos,
        totalCentavos: Math.round((produto.precoCentavos * item.pesoGramas) / 1000),
      };
    }
    return {
      produto,
      quantidade: item.quantidade,
      pesoGramas: null,
      observacao: item.observacao ?? null,
      precoUnitarioCentavos: produto.precoCentavos,
      totalCentavos: produto.precoCentavos * item.quantidade,
    };
  });
  const subtotalCentavos = linhas.reduce((s, l) => s + l.totalCentavos, 0);
  return { linhas, subtotalCentavos, taxaEntregaCentavos, totalCentavos: subtotalCentavos + taxaEntregaCentavos };
}

/**
 * Quanto baixar de cada produto (estoque próprio) e de cada insumo, somando
 * as linhas, EM ORDEM DE ID: todo pedido trava as linhas na mesma ordem, o
 * que evita deadlock entre pedidos com os mesmos itens em ordens diferentes.
 */
export function necessidadesDeEstoque(linhas) {
  const produtos = new Map();
  const insumos = new Map();
  for (const { produto, quantidade, pesoGramas } of linhas) {
    if (pesoGramas != null) continue; // por kg não controla estoque
    if (produto.controlaEstoque) {
      const p = produtos.get(produto.id) ?? { id: produto.id, nome: produto.nome, quantidade: 0 };
      p.quantidade += quantidade;
      produtos.set(produto.id, p);
    }
    for (const pi of produto.insumos) {
      const i = insumos.get(pi.insumoId) ?? { id: pi.insumoId, nome: pi.insumo.nome, quantidade: 0, produtos: [] };
      i.quantidade += pi.quantidade * quantidade;
      if (!i.produtos.includes(produto.nome)) i.produtos.push(produto.nome);
      insumos.set(pi.insumoId, i);
    }
  }
  const porId = (a, b) => a.id - b.id;
  return { produtos: [...produtos.values()].sort(porId), insumos: [...insumos.values()].sort(porId) };
}

/** Troco só em dinheiro e maior que o total (calculado no servidor). */
export function validarPagamento({ forma, trocoParaCentavos }, totalCentavos, { obrigatorio }) {
  if (!forma) {
    if (obrigatorio) {
      throw new ErroHttp(400, 'Escolha a forma de pagamento', {
        codigo: 'VALIDACAO',
        detalhes: [{ campo: 'formaPagamento', mensagem: 'Escolha a forma de pagamento' }],
      });
    }
    return;
  }
  if (!FORMAS_PAGAMENTO.includes(forma)) {
    throw new ErroHttp(400, 'Forma de pagamento inválida', { codigo: 'VALIDACAO' });
  }
  if (trocoParaCentavos == null) return;
  const erro = (mensagem) =>
    new ErroHttp(400, mensagem, {
      codigo: 'TROCO_INVALIDO',
      detalhes: [{ campo: 'trocoParaCentavos', mensagem }],
    });
  if (forma !== 'DINHEIRO') throw erro('Troco só para pagamento em dinheiro');
  if (!(trocoParaCentavos > totalCentavos)) throw erro('O valor para troco precisa ser maior que o total do pedido');
}

const estoqueAcabou = (nomes, insumo) =>
  new ErroHttp(
    409,
    `Acabou: ${nomes.join(', ')}${insumo ? ` (sem ${insumo.toLowerCase()})` : ''}. Remova do carrinho para continuar.`,
    { codigo: 'ESTOQUE_INSUFICIENTE', detalhes: { produtos: nomes, insumo: insumo ?? null } },
  );

/**
 * Baixa atômica, na ordem de `necessidadesDeEstoque`. Qualquer count = 0
 * lança 409 dizendo o que acabou; a transação desfaz as baixas anteriores.
 */
export async function baixarEstoque(tx, { produtos, insumos }) {
  for (const p of produtos) {
    if ((await pedidoRepo.baixarEstoqueProduto(p.id, p.quantidade, tx)) === 0) throw estoqueAcabou([p.nome]);
  }
  for (const i of insumos) {
    if ((await pedidoRepo.baixarEstoqueInsumo(i.id, i.quantidade, tx)) === 0) {
      throw estoqueAcabou(i.produtos, i.nome);
    }
  }
}

/** "Rua das Flores, 120 - Casa 2 (Ref.: perto da praça)" */
export function formatarEndereco(e) {
  let texto = `${e.rua}, ${e.numero}`;
  if (e.complemento) texto += ` - ${e.complemento}`;
  if (e.referencia) texto += ` (Ref.: ${e.referencia})`;
  return texto;
}

/** Pedido devolvido ao site e enviado à equipe. */
export function pedidoPublico(p) {
  return {
    id: p.id,
    numeroDia: p.numeroDia,
    canal: p.canal,
    status: p.status,
    nomeCliente: p.nomeCliente,
    telefone: p.telefone,
    enderecoTexto: p.enderecoTexto,
    bairroNome: p.bairroNome,
    subtotalCentavos: p.subtotalCentavos,
    taxaEntregaCentavos: p.taxaEntregaCentavos,
    totalCentavos: p.totalCentavos,
    formaPagamento: p.formaPagamento,
    trocoParaCentavos: p.trocoParaCentavos,
    mesaRotulo: p.mesaRotulo,
    tempoEstimadoMin: p.tempoEstimadoMin,
    criadoEm: p.criadoEm,
    itens: p.itens.map((i) => ({
      id: i.id,
      produtoId: i.produtoId,
      nome: i.nomeSnapshot,
      quantidade: i.quantidade,
      pesoGramas: i.pesoGramas,
      precoUnitarioCentavos: i.precoUnitarioCentavos,
      totalCentavos: i.totalCentavos,
      observacao: i.observacao,
    })),
  };
}

// ───────── Itens e estoque (pedido inteiro ou item avulso da comanda) ─────────

/**
 * Grava os itens (snapshot de nome e preço) e uma MovimentacaoEstoque VENDA
 * por baixa (delta negativo). O estoque já foi baixado por `baixarEstoque`.
 * @returns {Promise<number[]>} ids dos itens criados
 */
export async function gravarItens(tx, pedidoId, linhas, usuarioId = null) {
  const ids = [];
  const movimentacoes = [];
  for (const l of linhas) {
    const { id: itemPedidoId } = await pedidoRepo.criarItem(
      {
        pedidoId,
        produtoId: l.produto.id,
        nomeSnapshot: l.produto.nome,
        precoUnitarioCentavos: l.precoUnitarioCentavos,
        quantidade: l.quantidade,
        pesoGramas: l.pesoGramas,
        totalCentavos: l.totalCentavos,
        observacao: l.observacao,
      },
      tx,
    );
    ids.push(itemPedidoId);
    if (l.pesoGramas != null) continue; // por kg não controla estoque
    const base = { tipo: 'VENDA', itemPedidoId, usuarioId };
    if (l.produto.controlaEstoque) {
      movimentacoes.push({ ...base, produtoId: l.produto.id, quantidade: -l.quantidade });
    }
    for (const pi of l.produto.insumos) {
      movimentacoes.push({ ...base, insumoId: pi.insumoId, quantidade: -(pi.quantidade * l.quantidade) });
    }
  }
  if (movimentacoes.length) await pedidoRepo.criarMovimentacoes(movimentacoes, tx);
  return ids;
}

/**
 * Devolve EXATAMENTE o que as vendas baixaram (somado, em ordem de id, como
 * a baixa) e grava um ESTORNO por VENDA (delta oposto).
 * @param {{ produtoId: number|null, insumoId: number|null, quantidade: number, itemPedidoId: number }[]} vendas
 */
export async function estornarVendas(tx, vendas, usuarioId = null) {
  if (!vendas.length) return;
  const devolver = somarDevolucoes(vendas);
  for (const p of devolver.produtos) await pedidoRepo.devolverEstoqueProduto(p.id, p.quantidade, tx);
  for (const i of devolver.insumos) await pedidoRepo.devolverEstoqueInsumo(i.id, i.quantidade, tx);
  await pedidoRepo.criarMovimentacoes(
    vendas.map((v) => ({
      tipo: 'ESTORNO',
      produtoId: v.produtoId,
      insumoId: v.insumoId,
      quantidade: -v.quantidade,
      itemPedidoId: v.itemPedidoId,
      usuarioId,
    })),
    tx,
  );
}

// ───────── Criação ─────────

/**
 * @param {{
 *   canal: 'SITE' | 'WHATSAPP' | 'SALAO',
 *   itens: { produtoId: number, quantidade: number, pesoGramas?: number, observacao?: string | null }[],
 *   cliente?: { id?: number, nome: string, telefone?: string | null } | null,
 *   endereco?: { texto: string, bairroId: number } | null,
 *   pagamento?: { forma?: string | null, trocoParaCentavos?: number | null },
 *   usuarioId?: number | null,
 *   mesaRotulo?: string | null,
 *   chaveIdempotencia?: string | null,
 *   totalEsperadoCentavos?: number,  // obrigatório no SITE: total que o cliente viu
 *   agora?: Date,
 * }} dados
 * @returns {Promise<{ pedido: object, criado: boolean }>} criado=false: mesma chave já tinha pedido
 */
export async function criarPedido({
  canal,
  itens,
  cliente = null,
  endereco = null,
  pagamento = {},
  usuarioId = null,
  mesaRotulo = null,
  chaveIdempotencia = null,
  totalEsperadoCentavos,
  agora = new Date(),
}) {
  if (!CANAIS.includes(canal)) throw new ErroHttp(400, 'Canal inválido', { codigo: 'VALIDACAO' });
  if (!itens?.length) throw new ErroHttp(400, 'O pedido não tem itens', { codigo: 'VALIDACAO' });
  if (canal === 'SITE' && !Number.isInteger(totalEsperadoCentavos)) {
    throw new ErroHttp(400, 'Informe o total do pedido', { codigo: 'VALIDACAO' });
  }

  if (chaveIdempotencia) {
    const existente = await pedidoRepo.buscarPorChave(chaveIdempotencia);
    if (existente) return reaproveitar(existente, cliente);
  }

  let resultado;
  try {
    resultado = await prisma.$transaction(
      (tx) =>
        criarNaTransacao(tx, {
          canal,
          itens,
          cliente,
          endereco,
          pagamento,
          usuarioId,
          mesaRotulo,
          chaveIdempotencia,
          totalEsperadoCentavos,
          agora,
        }),
      OPCOES_TRANSACAO,
    );
  } catch (err) {
    // Duas requisições com a mesma chave ao mesmo tempo: a segunda bate no
    // unique, sofre rollback (estoque devolvido) e devolve o pedido da primeira.
    if (
      chaveIdempotencia &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      String(err.meta?.target).includes('chaveIdempotencia')
    ) {
      return reaproveitar(await pedidoRepo.buscarPorChave(chaveIdempotencia), cliente);
    }
    throw err;
  }

  // Só depois do commit: a equipe nunca recebe pedido que não existe.
  const pedido = pedidoPublico(resultado.pedido);
  emitirParaEquipe('pedido:novo', pedido);
  emitirParaEquipe('impressao:nova', resultado.trabalho);
  return { pedido, criado: true };
}

function reaproveitar(existente, cliente) {
  if (cliente?.id && existente.clienteId !== cliente.id) {
    throw new ErroHttp(409, 'Chave de pedido já usada', { codigo: 'CHAVE_EM_USO' });
  }
  return { pedido: pedidoPublico(existente), criado: false };
}

async function criarNaTransacao(tx, d) {
  // 1. Loja aberta agora? (só o SITE; a equipe lança fora do horário)
  const turno = calcularTurnoAtivo(await turnoRepo.listarAtivosComHorarios(tx), d.agora);
  if (!turno && canalExigeLojaAberta(d.canal)) {
    throw new ErroHttp(409, 'Estamos fechados agora. Os pedidos voltam quando abrirmos.', { codigo: 'LOJA_FECHADA' });
  }

  // 2. Produtos ainda vendáveis (lidos do banco, nunca do front).
  const ids = [...new Set(d.itens.map((i) => i.produtoId))];
  const produtosPorId = new Map((await pedidoRepo.buscarProdutosParaPedido(ids, tx)).map((p) => [p.id, p]));
  const indisponiveis = [];
  for (const id of ids) {
    const motivo = motivoIndisponivel(produtosPorId.get(id), { canal: d.canal, turnoId: turno?.id });
    if (motivo) indisponiveis.push({ produtoId: id, nome: produtosPorId.get(id)?.nome ?? null, motivo });
  }
  if (indisponiveis.length) {
    const nomes = indisponiveis.map((i) => i.nome ?? `produto ${i.produtoId}`).join(', ');
    throw new ErroHttp(409, `Indisponível agora: ${nomes}. Remova do carrinho para continuar.`, {
      codigo: 'PRODUTO_INDISPONIVEL',
      detalhes: indisponiveis,
    });
  }

  // 3. Taxa de entrega pelo bairro (do banco).
  let bairro = null;
  if (d.endereco) {
    bairro = await pedidoRepo.buscarBairro(d.endereco.bairroId, tx);
    if (!bairro?.ativo) throw new ErroHttp(422, 'Não entregamos neste bairro', { codigo: 'BAIRRO_INVALIDO' });
  }

  // 4. Preços e totais recalculados; pagamento conferido contra o total do servidor.
  const valores = calcularValores(d.itens, produtosPorId, bairro?.taxaCentavos ?? 0);
  if (d.canal === 'SITE') conferirTotalEsperado(d.totalEsperadoCentavos, valores);
  validarPagamento(d.pagamento, valores.totalCentavos, { obrigatorio: d.canal !== 'SALAO' });

  // 5. Baixa atômica do estoque (409 com o nome do que acabou).
  await baixarEstoque(tx, necessidadesDeEstoque(valores.linhas));

  // 6. Número do dia (dia local), atômico e sem buraco em caso de rollback.
  const dia = diaLocal(d.agora);
  const numeroDia = await pedidoRepo.proximoNumeroDoDia(dia, tx);

  // 7. Pedido com snapshots.
  const config = await pedidoRepo.buscarConfiguracao(tx);
  const { id: pedidoId } = await pedidoRepo.criarPedido(
    {
      numeroDia,
      dataRef: new Date(`${dia}T00:00:00.000Z`),
      canal: d.canal,
      status: STATUS_INICIAL[d.canal],
      clienteId: d.cliente?.id ?? null,
      nomeCliente: d.cliente?.nome ?? (d.mesaRotulo ? `Mesa ${d.mesaRotulo}` : 'Cliente'),
      telefone: d.cliente?.telefone ?? null,
      enderecoTexto: d.endereco?.texto ?? null,
      bairroNome: bairro?.nome ?? null,
      subtotalCentavos: valores.subtotalCentavos,
      taxaEntregaCentavos: valores.taxaEntregaCentavos,
      totalCentavos: valores.totalCentavos,
      formaPagamento: d.pagamento?.forma ?? null,
      trocoParaCentavos: d.pagamento?.trocoParaCentavos ?? null,
      mesaRotulo: d.mesaRotulo,
      tempoEstimadoMin: config ? calcularTempoEstimado(config, d.agora) : null,
      criadoPorId: d.usuarioId,
      chaveIdempotencia: d.chaveIdempotencia,
    },
    tx,
  );

  // 8. Itens (snapshot de nome e preço) + histórico de estoque por item.
  await gravarItens(tx, pedidoId, valores.linhas, d.usuarioId);

  // 9. Fila de impressão.
  const trabalho = await pedidoRepo.criarTrabalhoImpressao({ pedidoId, tipo: 'PEDIDO', status: 'PENDENTE' }, tx);

  return { pedido: await pedidoRepo.buscarPorId(pedidoId, tx), trabalho };
}

// ───────── Site ─────────

/**
 * Pedido do site: exige telefone e um endereço do próprio cliente; nome e
 * telefone vêm do cadastro, não do corpo da requisição.
 */
export async function criarPedidoDoSite(
  cliente,
  { itens, enderecoId, formaPagamento, trocoParaCentavos, chaveIdempotencia, totalEsperadoCentavos },
  { agora } = {},
) {
  garantirTelefone(cliente);
  const endereco = await enderecoRepo.buscarDoCliente(cliente.id, enderecoId);
  if (!endereco) {
    throw new ErroHttp(422, 'Escolha um endereço de entrega', { codigo: 'ENDERECO_INVALIDO' });
  }
  return criarPedido({
    canal: 'SITE',
    itens,
    cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone },
    endereco: { texto: formatarEndereco(endereco), bairroId: endereco.bairro.id },
    pagamento: { forma: formaPagamento, trocoParaCentavos: trocoParaCentavos ?? null },
    chaveIdempotencia,
    totalEsperadoCentavos,
    agora,
  });
}

/** Último pedido do cliente (para "Repetir último pedido"), ou null. */
export async function ultimoPedidoDoCliente(clienteId) {
  const p = await pedidoRepo.ultimoDoCliente(clienteId);
  return p ? pedidoPublico(p) : null;
}

// ───────── WhatsApp (lançado pela equipe no PDV) ─────────

/**
 * Pedido do WhatsApp: cliente e endereço do cadastro (o endereço precisa ser
 * daquele cliente). Mesmo `criarPedido` do site: preço do banco, baixa
 * atômica, número do dia, impressão. Sem trava de horário (canal da equipe).
 */
export async function criarPedidoDoWhatsapp(
  { clienteId, enderecoId, itens, formaPagamento, trocoParaCentavos, chaveIdempotencia },
  { usuarioId, agora } = {},
) {
  const cliente = await clienteRepo.buscarPorId(clienteId);
  if (!cliente) throw new ErroHttp(422, 'Escolha o cliente', { codigo: 'CLIENTE_INVALIDO' });
  const endereco = await enderecoRepo.buscarDoCliente(cliente.id, enderecoId);
  if (!endereco) {
    throw new ErroHttp(422, 'Escolha um endereço de entrega do cliente', { codigo: 'ENDERECO_INVALIDO' });
  }
  return criarPedido({
    canal: 'WHATSAPP',
    itens,
    cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone },
    endereco: { texto: formatarEndereco(endereco), bairroId: endereco.bairro.id },
    pagamento: { forma: formaPagamento, trocoParaCentavos: trocoParaCentavos ?? null },
    usuarioId,
    chaveIdempotencia,
    agora,
  });
}

// ───────── Cancelamento ─────────

/**
 * Soma as baixas (VENDA, delta negativo) por produto e por insumo, em ordem
 * de id: a devolução trava as linhas na mesma ordem da baixa.
 */
export function somarDevolucoes(vendas) {
  const produtos = new Map();
  const insumos = new Map();
  for (const v of vendas) {
    const alvo = v.produtoId != null ? produtos : insumos;
    const id = v.produtoId ?? v.insumoId;
    alvo.set(id, (alvo.get(id) ?? 0) - v.quantidade);
  }
  const lista = (m) => [...m].map(([id, quantidade]) => ({ id, quantidade })).sort((a, b) => a.id - b.id);
  return { produtos: lista(produtos), insumos: lista(insumos) };
}

/**
 * Cancela um pedido aberto numa transação: muda o status (UPDATE condicionado;
 * já encerrado = 409), devolve EXATAMENTE o que foi baixado na venda (as
 * movimentações VENDA dos itens, não a receita atual), grava ESTORNO por
 * movimentação e cria o TrabalhoImpressao CANCELAMENTO. Comanda do salão não
 * imprime cancelamento (nada dela foi impresso). Eventos depois do commit.
 */
export async function cancelarPedido(id, { usuarioId = null, agora = new Date() } = {}) {
  const { pedido, trabalho } = await prisma.$transaction(async (tx) => {
    const count = await pedidoRepo.cancelarSeAberto(id, agora, STATUS_ABERTOS, tx);
    if (count === 0) {
      const atual = await pedidoRepo.buscarStatus(id, tx);
      if (!atual) throw new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });
      const situacao = atual.status === 'CANCELADO' ? 'cancelado' : 'finalizado';
      throw new ErroHttp(409, `Pedido já está ${situacao}`, { codigo: 'PEDIDO_ENCERRADO' });
    }

    await estornarVendas(tx, await pedidoRepo.vendasDoPedido(id, tx), usuarioId);

    const pedido = await pedidoRepo.buscarPorId(id, tx);
    const trabalho =
      pedido.canal === 'SALAO'
        ? null
        : await pedidoRepo.criarTrabalhoImpressao({ pedidoId: id, tipo: 'CANCELAMENTO', status: 'PENDENTE' }, tx);
    return { pedido, trabalho };
  }, OPCOES_TRANSACAO);

  const publico = pedidoPublico(pedido);
  emitirParaEquipe('pedido:atualizado', publico);
  if (trabalho) emitirParaEquipe('impressao:nova', trabalho);
  return publico;
}
