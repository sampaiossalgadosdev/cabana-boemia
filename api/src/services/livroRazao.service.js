/**
 * Livro-razão da loja e fechamento semanal (Etapa 6 de docs/pagamento-online.md; Decisões 4, 14,
 * 15 e 16 e as da Etapa 6). Positivo = a loja deve ao Taaki; negativo = o Taaki deve à loja.
 *
 * Lançamentos automáticos (dentro da transação de quem chama; nunca duplicam: índice único
 * parcial `(pedidoId, tipo)` + `ON CONFLICT DO NOTHING`):
 * - TAXA_ENTREGA_DINHEIRO: finalização de pedido com entrega pelo Taaki que NÃO foi pago online
 *   (dinheiro na entrega, "pago agora" no balcão). Valor = taxa cheia, também com o frete grátis
 *   da loja; com o frete grátis da campanha, nada (o Taaki paga).
 * - TAXA_ENTREGA_COMPLEMENTO: aprovação do Pix, a parte do devido que não coube no split (trava de 50%).
 * - CREDITO_CAMPANHA: finalização de pedido de loja com motoboy próprio com o frete grátis da
 *   campanha (qualquer forma). Valor = −(taxa da área que a loja cobraria).
 * - ESTORNO: cancelamento (qualquer caminho) desfaz cada lançamento automático do pedido.
 * O modo de entrega que vale é o do pedido na criação: `origemTaxaEntrega` preenchida = entregador
 * do Taaki (a loja pode mudar de modo depois).
 *
 * Semana = segunda a domingo pelo dia operacional da loja (America/Sao_Paulo, `horaViradaDia`).
 * O lançamento é da semana em que foi criado. A rotina fecha cada semana terminada (com folga)
 * que tem lançamento sem fechamento; semana fechada nunca muda (triggers no banco).
 */
import { Prisma } from '@prisma/client';
import { formatarDinheiro } from '@restaurante/shared/cupom';
import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { diaOperacional, intervaloDoDia, localParaUtc, paraCampoData, diaLocal } from '../lib/fuso.js';
import { horaViradaDe } from './diaOperacional.service.js';
import { criarAlerta } from './alerta.service.js';

export const TIPOS_AUTOMATICOS = ['TAXA_ENTREGA_DINHEIRO', 'TAXA_ENTREGA_COMPLEMENTO', 'CREDITO_CAMPANHA'];
/** A semana só é fechada 10 min depois de acabar: uma transação começada antes ainda pode gravar. */
export const FOLGA_FECHAMENTO_MS = 10 * 60 * 1000;
export const INTERVALO_ROTINA_FECHAMENTO_MS = 60 * 60 * 1000;
export const ATRASO_PADRAO_DIAS = 7;
export const ORCAMENTO_CAMPANHA_PADRAO_CENTAVOS = 70_000;
export const AJUSTE_MAX_CENTAVOS = 10_000_000;

export const DESCRICAO_LANCAMENTO = {
  TAXA_ENTREGA_DINHEIRO: 'Taxa de entrega do Taaki (pagamento recebido pela loja)',
  TAXA_ENTREGA_COMPLEMENTO: 'Taxa de entrega do Taaki (parte que não coube no Pix)',
  CREDITO_CAMPANHA: 'Frete grátis da primeira compra (pago pelo Taaki)',
  AJUSTE_MANUAL: 'Ajuste do Taaki',
  ESTORNO: 'Pedido cancelado: desfaz um lançamento',
};

// ───────── Regras puras ─────────

/** Entrega pelo Taaki (decidido na criação do pedido). */
export const entregaPeloTaaki = (p) => p.origemTaxaEntrega != null;

/** Taxa de entrega antes do frete grátis. */
export function taxaCheiaDoPedido(p) {
  if (entregaPeloTaaki(p)) return (p.valorEntregadorCentavos ?? 0) + (p.valorPlataformaEntregaCentavos ?? 0);
  return p.taxaEntregaCheiaCentavos ?? null;
}

/** O que a loja deve ao Taaki pela entrega (antes da trava do split). */
export function devidoPelaLoja(p) {
  if (!entregaPeloTaaki(p) || p.origemFreteGratis === 'CAMPANHA') return 0;
  return taxaCheiaDoPedido(p);
}

/** Lançamentos da finalização do pedido: `[{ tipo, valorCentavos }]`. */
export function lancamentosDaFinalizacao(p) {
  const lista = [];
  const devido = devidoPelaLoja(p);
  if (devido > 0 && !p.meioOnline) lista.push({ tipo: 'TAXA_ENTREGA_DINHEIRO', valorCentavos: devido });
  const cheia = taxaCheiaDoPedido(p);
  if (!entregaPeloTaaki(p) && p.origemFreteGratis === 'CAMPANHA' && cheia > 0) {
    lista.push({ tipo: 'CREDITO_CAMPANHA', valorCentavos: -cheia });
  }
  return lista;
}

/** Complemento da trava de 50% (só pedido pago online com entrega pelo Taaki). */
export function complementoDaAprovacao(p, valorNoSplitCentavos) {
  if (!p.meioOnline) return 0;
  return Math.max(0, devidoPelaLoja(p) - (valorNoSplitCentavos ?? 0));
}

const somarDias = (dia, n) => {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Segunda-feira ("YYYY-MM-DD") da semana do dia dado. */
export function segundaDaSemana(dia) {
  const semana = new Date(`${dia}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return somarDias(dia, -((semana + 6) % 7));
}

/**
 * Semana operacional de um instante: `inicio` (segunda) e `fim` (a segunda seguinte, exclusiva),
 * mais o intervalo UTC `[de, ate)` pelas viradas do dia.
 */
export function semanaDe(instante, horaVirada) {
  return semanaQueComecaEm(segundaDaSemana(diaOperacional(instante, horaVirada)), horaVirada);
}

export function semanaQueComecaEm(inicio, horaVirada) {
  const fim = somarDias(inicio, 7);
  return { inicio, fim, domingo: somarDias(inicio, 6), de: intervaloDoDia(inicio, horaVirada).inicio, ate: intervaloDoDia(fim, horaVirada).inicio };
}

export function diasDeAtraso(env = process.env) {
  const n = Number(String(env.FECHAMENTO_ATRASO_DIAS ?? '').trim());
  return Number.isInteger(n) && n > 0 && String(env.FECHAMENTO_ATRASO_DIAS).trim() !== '' ? n : ATRASO_PADRAO_DIAS;
}

export function orcamentoCampanha(env = process.env) {
  const bruto = String(env.CAMPANHA_ORCAMENTO_CENTAVOS ?? '').trim();
  const n = Number(bruto);
  return bruto !== '' && Number.isInteger(n) && n >= 0 ? n : ORCAMENTO_CAMPANHA_PADRAO_CENTAVOS;
}

/** Saldo em linguagem simples (do ponto de vista da loja). */
export function textoDoSaldo(saldoCentavos) {
  if (saldoCentavos > 0) return `Você deve ao Taaki ${formatarDinheiro(saldoCentavos)}`;
  if (saldoCentavos < 0) return `O Taaki deve a você ${formatarDinheiro(-saldoCentavos)}`;
  return 'Nenhum valor a acertar com o Taaki';
}

// ───────── Lançamentos (dentro da transação de quem chama) ─────────

const CAMPOS_PEDIDO = {
  id: true,
  lojaId: true,
  meioOnline: true,
  origemTaxaEntrega: true,
  origemFreteGratis: true,
  valorEntregadorCentavos: true,
  valorPlataformaEntregaCentavos: true,
  taxaEntregaCheiaCentavos: true,
};

async function inserir(tx, pedido, lista, agora) {
  if (!lista.length) return 0;
  const { count } = await tx.lancamentoLoja.createMany({
    data: lista.map((l) => ({ lojaId: pedido.lojaId, pedidoId: pedido.id, criadoEm: agora, ...l })),
    skipDuplicates: true, // ON CONFLICT DO NOTHING: o índice parcial impede o mesmo tipo duas vezes
  });
  return count;
}

/** Na finalização (mesma transação). */
export async function lancarNaFinalizacao(tx, pedidoId, agora = new Date()) {
  const pedido = await tx.pedido.findUnique({ where: { id: pedidoId }, select: CAMPOS_PEDIDO });
  return pedido ? inserir(tx, pedido, lancamentosDaFinalizacao(pedido), agora) : 0;
}

/** Na aprovação do Pix (mesma transação): a parte do devido que o split não levou. */
export async function lancarComplemento(tx, pedidoId, valorNoSplitCentavos, agora = new Date()) {
  const pedido = await tx.pedido.findUnique({ where: { id: pedidoId }, select: CAMPOS_PEDIDO });
  const valor = pedido ? complementoDaAprovacao(pedido, valorNoSplitCentavos) : 0;
  return valor > 0 ? inserir(tx, pedido, [{ tipo: 'TAXA_ENTREGA_COMPLEMENTO', valorCentavos: valor }], agora) : 0;
}

/** No cancelamento (mesma transação): desfaz cada lançamento automático ainda não desfeito. */
export async function estornarDoPedido(tx, pedidoId, { usuarioId = null, agora = new Date() } = {}) {
  const abertos = await tx.lancamentoLoja.findMany({
    where: { pedidoId, tipo: { in: TIPOS_AUTOMATICOS }, estornadoPor: null },
    orderBy: { id: 'asc' },
  });
  for (const l of abertos) {
    await tx.lancamentoLoja.create({
      data: {
        lojaId: l.lojaId,
        pedidoId,
        tipo: 'ESTORNO',
        valorCentavos: -l.valorCentavos,
        estornaId: l.id,
        observacao: 'Pedido cancelado',
        criadoPorId: usuarioId,
        criadoEm: agora,
      },
    });
  }
  return abertos.length;
}

// ───────── Leitura ─────────

const SELECT_LANCAMENTO = {
  id: true,
  tipo: true,
  valorCentavos: true,
  observacao: true,
  criadoEm: true,
  estornaId: true,
  fechamentoId: true,
  criadoPor: { select: { nome: true } },
  estorna: { select: { tipo: true } },
  pedido: {
    select: {
      id: true,
      numeroDia: true,
      dataRef: true,
      canal: true,
      nomeCliente: true,
      totalCentavos: true,
      formaPagamento: true,
      meioOnline: true,
      origemFreteGratis: true,
      status: true,
    },
  },
};

const lancamentoPublico = (l) => ({
  id: l.id,
  tipo: l.tipo,
  descricao:
    l.tipo === 'ESTORNO' && l.estorna ? `Pedido cancelado: desfaz "${DESCRICAO_LANCAMENTO[l.estorna.tipo]}"` : DESCRICAO_LANCAMENTO[l.tipo],
  valorCentavos: l.valorCentavos,
  observacao: l.observacao,
  criadoEm: l.criadoEm,
  criadoPor: l.criadoPor?.nome ?? null,
  pedido: l.pedido
    ? { ...l.pedido, dataRef: l.pedido.dataRef.toISOString().slice(0, 10) }
    : null,
});

const soma = (lista) => lista.reduce((t, l) => t + l.valorCentavos, 0);
const campoData = (d) => d.toISOString().slice(0, 10);

const fechamentoPublico = (f) => ({
  id: f.id,
  loja: f.loja ?? undefined,
  inicio: campoData(f.inicio),
  fim: campoData(f.fim),
  domingo: somarDias(campoData(f.fim), -1),
  saldoCentavos: f.saldoCentavos,
  saldoTexto: textoDoSaldo(f.saldoCentavos),
  status: f.status,
  quitadoEm: f.quitadoEm,
  quitadoPor: f.quitadoPor?.nome ?? null,
  observacao: f.observacao,
  criadoEm: f.criadoEm,
  quantidade: f._count?.lancamentos,
});

const naoEncontrado = () => new ErroHttp(404, 'Fechamento não encontrado', { codigo: 'NAO_ENCONTRADO' });

/** Semana atual (parcial): lançamentos ainda sem fechamento da loja. */
async function semanaAtualDaLoja(loja, agora) {
  const semana = semanaDe(agora, horaViradaDe(loja));
  const lancamentos = await prisma.lancamentoLoja.findMany({
    where: { lojaId: loja.id, fechamentoId: null },
    orderBy: { id: 'asc' },
    select: SELECT_LANCAMENTO,
  });
  const saldo = soma(lancamentos);
  return {
    inicio: semana.inicio,
    domingo: semana.domingo,
    saldoCentavos: saldo,
    saldoTexto: textoDoSaldo(saldo),
    lancamentos: lancamentos.map(lancamentoPublico),
  };
}

/** Retaguarda da loja: semana atual (parcial) e os fechamentos (mais novos primeiro). */
export async function fechamentoDaLoja(lojaId, agora = new Date()) {
  const loja = await prisma.loja.findUnique({ where: { id: lojaId } });
  const [semanaAtual, fechamentos] = await Promise.all([
    semanaAtualDaLoja(loja, agora),
    prisma.fechamentoSemanal.findMany({
      where: { lojaId },
      orderBy: { inicio: 'desc' },
      take: 52,
      include: { quitadoPor: { select: { nome: true } }, _count: { select: { lancamentos: true } } },
    }),
  ]);
  return { semanaAtual, fechamentos: fechamentos.map(fechamentoPublico) };
}

/** Detalhe de um fechamento (com os lançamentos). `lojaId` = só daquela loja (senão 404). */
export async function detalheDoFechamento(id, { lojaId = null } = {}) {
  const f = await prisma.fechamentoSemanal.findUnique({
    where: { id },
    include: {
      loja: { select: { id: true, nome: true, slug: true } },
      quitadoPor: { select: { nome: true } },
      lancamentos: { orderBy: { id: 'asc' }, select: SELECT_LANCAMENTO },
    },
  });
  if (!f || (lojaId != null && f.lojaId !== lojaId)) throw naoEncontrado();
  return { fechamento: { ...fechamentoPublico(f), lancamentos: f.lancamentos.map(lancamentoPublico) } };
}

/** ADMIN: fechamentos (filtro por status e loja) e a semana atual de cada loja com lançamento. */
export async function listarParaAdmin({ status, lojaId } = {}, agora = new Date()) {
  const where = {};
  if (status) where.status = status;
  if (lojaId) where.lojaId = lojaId;
  const [fechamentos, abertas] = await Promise.all([
    prisma.fechamentoSemanal.findMany({
      where,
      orderBy: [{ inicio: 'desc' }, { lojaId: 'asc' }],
      take: 200,
      include: {
        loja: { select: { id: true, nome: true, slug: true } },
        quitadoPor: { select: { nome: true } },
        _count: { select: { lancamentos: true } },
      },
    }),
    prisma.lancamentoLoja.groupBy({ by: ['lojaId'], where: { fechamentoId: null }, _sum: { valorCentavos: true }, _count: true }),
  ]);
  const lojas = await prisma.loja.findMany({ where: { id: { in: abertas.map((a) => a.lojaId) } } });
  const semanaAtual = abertas
    .map((a) => {
      const loja = lojas.find((l) => l.id === a.lojaId);
      const semana = semanaDe(agora, horaViradaDe(loja));
      const saldo = a._sum.valorCentavos ?? 0;
      return {
        loja: { id: loja.id, nome: loja.nome, slug: loja.slug },
        inicio: semana.inicio,
        domingo: semana.domingo,
        saldoCentavos: saldo,
        saldoTexto: textoDoSaldo(saldo),
        quantidade: a._count,
      };
    })
    .sort((a, b) => a.loja.nome.localeCompare(b.loja.nome, 'pt-BR'));
  return { fechamentos: fechamentos.map(fechamentoPublico), semanaAtual };
}

/** ADMIN: lançamentos da semana atual (ainda sem fechamento) de uma loja. */
export async function semanaAtualParaAdmin(lojaId, agora = new Date()) {
  const loja = await prisma.loja.findUnique({ where: { id: lojaId } });
  if (!loja) throw new ErroHttp(404, 'Loja não encontrada', { codigo: 'LOJA_NAO_ENCONTRADA' });
  return { loja: { id: loja.id, nome: loja.nome, slug: loja.slug }, semanaAtual: await semanaAtualDaLoja(loja, agora) };
}

// ───────── Ações do ADMIN ─────────

/**
 * Marca como quitado (data escolhida, não no futuro). Só AGUARDANDO_PAGAMENTO (senão 409).
 * Resolve o alerta de atraso do fechamento.
 */
export async function quitar(id, { quitadoEm, observacao = null, usuarioId }, agora = new Date()) {
  if (quitadoEm > diaLocal(agora)) {
    throw new ErroHttp(400, 'A data da quitação não pode ser no futuro', {
      codigo: 'VALIDACAO',
      detalhes: [{ campo: 'quitadoEm', mensagem: 'A data não pode ser no futuro' }],
    });
  }
  const [a, m, d] = quitadoEm.split('-').map(Number);
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.fechamentoSemanal.updateMany({
      where: { id, status: 'AGUARDANDO_PAGAMENTO' },
      data: { status: 'QUITADO', quitadoEm: localParaUtc(a, m, d, 12 * 60), quitadoPorId: usuarioId, observacao: observacao || null },
    });
    if (count === 0) {
      const f = await tx.fechamentoSemanal.findUnique({ where: { id }, select: { status: true } });
      if (!f) throw naoEncontrado();
      throw new ErroHttp(409, 'Este fechamento já está quitado', { codigo: 'FECHAMENTO_QUITADO' });
    }
    await tx.alertaPlataforma.updateMany({
      where: { fechamentoId: id, resolvidoEm: null },
      data: { resolvidoEm: agora, resolvidoPorId: usuarioId },
    });
    return detalheDoFechamentoTx(tx, id);
  });
}

async function detalheDoFechamentoTx(tx, id) {
  const f = await tx.fechamentoSemanal.findUnique({ where: { id }, include: { loja: { select: { id: true, nome: true, slug: true } }, quitadoPor: { select: { nome: true } } } });
  return { fechamento: fechamentoPublico(f) };
}

/** Ajuste manual (semana atual da loja). Pedido opcional, que precisa ser da loja. */
export async function ajusteManual({ lojaId, valorCentavos, observacao, pedidoId = null, usuarioId }, agora = new Date()) {
  const loja = await prisma.loja.findUnique({ where: { id: lojaId }, select: { id: true } });
  if (!loja) throw new ErroHttp(404, 'Loja não encontrada', { codigo: 'LOJA_NAO_ENCONTRADA' });
  if (pedidoId != null) {
    const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId }, select: { lojaId: true } });
    if (pedido?.lojaId !== lojaId) {
      throw new ErroHttp(422, 'Este pedido não é desta loja', {
        codigo: 'PEDIDO_INVALIDO',
        detalhes: [{ campo: 'pedidoId', mensagem: 'O pedido não é desta loja' }],
      });
    }
  }
  const l = await prisma.lancamentoLoja.create({
    data: { lojaId, pedidoId, tipo: 'AJUSTE_MANUAL', valorCentavos, observacao: observacao.trim(), criadoPorId: usuarioId, criadoEm: agora },
    select: SELECT_LANCAMENTO,
  });
  return { lancamento: lancamentoPublico(l) };
}

/**
 * Resumo da campanha de frete grátis da primeira compra (só usos efetivados): taxas de loja com
 * entregador do Taaki que deixaram de ser cobradas + créditos de loja com motoboy próprio (já
 * descontados os estornos), contra o orçamento.
 */
export async function resumoCampanha(env = process.env) {
  const usos = await prisma.usoCampanhaFreteGratis.findMany({
    where: { situacao: 'USADO' },
    select: {
      pedido: {
        select: { lojaId: true, origemTaxaEntrega: true, valorEntregadorCentavos: true, valorPlataformaEntregaCentavos: true, taxaEntregaCheiaCentavos: true, origemFreteGratis: true },
      },
    },
  });
  const noTaaki = usos.filter((u) => entregaPeloTaaki(u.pedido));
  const taxasTaaki = noTaaki.reduce((t, u) => t + taxaCheiaDoPedido(u.pedido), 0);
  const [creditos, estornos] = await Promise.all([
    prisma.lancamentoLoja.aggregate({ where: { tipo: 'CREDITO_CAMPANHA' }, _sum: { valorCentavos: true } }),
    prisma.lancamentoLoja.aggregate({ where: { tipo: 'ESTORNO', estorna: { tipo: 'CREDITO_CAMPANHA' } }, _sum: { valorCentavos: true } }),
  ]);
  const creditosLoja = -((creditos._sum.valorCentavos ?? 0) + (estornos._sum.valorCentavos ?? 0));
  const total = taxasTaaki + creditosLoja;
  const orcamento = orcamentoCampanha(env);
  return {
    usos: usos.length,
    usosEntregaTaaki: noTaaki.length,
    usosEntregaLoja: usos.length - noTaaki.length,
    taxasEntregaTaakiCentavos: taxasTaaki,
    creditosLojaCentavos: creditosLoja,
    totalCentavos: total,
    orcamentoCentavos: orcamento,
    restanteCentavos: orcamento - total,
  };
}

// ───────── Rotina ─────────

/**
 * Fecha as semanas terminadas (há mais de 10 min) com lançamento sem fechamento, loja por loja,
 * da mais antiga para a mais nova. O fechamento de uma semana leva todo lançamento sem fechamento
 * criado antes do fim dela (um atrasado de uma semana já fechada entra no próximo). Saldo zero =
 * já QUITADO ("Saldo zero"). Idempotente (único [lojaId, inicio]). Devolve os fechamentos criados.
 */
export async function fecharSemanas(agora = new Date()) {
  const pendentes = await prisma.lancamentoLoja.groupBy({
    by: ['lojaId'],
    where: { fechamentoId: null },
    _min: { criadoEm: true },
  });
  const criados = [];
  for (const { lojaId, _min } of pendentes) {
    const loja = await prisma.loja.findUnique({ where: { id: lojaId } });
    const virada = horaViradaDe(loja);
    let semana = semanaDe(_min.criadoEm, virada);
    while (semana.ate.getTime() + FOLGA_FECHAMENTO_MS <= agora.getTime()) {
      const f = await fecharUmaSemana(lojaId, semana, agora);
      if (f) criados.push(f);
      semana = semanaQueComecaEm(semana.fim, virada);
    }
  }
  return criados;
}

async function fecharUmaSemana(lojaId, semana, agora) {
  try {
    return await prisma.$transaction(async (tx) => {
      const linhas = await tx.$queryRaw`
        SELECT "id", "valorCentavos" FROM "LancamentoLoja"
         WHERE "lojaId" = ${lojaId} AND "fechamentoId" IS NULL
           AND "criadoEm" < ${semana.ate.toISOString()}::timestamp
         ORDER BY "id" FOR UPDATE`;
      if (!linhas.length) return null;
      const saldo = linhas.reduce((t, l) => t + Number(l.valorCentavos), 0);
      const zero = saldo === 0;
      const f = await tx.fechamentoSemanal.create({
        data: {
          lojaId,
          inicio: paraCampoData(semana.inicio),
          fim: paraCampoData(semana.fim),
          saldoCentavos: saldo,
          status: zero ? 'QUITADO' : 'AGUARDANDO_PAGAMENTO',
          quitadoEm: zero ? agora : null,
          observacao: zero ? 'Saldo zero' : null,
        },
      });
      await tx.lancamentoLoja.updateMany({ where: { id: { in: linhas.map((l) => l.id) } }, data: { fechamentoId: f.id } });
      return f;
    });
  } catch (err) {
    // Outra instância fechou a mesma semana no mesmo instante.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
    throw err;
  }
}

/** Alerta FECHAMENTO_ATRASADO: aguardando há mais de N dias, um por fechamento (nunca recriado). */
export async function alertarAtrasados(agora = new Date(), env = process.env) {
  const dias = diasDeAtraso(env);
  const limite = new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
  const atrasados = await prisma.fechamentoSemanal.findMany({
    where: { status: 'AGUARDANDO_PAGAMENTO', criadoEm: { lt: limite }, alertas: { none: { tipo: 'FECHAMENTO_ATRASADO' } } },
    include: { loja: { select: { nome: true } } },
  });
  for (const f of atrasados) {
    const semana = `${campoData(f.inicio).split('-').reverse().join('/')} a ${somarDias(campoData(f.fim), -1).split('-').reverse().join('/')}`;
    const quem = f.saldoCentavos > 0 ? `${f.loja.nome} deve ${formatarDinheiro(f.saldoCentavos)} ao Taaki` : `o Taaki deve ${formatarDinheiro(-f.saldoCentavos)} a ${f.loja.nome}`;
    await criarAlerta({
      tipo: 'FECHAMENTO_ATRASADO',
      lojaId: f.lojaId,
      fechamentoId: f.id,
      mensagem: `Fechamento da semana de ${semana} aguardando pagamento há mais de ${dias} ${dias === 1 ? 'dia' : 'dias'}: ${quem}.`,
    });
  }
  return atrasados.length;
}

export async function rodarRotinaFechamento(agora = new Date(), env = process.env) {
  const criados = await fecharSemanas(agora);
  const alertas = await alertarAtrasados(agora, env);
  return { fechamentos: criados.length, alertas };
}

/** Ao iniciar e de hora em hora (timer `unref`). Devolve a função que para. */
export function iniciarFechamentoSemanal({ intervaloMs = INTERVALO_ROTINA_FECHAMENTO_MS, log = console, env = process.env } = {}) {
  const rodar = () =>
    rodarRotinaFechamento(new Date(), env)
      .then(({ fechamentos, alertas }) => {
        if (fechamentos || alertas) log.info?.(`[fechamento] ${fechamentos} fechamento(s), ${alertas} alerta(s) de atraso`);
      })
      .catch((err) => log.warn(`[fechamento] rotina falhou: ${err.message}`));
  const inicial = setTimeout(rodar, 5_000);
  inicial.unref?.();
  const timer = setInterval(rodar, intervaloMs);
  timer.unref?.();
  return () => {
    clearTimeout(inicial);
    clearInterval(timer);
  };
}
