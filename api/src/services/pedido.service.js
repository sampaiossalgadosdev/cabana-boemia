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
import { diaOperacional, paraCampoData } from '../lib/fuso.js';
import { horaViradaDe } from './diaOperacional.service.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import { freteGratisDaConfig, taxaDeEntrega } from '@restaurante/shared/frete';
import { linkDoMapa, pinDe } from '@restaurante/shared/mapa';
import { formaNaEntregaPermitida, formasDePagamento } from '@restaurante/shared/formasPagamento';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import * as turnoRepo from '../repositories/turno.repository.js';
import * as enderecoRepo from '../repositories/endereco.repository.js';
import * as clienteRepo from '../repositories/cliente.repository.js';
import * as caixaRepo from '../repositories/caixa.repository.js';
import * as lojaRepo from '../repositories/loja.repository.js';
import { calcularTurnoAtivo } from './turno.service.js';
import { calcularTempoEstimado } from './publico.service.js';
import { garantirTelefone } from './cliente.service.js';
import { taxaDaLoja } from './bairro.service.js';
import { mapasPadrao } from './mapa.service.js';
import * as mapaRepo from '../repositories/mapa.repository.js';
import { limparChave, problemaNaChave } from '../lib/nfce.js';
import { liberarCampanha } from './campanha.service.js';

export const CANAIS = ['SITE', 'WHATSAPP', 'SALAO'];
export const FORMAS_PAGAMENTO = ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'];

/**
 * Só o SITE depende do horário: a equipe (WHATSAPP, SALAO) lança fora do
 * turno, ex.: cliente do salão que continua comendo depois do fim do turno.
 */
export const canalExigeLojaAberta = (canal) => canal === 'SITE';

/** Comanda do salão nasce aberta; site e WhatsApp já confirmados (é quando baixa o estoque). */
const STATUS_INICIAL = { SITE: 'CONFIRMADO', WHATSAPP: 'CONFIRMADO', SALAO: 'ABERTO' };

/**
 * Status de pedido "ainda aberto" (no painel; pode ser finalizado ou cancelado).
 * EM_PREPARO e SAIU_ENTREGA: andamento do delivery/encomenda, só no PDV.
 */
export const STATUS_ABERTOS = ['ABERTO', 'CONFIRMADO', 'EM_PREPARO', 'SAIU_ENTREGA'];

/** Status que a equipe escolhe no painel (delivery/encomenda abertos). */
export const STATUS_ANDAMENTO = ['ABERTO', 'EM_PREPARO', 'SAIU_ENTREGA'];

/**
 * Pagamento online ainda não aprovado (ou que expirou): o pedido não existe para a
 * equipe (lista do dia, fila, caixa, ações do painel) até a aprovação.
 */
export const STATUS_FORA_DO_PDV = ['AGUARDANDO_PAGAMENTO', 'EXPIRADO'];

/** Teto da taxa de entrega digitada no PDV (R$ 1.000,00): acima disso é erro de digitação. */
export const TAXA_MANUAL_MAX_CENTAVOS = 100_000;

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
export function conferirTotalEsperado(totalEsperadoCentavos, valores, { taxaBairroCentavos = null, freteGratis = null } = {}) {
  if (totalEsperadoCentavos === valores.totalCentavos) return;
  throw new ErroHttp(409, 'Os preços mudaram. Confira o novo total e confirme de novo.', {
    codigo: 'PRECO_ALTERADO',
    detalhes: {
      subtotalCentavos: valores.subtotalCentavos,
      taxaEntregaCentavos: valores.taxaEntregaCentavos,
      totalCentavos: valores.totalCentavos,
      // Para o site refazer a prévia: taxa do bairro (antes do frete grátis) e a regra vigente.
      taxaBairroCentavos,
      freteGratis,
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
 * Ajustes da equipe (nunca do site): taxa digitada no lugar da do bairro e
 * desconto (até o subtotal dos itens). total = subtotal + taxa − desconto.
 */
export function aplicarAjustes(valores, { descontoCentavos = 0, taxaManualCentavos = null } = {}) {
  const taxaEntregaCentavos = taxaManualCentavos ?? valores.taxaEntregaCentavos;
  if (descontoCentavos > valores.subtotalCentavos) {
    const mensagem = 'O desconto não pode ser maior que o valor dos itens';
    throw new ErroHttp(400, mensagem, { codigo: 'DESCONTO_INVALIDO', detalhes: [{ campo: 'descontoCentavos', mensagem }] });
  }
  return {
    ...valores,
    taxaEntregaCentavos,
    descontoCentavos,
    totalCentavos: valores.subtotalCentavos + taxaEntregaCentavos - descontoCentavos,
  };
}

/**
 * Encomenda: horário no futuro e no MESMO dia operacional de agora (decisão
 * do dono: por enquanto, só encomendas para hoje). 422 AGENDAMENTO_INVALIDO.
 */
export function validarAgendamento(agendadoPara, agora, horaVirada) {
  const erro = (mensagem) =>
    new ErroHttp(422, mensagem, { codigo: 'AGENDAMENTO_INVALIDO', detalhes: [{ campo: 'agendadoPara', mensagem }] });
  if (!(agendadoPara instanceof Date) || Number.isNaN(agendadoPara.getTime())) throw erro('Informe a data e o horário');
  if (agendadoPara.getTime() <= agora.getTime()) throw erro('O horário da encomenda já passou');
  if (diaOperacional(agendadoPara, horaVirada) !== diaOperacional(agora, horaVirada)) {
    throw erro('Por enquanto, encomendas só para o expediente de hoje');
  }
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
    `Acabou: ${nomes.join(', ')}${insumo ? ` (sem ${insumo.toLowerCase()})` : ''}. Remova do pedido para continuar.`,
    { codigo: 'ESTOQUE_INSUFICIENTE', detalhes: { produtos: nomes, insumo: insumo ?? null } },
  );

/**
 * Baixa atômica, na ordem de `necessidadesDeEstoque`. Qualquer count = 0
 * lança 409 dizendo o que acabou; a transação desfaz as baixas anteriores.
 */
export async function baixarEstoque(tx, { produtos, insumos }) {
  // Produtos e insumos já vêm da loja do pedido (buscarProdutosParaPedido filtra a loja).
  for (const p of produtos) {
    if ((await pedidoRepo.baixarEstoqueProduto(p.id, p.quantidade, tx)) === 0) throw estoqueAcabou([p.nome]);
  }
  for (const i of insumos) {
    if ((await pedidoRepo.baixarEstoqueInsumo(i.id, i.quantidade, tx)) === 0) {
      throw estoqueAcabou(i.produtos, i.nome);
    }
  }
}

/**
 * Posições e distância para gravar no pedido (fotos do momento da compra).
 * Sem pino do endereço ou da loja: grava o que houver, sem distância. Nunca lança.
 */
async function distanciaDaEntrega(lojaId, destino, agora, mapas = mapasPadrao()) {
  try {
    const loja = pinDe(await mapaRepo.pinDaLoja(lojaId));
    return await mapas.distanciaDoPedido({ loja, destino, agora });
  } catch (err) {
    console.warn(`[mapas] distância do pedido não calculada: ${err.message}`);
    return null;
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
    descontoCentavos: p.descontoCentavos ?? 0,
    totalCentavos: p.totalCentavos,
    formaPagamento: p.formaPagamento,
    trocoParaCentavos: p.trocoParaCentavos,
    pagoEm: p.pagoEm ?? null,
    mesaRotulo: p.mesaRotulo,
    tempoEstimadoMin: p.tempoEstimadoMin,
    encomenda: p.encomenda ?? false,
    agendadoPara: p.agendadoPara ?? null,
    retirarNoBalcao: p.retirarNoBalcao ?? false,
    observacao: p.observacao ?? null,
    criadoEm: p.criadoEm,
    // Loja do pedido (histórico do app multi-loja; o site atual ignora).
    ...(p.loja && { loja: { nome: p.loja.nome, slug: p.loja.slug, logoUrl: p.loja.logoUrl ?? null } }),
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

/**
 * Mapa da entrega para a equipe (PDV e cupom): link do Google Maps com o pino
 * do momento da compra e a distância da loja (estimada = linha reta × 1,3).
 */
export function entregaNoMapa(p) {
  const pin = pinDe(p, { lat: 'latitudeEntrega', lng: 'longitudeEntrega' });
  return {
    linkMapa: linkDoMapa(pin),
    distanciaMetros: p.distanciaMetros ?? null,
    distanciaEstimada: p.distanciaOrigem === 'ESTIMADA',
  };
}

/**
 * Pedido como a equipe vê (lista do PDV e eventos do socket): o público +
 * dia operacional, quem registrou, quando encerrou e o mapa da entrega. Nunca vai para o site.
 */
export function pedidoDaEquipe(p) {
  return {
    ...pedidoPublico(p),
    ...entregaNoMapa(p),
    dataRef: p.dataRef ? new Date(p.dataRef).toISOString().slice(0, 10) : null,
    registradoPor: p.criadoPor?.nome ?? null,
    finalizadoEm: p.finalizadoEm ?? null,
    canceladoEm: p.canceladoEm ?? null,
    chaveNfce: p.chaveNfce ?? null,
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
 *   lojaId: number,  // o pedido é sempre de uma loja: produtos, bairro, caixa, número e configuração dela
 *   canal: 'SITE' | 'WHATSAPP' | 'SALAO',
 *   itens: { produtoId: number, quantidade: number, pesoGramas?: number, observacao?: string | null }[],
 *   cliente?: { id?: number, nome: string, telefone?: string | null } | null,
 *   endereco?: { texto: string, bairroId: number, pin?: { latitude: number, longitude: number } | null } | null,
 *   pagamento?: { forma?: string | null, trocoParaCentavos?: number | null },
 *   entrega?: { encomenda?: boolean, agendadoPara?: Date | null, retirarNoBalcao?: boolean },
 *   ajustes?: { descontoCentavos?: number, taxaManualCentavos?: number | null },  // só equipe (WHATSAPP)
 *   observacao?: string | null,
 *   pagoAgora?: boolean,  // só equipe: grava pagoEm + caixaId (exige caixa aberto)
 *   usuarioId?: number | null,
 *   mesaRotulo?: string | null,
 *   chaveIdempotencia?: string | null,
 *   totalEsperadoCentavos?: number,  // obrigatório no SITE: total que o cliente viu
 *   agora?: Date,
 *   mapas?: object,  // serviço de mapas (padrão: o do ambiente); distância loja → cliente
 * }} dados
 * @returns {Promise<{ pedido: object, criado: boolean }>} criado=false: mesma chave já tinha pedido
 */
export async function criarPedido({
  lojaId,
  canal,
  itens,
  cliente = null,
  endereco = null,
  pagamento = {},
  entrega = {},
  ajustes = {},
  observacao = null,
  pagoAgora = false,
  usuarioId = null,
  mesaRotulo = null,
  chaveIdempotencia = null,
  totalEsperadoCentavos,
  agora = new Date(),
  mapas,
}) {
  if (!Number.isInteger(lojaId)) throw new Error('criarPedido: lojaId obrigatório');
  if (!CANAIS.includes(canal)) throw new ErroHttp(400, 'Canal inválido', { codigo: 'VALIDACAO' });
  if (!itens?.length) throw new ErroHttp(400, 'O pedido não tem itens', { codigo: 'VALIDACAO' });
  if (canal === 'SITE' && !Number.isInteger(totalEsperadoCentavos)) {
    throw new ErroHttp(400, 'Informe o total do pedido', { codigo: 'VALIDACAO' });
  }
  const ent = {
    encomenda: entrega.encomenda === true,
    agendadoPara: entrega.agendadoPara ?? null,
    retirarNoBalcao: entrega.retirarNoBalcao === true,
  };
  const aj = { descontoCentavos: ajustes.descontoCentavos ?? 0, taxaManualCentavos: ajustes.taxaManualCentavos ?? null };
  // Encomenda, retirada, desconto, taxa digitada e "pago agora" são da equipe no
  // delivery: o site nunca manda (preço e taxa do site saem só do banco).
  const temExtras = ent.encomenda || ent.retirarNoBalcao || aj.descontoCentavos !== 0 || aj.taxaManualCentavos != null || pagoAgora;
  if (canal !== 'WHATSAPP' && temExtras) {
    throw new ErroHttp(400, 'Opção não permitida neste canal', { codigo: 'VALIDACAO' });
  }
  if (ent.retirarNoBalcao && (!ent.encomenda || endereco)) {
    throw new ErroHttp(400, 'Retirada no balcão é só para encomenda, sem endereço', { codigo: 'VALIDACAO' });
  }
  if (!Number.isInteger(aj.descontoCentavos) || aj.descontoCentavos < 0) {
    throw new ErroHttp(400, 'Desconto inválido', { codigo: 'DESCONTO_INVALIDO' });
  }
  const taxa = aj.taxaManualCentavos;
  if (taxa != null && (!Number.isInteger(taxa) || taxa < 0 || taxa > TAXA_MANUAL_MAX_CENTAVOS)) {
    throw new ErroHttp(400, 'Taxa de entrega inválida', { codigo: 'VALIDACAO' });
  }
  if (ent.retirarNoBalcao) aj.taxaManualCentavos = 0; // retirada nunca tem taxa

  if (chaveIdempotencia) {
    const existente = await pedidoRepo.buscarPorChave(chaveIdempotencia);
    if (existente) return reaproveitar(existente, cliente, lojaId);
  }

  // Distância loja → cliente, FORA da transação (não segura travas): cache, rota
  // com tempo limite de 1,5 s ou linha reta × 1,3. Nunca falha o pedido; a taxa
  // continua a da área de entrega (a por km é do lote dos entregadores).
  const geo = endereco ? await distanciaDaEntrega(lojaId, endereco.pin ?? null, agora, mapas) : null;

  let resultado;
  try {
    resultado = await prisma.$transaction(
      (tx) =>
        criarNaTransacao(tx, {
          lojaId,
          canal,
          itens,
          cliente,
          endereco,
          pagamento,
          entrega: ent,
          ajustes: aj,
          observacao,
          pagoAgora,
          usuarioId,
          mesaRotulo,
          chaveIdempotencia,
          totalEsperadoCentavos,
          agora,
          geo,
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
      return reaproveitar(await pedidoRepo.buscarPorChave(chaveIdempotencia), cliente, lojaId);
    }
    throw err;
  }

  // Só depois do commit: a equipe nunca recebe pedido que não existe.
  emitirParaEquipe(lojaId, 'pedido:novo', pedidoDaEquipe(resultado.pedido));
  emitirParaEquipe(lojaId, 'impressao:nova', resultado.trabalho);
  return { pedido: pedidoPublico(resultado.pedido), criado: true };
}

function reaproveitar(existente, cliente, lojaId) {
  if ((cliente?.id && existente.clienteId !== cliente.id) || existente.lojaId !== lojaId) {
    throw new ErroHttp(409, 'Chave de pedido já usada', { codigo: 'CHAVE_EM_USO' });
  }
  return { pedido: pedidoPublico(existente), criado: false };
}

const NOME_FORMA = { PIX: 'Pix', DINHEIRO: 'dinheiro', DEBITO: 'cartão de débito', CREDITO: 'cartão de crédito' };

/**
 * Regras do entregador da plataforma (docs/pagamento-online.md, Decisão 11 e as da Etapa 2):
 * - pedido do cliente (app/site) com entrega precisa do pino no mapa (a taxa é por km):
 *   422 PINO_OBRIGATORIO; o PDV não marca pino e usa a taxa da área como reserva;
 * - pago na entrega, só dinheiro (o entregador não leva maquininha nem recebe Pix da loja):
 *   422 FORMA_INDISPONIVEL. Retirada no balcão e "pago agora" no balcão aceitam todas.
 * Loja com motoboy próprio: nada muda.
 */
export function conferirModoEntrega(loja, { canal, endereco, pagamento, pagoAgora = false }) {
  if (loja?.modoEntrega !== 'PLATAFORMA' || canal === 'SALAO') return;
  if (canal === 'SITE' && endereco && !endereco.pin) {
    throw new ErroHttp(422, 'Marque no mapa onde fica o endereço de entrega para pedir nesta loja.', {
      codigo: 'PINO_OBRIGATORIO',
    });
  }
  const forma = pagamento?.forma;
  if (forma && !formaNaEntregaPermitida({ modoEntrega: loja.modoEntrega, forma, comEntrega: Boolean(endereco), pagoAgora })) {
    throw new ErroHttp(422, `${loja.nome} não aceita ${NOME_FORMA[forma] ?? forma} na entrega. Escolha outra forma de pagamento.`, {
      codigo: 'FORMA_INDISPONIVEL',
      detalhes: { aceitas: formasDePagamento({ modoEntrega: loja.modoEntrega }).naEntrega },
    });
  }
}

async function criarNaTransacao(tx, d) {
  // 0. "Pago agora": trava o caixa aberto antes de tudo (mesma ordem de travas
  //    da finalização: caixa → resto). O pedido já entra neste caixa.
  let caixaId = null;
  if (d.pagoAgora) {
    caixaId = await caixaRepo.travarAbertoCompartilhado(d.lojaId, tx);
    if (!caixaId) {
      throw new ErroHttp(409, 'O caixa está fechado. Abra o caixa para continuar.', { codigo: 'CAIXA_FECHADO' });
    }
  }

  // 1. Loja aberta agora? (só o SITE; a equipe lança fora do horário)
  const turno = calcularTurnoAtivo(await turnoRepo.listarAtivosComHorarios(d.lojaId, tx), d.agora);
  if (!turno && canalExigeLojaAberta(d.canal)) {
    throw new ErroHttp(409, 'Estamos fechados agora. Os pedidos voltam quando abrirmos.', { codigo: 'LOJA_FECHADA' });
  }

  // 2. Produtos ainda vendáveis (lidos do banco, nunca do front).
  const ids = [...new Set(d.itens.map((i) => i.produtoId))];
  const produtosPorId = new Map((await pedidoRepo.buscarProdutosParaPedido(d.lojaId, ids, tx)).map((p) => [p.id, p]));
  const indisponiveis = [];
  for (const id of ids) {
    const motivo = motivoIndisponivel(produtosPorId.get(id), { canal: d.canal, turnoId: turno?.id });
    if (motivo) indisponiveis.push({ produtoId: id, nome: produtosPorId.get(id)?.nome ?? null, motivo });
  }
  if (indisponiveis.length) {
    const nomes = indisponiveis.map((i) => i.nome ?? `produto ${i.produtoId}`).join(', ');
    throw new ErroHttp(409, `Indisponível agora: ${nomes}. Remova do pedido para continuar.`, {
      codigo: 'PRODUTO_INDISPONIVEL',
      detalhes: indisponiveis,
    });
  }

  // 3. Taxa de entrega: a da área de entrega da loja para o bairro do endereço
  //    (bairro da cidade). A loja não entrega lá = 422 BAIRRO_FORA_DA_AREA.
  const config = await lojaRepo.buscarPorId(d.lojaId, tx);
  let bairro = null;
  if (d.endereco) bairro = await taxaDaLoja(d.lojaId, d.endereco.bairroId, { lojaNome: config?.nome }, tx);

  // 4. Preços e totais recalculados; pagamento conferido contra o total do servidor.
  //    Frete grátis (configuração da loja): subtotal dos itens >= mínimo zera a
  //    taxa. Site sempre; WhatsApp só com `freteGratisWhatsapp` (padrão ligado). O site nunca manda taxa.
  const freteGratis = freteGratisDaConfig(config, { canal: d.canal });
  const doItens = calcularValores(d.itens, produtosPorId);
  const taxa = bairro ? taxaDeEntrega(bairro.taxaCentavos, doItens.subtotalCentavos, freteGratis) : 0;
  // Ajustes (desconto, taxa digitada) só chegam pela equipe; no site ficam zerados.
  const valores = aplicarAjustes(
    { ...doItens, taxaEntregaCentavos: taxa, totalCentavos: doItens.subtotalCentavos + taxa },
    d.ajustes,
  );
  if (d.entrega.encomenda) validarAgendamento(d.entrega.agendadoPara, d.agora, horaViradaDe(config));
  if (d.canal === 'SITE') {
    conferirTotalEsperado(d.totalEsperadoCentavos, valores, { taxaBairroCentavos: bairro?.taxaCentavos ?? null, freteGratis });
  }
  validarPagamento(d.pagamento, valores.totalCentavos, { obrigatorio: d.canal !== 'SALAO' });
  conferirModoEntrega(config, d);

  // 5. Baixa atômica do estoque (409 com o nome do que acabou).
  await baixarEstoque(tx, necessidadesDeEstoque(valores.linhas));

  // 6. Número do dia (dia OPERACIONAL: vira às horaViradaDia, não à meia-noite),
  //    atômico e sem buraco em caso de rollback.
  const dia = diaOperacional(d.agora, horaViradaDe(config));
  const numeroDia = await pedidoRepo.proximoNumeroDoDia(d.lojaId, dia, tx);

  // 7. Pedido com snapshots.
  const { id: pedidoId } = await pedidoRepo.criarPedido(
    {
      lojaId: d.lojaId,
      numeroDia,
      dataRef: paraCampoData(dia),
      canal: d.canal,
      status: STATUS_INICIAL[d.canal],
      clienteId: d.cliente?.id ?? null,
      nomeCliente: d.cliente?.nome ?? (d.mesaRotulo ? `Mesa ${d.mesaRotulo}` : 'Cliente'),
      telefone: d.cliente?.telefone ?? null,
      enderecoTexto: d.endereco?.texto ?? null,
      bairroNome: bairro?.nome ?? null,
      subtotalCentavos: valores.subtotalCentavos,
      taxaEntregaCentavos: valores.taxaEntregaCentavos,
      descontoCentavos: valores.descontoCentavos,
      totalCentavos: valores.totalCentavos,
      formaPagamento: d.pagamento?.forma ?? null,
      trocoParaCentavos: d.pagamento?.trocoParaCentavos ?? null,
      mesaRotulo: d.mesaRotulo,
      // Encomenda tem horário marcado: sem "tempo estimado".
      tempoEstimadoMin: config && !d.entrega.encomenda ? calcularTempoEstimado(config, d.agora) : null,
      encomenda: d.entrega.encomenda,
      agendadoPara: d.entrega.encomenda ? d.entrega.agendadoPara : null,
      retirarNoBalcao: d.entrega.retirarNoBalcao,
      observacao: d.observacao,
      pagoEm: d.pagoAgora ? d.agora : null,
      caixaId,
      criadoPorId: d.usuarioId,
      chaveIdempotencia: d.chaveIdempotencia,
      ...(d.geo ?? {}),
    },
    tx,
  );

  // 8. Itens (snapshot de nome e preço) + histórico de estoque por item.
  await gravarItens(tx, pedidoId, valores.linhas, d.usuarioId);

  // 9. Fila de impressão.
  const trabalho = await pedidoRepo.criarTrabalhoImpressao(
    { lojaId: d.lojaId, pedidoId, tipo: 'PEDIDO', status: 'PENDENTE' },
    tx,
  );

  return { pedido: await pedidoRepo.buscarPorId(pedidoId, tx), trabalho };
}

// ───────── Site ─────────

/**
 * Pedido do site na loja dada: exige telefone e um endereço do próprio cliente;
 * nome e telefone vêm do cadastro, não do corpo da requisição.
 */
export async function criarPedidoDoSite(
  lojaId,
  cliente,
  { itens, enderecoId, formaPagamento, trocoParaCentavos, chaveIdempotencia, totalEsperadoCentavos },
  { agora, mapas } = {},
) {
  garantirTelefone(cliente);
  const endereco = await enderecoRepo.buscarDoCliente(cliente.id, enderecoId);
  if (!endereco) {
    throw new ErroHttp(422, 'Escolha um endereço de entrega', { codigo: 'ENDERECO_INVALIDO' });
  }
  return criarPedido({
    lojaId,
    canal: 'SITE',
    itens,
    cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone },
    endereco: { texto: formatarEndereco(endereco), bairroId: endereco.bairro.id, pin: pinDe(endereco) },
    pagamento: { forma: formaPagamento, trocoParaCentavos: trocoParaCentavos ?? null },
    chaveIdempotencia,
    totalEsperadoCentavos,
    agora,
    mapas,
  });
}

export const PEDIDOS_POR_PAGINA = 20;

/**
 * Histórico do cliente (aba "Pedidos" do site), mais novo primeiro.
 * `proximo` = id para pedir a página seguinte (null = acabou).
 */
export async function pedidosDoCliente(clienteId, { antesDeId, lojaId } = {}) {
  const lista = await pedidoRepo.listarDoCliente(clienteId, { antesDeId, lojaId, limite: PEDIDOS_POR_PAGINA + 1 });
  const pagina = lista.slice(0, PEDIDOS_POR_PAGINA);
  return {
    pedidos: pagina.map(pedidoPublico),
    proximo: lista.length > PEDIDOS_POR_PAGINA ? pagina.at(-1).id : null,
  };
}

/** Último pedido do cliente NA LOJA (para "Repetir último pedido"), ou null. */
export async function ultimoPedidoDoCliente(clienteId, lojaId) {
  const p = await pedidoRepo.ultimoDoCliente(clienteId, lojaId);
  return p ? pedidoPublico(p) : null;
}

// ───────── WhatsApp (lançado pela equipe no PDV) ─────────

/**
 * Pedido do WhatsApp: cliente e endereço do cadastro (o endereço precisa ser
 * daquele cliente). Mesmo `criarPedido` do site: preço do banco, baixa
 * atômica, número do dia, impressão. Sem trava de horário (canal da equipe).
 */
export async function criarPedidoDoWhatsapp(
  lojaId,
  {
    clienteId,
    enderecoId,
    itens,
    formaPagamento,
    trocoParaCentavos,
    chaveIdempotencia,
    encomenda = false,
    agendadoPara = null,
    retirarNoBalcao = false,
    descontoCentavos = 0,
    taxaEntregaCentavos = null,
    observacao = null,
    pagoAgora = false,
  },
  { usuarioId, agora, mapas } = {},
) {
  const cliente = await clienteRepo.buscarPorId(clienteId);
  if (!cliente) throw new ErroHttp(422, 'Escolha o cliente', { codigo: 'CLIENTE_INVALIDO' });
  // Retirada no balcão (só encomenda) não tem endereço; o resto exige um endereço do cliente.
  let endereco = null;
  if (!retirarNoBalcao) {
    endereco = enderecoId ? await enderecoRepo.buscarDoCliente(cliente.id, enderecoId) : null;
    if (!endereco) {
      throw new ErroHttp(422, 'Escolha um endereço de entrega do cliente', { codigo: 'ENDERECO_INVALIDO' });
    }
  }
  return criarPedido({
    lojaId,
    canal: 'WHATSAPP',
    itens,
    cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone },
    endereco: endereco && { texto: formatarEndereco(endereco), bairroId: endereco.bairro.id, pin: pinDe(endereco) },
    pagamento: { forma: formaPagamento, trocoParaCentavos: trocoParaCentavos ?? null },
    entrega: { encomenda, agendadoPara, retirarNoBalcao },
    ajustes: { descontoCentavos, taxaManualCentavos: taxaEntregaCentavos },
    observacao,
    pagoAgora,
    usuarioId,
    chaveIdempotencia,
    agora,
    mapas,
  });
}

// ───────── Andamento no painel do PDV ─────────

const pedidoNaoEncontrado = () => new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });

/**
 * Pedido de outra loja não existe para quem é desta (404, como inexistente). O que
 * aguarda pagamento online ou expirou também não existe para a equipe.
 */
export const ehDaLoja = (pedido, lojaId) =>
  Boolean(pedido) && pedido.lojaId === lojaId && !STATUS_FORA_DO_PDV.includes(pedido.status);

function pedidoEncerrado(status) {
  return new ErroHttp(409, `Pedido já está ${status === 'CANCELADO' ? 'cancelado' : 'finalizado'}`, {
    codigo: 'PEDIDO_ENCERRADO',
  });
}

/**
 * Andamento do delivery/encomenda (Em aberto, Em preparo, Saiu para entrega).
 * Só pedido do site/WhatsApp (comanda do salão = 404); UPDATE condicionado
 * ao status aberto (já encerrado = 409 PEDIDO_ENCERRADO).
 */
export async function alterarStatus(lojaId, id, status) {
  if (!STATUS_ANDAMENTO.includes(status)) throw new ErroHttp(400, 'Status inválido', { codigo: 'VALIDACAO' });
  const pedido = await prisma.$transaction(async (tx) => {
    const atual = await pedidoRepo.buscarStatus(id, tx);
    if (!ehDaLoja(atual, lojaId) || atual.canal === 'SALAO') throw pedidoNaoEncontrado();
    if ((await pedidoRepo.atualizarSeAberto(id, { status }, STATUS_ABERTOS, tx)) === 0) throw pedidoEncerrado(atual.status);
    return pedidoRepo.buscarPorId(id, tx);
  }, OPCOES_TRANSACAO);
  const equipe = pedidoDaEquipe(pedido);
  emitirParaEquipe(lojaId, 'pedido:atualizado', equipe);
  return equipe;
}

/** Novo horário de uma encomenda aberta (mesmas regras da criação: futuro e no mesmo dia operacional). */
export async function alterarAgendamento(lojaId, id, agendadoPara, agora = new Date()) {
  const pedido = await prisma.$transaction(async (tx) => {
    const atual = await pedidoRepo.buscarPorId(id, tx);
    if (!ehDaLoja(atual, lojaId) || atual.canal === 'SALAO') throw pedidoNaoEncontrado();
    if (!STATUS_ABERTOS.includes(atual.status)) throw pedidoEncerrado(atual.status);
    if (!atual.encomenda) throw new ErroHttp(409, 'Este pedido não é encomenda', { codigo: 'NAO_E_ENCOMENDA' });
    validarAgendamento(agendadoPara, agora, horaViradaDe(await lojaRepo.buscarPorId(lojaId, tx)));
    if ((await pedidoRepo.atualizarSeAberto(id, { agendadoPara }, STATUS_ABERTOS, tx)) === 0) throw pedidoEncerrado(atual.status);
    return pedidoRepo.buscarPorId(id, tx);
  }, OPCOES_TRANSACAO);
  const equipe = pedidoDaEquipe(pedido);
  emitirParaEquipe(lojaId, 'pedido:atualizado', equipe);
  return equipe;
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
export async function cancelarPedido(lojaId, id, { usuarioId = null, agora = new Date() } = {}) {
  const { pedido, trabalho } = await prisma.$transaction(async (tx) => {
    const count = await pedidoRepo.cancelarSeAberto(lojaId, id, agora, STATUS_ABERTOS, tx);
    if (count === 0) {
      const atual = await pedidoRepo.buscarStatus(id, tx);
      if (!ehDaLoja(atual, lojaId)) throw pedidoNaoEncontrado();
      throw pedidoEncerrado(atual.status);
    }

    await estornarVendas(tx, await pedidoRepo.vendasDoPedido(id, tx), usuarioId);
    // Frete grátis da primeira compra volta para o telefone (reservado ou já usado).
    await liberarCampanha(tx, id);

    const pedido = await pedidoRepo.buscarPorId(id, tx);
    const trabalho =
      pedido.canal === 'SALAO'
        ? null
        : await pedidoRepo.criarTrabalhoImpressao({ lojaId, pedidoId: id, tipo: 'CANCELAMENTO', status: 'PENDENTE' }, tx);
    return { pedido, trabalho };
  }, OPCOES_TRANSACAO);

  const equipe = pedidoDaEquipe(pedido);
  emitirParaEquipe(lojaId, 'pedido:atualizado', equipe);
  if (trabalho) emitirParaEquipe(lojaId, 'impressao:nova', trabalho);
  return equipe;
}

// ───────── NFC-e (prova de emissão da nota) ─────────

/**
 * Grava (ou apaga, com null) a chave de acesso da NFC-e da venda. Só pedido da
 * loja (senão 404); cancelado = 409 PEDIDO_CANCELADO; chave inválida (44 números,
 * modelo 65, dígito verificador) = 400 VALIDACAO; chave já usada em outro pedido
 * = 409 CHAVE_NFCE_EM_USO. Avisa a equipe (`pedido:atualizado`).
 * @param {string | null} chave como digitada (espaços e pontos são ignorados)
 */
export async function definirChaveNfce(lojaId, id, chave) {
  const chaveNfce = chave == null ? null : limparChave(chave);
  if (chaveNfce != null) {
    const problema = problemaNaChave(chaveNfce);
    if (problema) {
      throw new ErroHttp(400, problema, { codigo: 'VALIDACAO', detalhes: [{ campo: 'chaveNfce', mensagem: problema }] });
    }
  }
  const atual = await pedidoRepo.buscarStatus(id);
  if (!ehDaLoja(atual, lojaId)) throw pedidoNaoEncontrado();
  if (atual.status === 'CANCELADO') {
    throw new ErroHttp(409, 'Pedido cancelado não tem nota', { codigo: 'PEDIDO_CANCELADO' });
  }
  try {
    await pedidoRepo.definirChaveNfce(id, chaveNfce);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ErroHttp(409, 'Esta chave de NFC-e já está em outro pedido', { codigo: 'CHAVE_NFCE_EM_USO' });
    }
    throw err;
  }
  const equipe = pedidoDaEquipe(await pedidoRepo.buscarPorId(id));
  emitirParaEquipe(lojaId, 'pedido:atualizado', equipe);
  return equipe;
}
