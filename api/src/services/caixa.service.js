/**
 * Caixa do balcão de cada loja: todo o dinheiro que passa pelo balcão (salão,
 * delivery, site). Um caixa aberto por loja (índice único parcial).
 *
 * esperado = valorInicial
 *          + Σ totalCentavos dos pedidos FINALIZADOS em DINHEIRO neste caixa
 *          + Σ suprimentos − Σ sangrias
 * diferença = contado − esperado (positiva = sobrou; negativa = faltou)
 *
 * O pedido entra no caixa em que é FINALIZADO (`Pedido.caixaId`), com a forma
 * de pagamento da finalização. Fechamento cego: a equipe informa só o contado
 * e nunca recebe o esperado nem a diferença; ambos ficam gravados e só o DONO
 * vê (`/retaguarda/caixas`).
 *
 * Concorrência: finalizar pedido, fechar comanda e lançar movimento travam o
 * caixa aberto em modo compartilhado (FOR SHARE); o fechamento trava em modo
 * exclusivo (FOR UPDATE) e espera todos terminarem, então nada entra depois
 * do cálculo do esperado. Só um caixa aberto: índice único parcial no banco.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import { resolverDia } from './diaOperacional.service.js';
import * as caixaRepo from '../repositories/caixa.repository.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import { OPCOES_TRANSACAO, STATUS_ABERTOS } from './pedido.service.js';

export const TIPOS_MOVIMENTO = ['SANGRIA', 'SUPRIMENTO'];

// ───────── Funções puras ─────────

/** @param {{ valorInicialCentavos: number, vendasDinheiroCentavos: number, suprimentosCentavos: number, sangriasCentavos: number }} v */
export const calcularEsperado = (v) =>
  v.valorInicialCentavos + v.vendasDinheiroCentavos + v.suprimentosCentavos - v.sangriasCentavos;

const movimentoPublico = (m) => ({
  id: m.id,
  tipo: m.tipo,
  valorCentavos: m.valorCentavos,
  motivo: m.motivo,
  criadoEm: m.criadoEm,
  usuario: m.usuario,
});

/** O que a equipe (PDV) vê: NUNCA esperado nem diferença. */
export function caixaDaEquipe(c) {
  if (!c) return null;
  return {
    id: c.id,
    abertoEm: c.abertoEm,
    abertoPor: c.abertoPor,
    valorInicialCentavos: c.valorInicialCentavos,
    fechadoEm: c.fechadoEm,
    fechadoPor: c.fechadoPor,
    valorContadoCentavos: c.valorContadoCentavos,
    observacao: c.observacao,
    movimentos: c.movimentos.map(movimentoPublico),
  };
}

const caixaFechado = () =>
  new ErroHttp(409, 'O caixa está fechado. Abra o caixa para continuar.', { codigo: 'CAIXA_FECHADO' });

/**
 * Dentro de uma transação: trava o caixa aberto (compartilhado) e devolve o
 * id; sem caixa aberto = 409 CAIXA_FECHADO. Usado ao finalizar pedido/comanda.
 */
export async function exigirCaixaAberto(lojaId, tx) {
  const id = await caixaRepo.travarAbertoCompartilhado(lojaId, tx);
  if (!id) throw caixaFechado();
  return id;
}

function avisar(lojaId, caixa) {
  emitirParaEquipe(lojaId, 'caixa:atualizado', { caixa: caixaDaEquipe(caixa) });
}

// ───────── Equipe ─────────

export async function caixaAtual(lojaId) {
  return caixaDaEquipe(await caixaRepo.buscarAberto(lojaId));
}

const jaAberto = () =>
  new ErroHttp(409, 'Já existe um caixa aberto', { codigo: 'CAIXA_JA_ABERTO' });

export async function abrirCaixa(lojaId, { valorInicialCentavos }, { usuarioId, agora = new Date() }) {
  if (await caixaRepo.buscarAberto(lojaId)) throw jaAberto();
  let caixa;
  try {
    caixa = await caixaRepo.criar({ lojaId, abertoPorId: usuarioId, valorInicialCentavos, abertoEm: agora });
  } catch (err) {
    // Duas aberturas ao mesmo tempo: a segunda bate no índice único parcial "Caixa_um_aberto".
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw jaAberto();
    throw err;
  }
  avisar(lojaId, caixa);
  return caixaDaEquipe(caixa);
}

/** Sangria (tira dinheiro da gaveta) ou suprimento (põe). Valor maior que a gaveta é permitido (fechamento cego). */
export async function registrarMovimento(lojaId, { tipo, valorCentavos, motivo }, { usuarioId, agora = new Date() }) {
  const caixa = await prisma.$transaction(async (tx) => {
    const caixaId = await exigirCaixaAberto(lojaId, tx);
    await caixaRepo.criarMovimento({ caixaId, tipo, valorCentavos, motivo, usuarioId, criadoEm: agora }, tx);
    return caixaRepo.buscarPorId(caixaId, tx);
  }, OPCOES_TRANSACAO);
  avisar(lojaId, caixa);
  return caixaDaEquipe(caixa);
}

/** Pedido aberto como aparece na lista do 409 PEDIDOS_ABERTOS (com o necessário para finalizar/cancelar). */
const pedidoPendente = (p) => ({
  id: p.id,
  numeroDia: p.numeroDia,
  canal: p.canal,
  status: p.status,
  nomeCliente: p.nomeCliente,
  mesaRotulo: p.mesaRotulo,
  totalCentavos: p.totalCentavos,
  formaPagamento: p.formaPagamento,
  quantidadeItens: p._count.itens,
  criadoEm: p.criadoEm,
});

async function valoresDoCaixa(caixaId, valorInicialCentavos, db) {
  const [vendasDinheiroCentavos, mov] = await Promise.all([
    caixaRepo.somarVendasEmDinheiro(caixaId, db),
    caixaRepo.somarMovimentos(caixaId, db),
  ]);
  const v = {
    valorInicialCentavos,
    vendasDinheiroCentavos,
    suprimentosCentavos: mov.SUPRIMENTO,
    sangriasCentavos: mov.SANGRIA,
  };
  return { ...v, esperadoCentavos: calcularEsperado(v) };
}

/**
 * Fechamento cego. Pedidos abertos (de qualquer dia) bloqueiam: 409
 * PEDIDOS_ABERTOS com a lista. Grava contado, esperado e diferença e cria o
 * TrabalhoImpressao FECHAMENTO. A resposta NÃO tem esperado nem diferença.
 */
export async function fecharCaixa(lojaId, { valorContadoCentavos, observacao = null }, { usuarioId, agora = new Date() }) {
  const { caixa, trabalho } = await prisma.$transaction(async (tx) => {
    const aberto = await caixaRepo.travarAbertoExclusivo(lojaId, tx);
    if (!aberto) throw caixaFechado();

    const pendentes = await caixaRepo.pedidosAbertos(lojaId, STATUS_ABERTOS, tx);
    if (pendentes.length) {
      throw new ErroHttp(
        409,
        `Finalize ou cancele ${pendentes.length === 1 ? 'o pedido aberto' : `os ${pendentes.length} pedidos abertos`} antes de fechar o caixa.`,
        { codigo: 'PEDIDOS_ABERTOS', detalhes: { pedidos: pendentes.map(pedidoPendente) } },
      );
    }

    const { esperadoCentavos } = await valoresDoCaixa(aberto.id, aberto.valorInicialCentavos, tx);
    const caixa = await caixaRepo.fechar(
      aberto.id,
      {
        fechadoPorId: usuarioId,
        fechadoEm: agora,
        valorContadoCentavos,
        esperadoCentavos,
        diferencaCentavos: valorContadoCentavos - esperadoCentavos,
        observacao,
      },
      tx,
    );
    const trabalho = await pedidoRepo.criarTrabalhoImpressao(
      { lojaId, caixaId: aberto.id, tipo: 'FECHAMENTO', status: 'PENDENTE' },
      tx,
    );
    return { caixa, trabalho };
  }, OPCOES_TRANSACAO);

  emitirParaEquipe(lojaId, 'caixa:atualizado', { caixa: null });
  emitirParaEquipe(lojaId, 'impressao:nova', trabalho);
  return caixaDaEquipe(caixa);
}

/** Resumo impresso no cupom FECHAMENTO: sem esperado nem diferença; com totais por forma. */
export async function resumoParaCupom(caixaId) {
  const caixa = await caixaRepo.buscarPorId(caixaId);
  if (!caixa) return null;
  return { ...caixaDaEquipe(caixa), totaisPorForma: await caixaRepo.totaisPorForma(caixaId) };
}

// ───────── Retaguarda (DONO) ─────────

/**
 * Caixas abertos num dia local, com esperado, contado, diferença e totais
 * por forma de pagamento. Caixa ainda aberto: esperado calculado agora,
 * contado e diferença null.
 * @param {string} data "YYYY-MM-DD" ou "hoje"
 */
export async function caixasDoDia(lojaId, data, agora = new Date()) {
  const { dia, inicio, fim } = await resolverDia(lojaId, data, agora);
  const caixas = await caixaRepo.listarAbertosEntre(lojaId, inicio, fim);
  const saida = [];
  for (const c of caixas) {
    const valores = await valoresDoCaixa(c.id, c.valorInicialCentavos);
    const aberto = c.fechadoEm == null;
    saida.push({
      ...caixaDaEquipe(c),
      aberto,
      vendasDinheiroCentavos: valores.vendasDinheiroCentavos,
      suprimentosCentavos: valores.suprimentosCentavos,
      sangriasCentavos: valores.sangriasCentavos,
      // Fechado: o valor gravado no fechamento (não muda depois).
      esperadoCentavos: aberto ? valores.esperadoCentavos : c.esperadoCentavos,
      diferencaCentavos: c.diferencaCentavos,
      totaisPorForma: await caixaRepo.totaisPorForma(c.id),
    });
  }
  return { data: dia, caixas: saida };
}
