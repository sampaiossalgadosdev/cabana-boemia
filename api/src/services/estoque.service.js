/**
 * Estoque na retaguarda: bebidas (produtos com estoque próprio) e insumos.
 *
 * - Saldo oficial = campo `estoque`, alterado só de forma atômica:
 *   ENTRADA = incremento; AJUSTE = trava a linha (FOR UPDATE), grava o saldo
 *   contado e registra o delta (contado − atual). Vendas concorrentes esperam
 *   a trava e reavaliam `estoque >= qtd` com o saldo novo.
 * - Toda alteração grava `MovimentacaoEstoque` com `usuarioId` (e motivo).
 *   A movimentação é só histórico; nunca é somada para achar saldo.
 * - Avisa o PDV (`cardapio:atualizado`): "esgotado" e "restam N" mudam.
 */
import { prisma } from '../lib/prisma.js';
import { ErroHttp, ehDuplicado, ehInexistente } from '../lib/erros.js';
import { avisarCardapioAtualizado } from '../lib/eventos.js';
import * as estoqueRepo from '../repositories/estoque.repository.js';
import { OPCOES_TRANSACAO } from './pedido.service.js';

export const LIMITE_MOVIMENTACOES = 50;

/** Função pura: abaixo do mínimo = saldo menor que o mínimo definido (mínimo vazio = nunca). */
export const abaixoDoMinimo = (estoque, estoqueMinimo) => estoqueMinimo != null && (estoque ?? 0) < estoqueMinimo;

const insumoPublico = (i) => ({
  id: i.id,
  nome: i.nome,
  estoque: i.estoque,
  estoqueMinimo: i.estoqueMinimo,
  abaixoDoMinimo: abaixoDoMinimo(i.estoque, i.estoqueMinimo),
  produtos: i.produtos.map((pi) => pi.produto),
});

/** Bebidas e insumos com saldo, mínimo e destaque. */
export async function visaoGeral() {
  const [produtos, insumos] = await Promise.all([estoqueRepo.listarProdutosComEstoque(), estoqueRepo.listarInsumos()]);
  return {
    produtos: produtos.map((p) => ({
      ...p,
      estoque: p.estoque ?? 0,
      abaixoDoMinimo: abaixoDoMinimo(p.estoque, p.estoqueMinimo),
    })),
    insumos: insumos.map(insumoPublico),
  };
}

// ───────── Insumos (cadastro) ─────────

async function gravarInsumo(fn) {
  try {
    const insumo = await fn();
    avisarCardapioAtualizado('estoque');
    return insumoPublico(insumo);
  } catch (err) {
    if (ehDuplicado(err)) throw new ErroHttp(409, 'Já existe um insumo com este nome', { codigo: 'NOME_EM_USO' });
    if (ehInexistente(err)) throw new ErroHttp(404, 'Insumo não encontrado', { codigo: 'NAO_ENCONTRADO' });
    throw err;
  }
}

/** Insumo novo começa com saldo 0 (o saldo entra por Entrada). */
export const criarInsumo = ({ nome, estoqueMinimo }) =>
  gravarInsumo(() => estoqueRepo.criarInsumo({ nome, estoqueMinimo, estoque: 0 }));

export const atualizarInsumo = (id, { nome, estoqueMinimo }) =>
  gravarInsumo(() => estoqueRepo.atualizarInsumo(id, { nome, estoqueMinimo }));

// ───────── Entrada e ajuste ─────────

const naoEncontrado = (alvo) =>
  new ErroHttp(404, alvo.produtoId ? 'Produto não encontrado' : 'Insumo não encontrado', { codigo: 'NAO_ENCONTRADO' });

const semControle = () =>
  new ErroHttp(422, 'Este produto não controla estoque. Ligue o controle no cadastro do produto.', {
    codigo: 'SEM_CONTROLE_DE_ESTOQUE',
  });

async function saldoDepois(alvo, movimentacao) {
  const item = alvo.produtoId ? await estoqueRepo.saldoProduto(alvo.produtoId) : await estoqueRepo.saldoInsumo(alvo.insumoId);
  return {
    item: { ...item, abaixoDoMinimo: abaixoDoMinimo(item.estoque, item.estoqueMinimo) },
    movimentacao,
  };
}

/**
 * Soma `quantidade` ao saldo (incremento atômico) e grava ENTRADA.
 * @param {{ produtoId?: number, insumoId?: number }} alvo exatamente um dos dois
 */
export async function registrarEntrada(alvo, { quantidade, motivo = null }, { usuarioId }) {
  const movimentacao = await prisma.$transaction(async (tx) => {
    if (alvo.produtoId) {
      if ((await estoqueRepo.somarProduto(alvo.produtoId, quantidade, tx)) === 0) {
        const p = await estoqueRepo.saldoProduto(alvo.produtoId, tx);
        throw p ? semControle() : naoEncontrado(alvo);
      }
    } else if ((await estoqueRepo.somarInsumo(alvo.insumoId, quantidade, tx)) === 0) {
      throw naoEncontrado(alvo);
    }
    return estoqueRepo.criarMovimentacao({ tipo: 'ENTRADA', ...alvo, quantidade, motivo, usuarioId }, tx);
  }, OPCOES_TRANSACAO);
  avisarCardapioAtualizado('estoque');
  return saldoDepois(alvo, movimentacao);
}

/**
 * Ajuste por contagem: o saldo passa a ser `saldoContado` e o AJUSTE grava o
 * delta (pode ser negativo). Sem diferença: nada é gravado (movimentacao null).
 */
export async function registrarAjuste(alvo, { saldoContado, motivo }, { usuarioId }) {
  const movimentacao = await prisma.$transaction(async (tx) => {
    const atual = alvo.produtoId
      ? await estoqueRepo.travarProduto(alvo.produtoId, tx)
      : await estoqueRepo.travarInsumo(alvo.insumoId, tx);
    if (!atual) throw naoEncontrado(alvo);
    if (!atual.controlaEstoque) throw semControle();
    const delta = saldoContado - (atual.estoque ?? 0);
    if (delta === 0) return null;
    if (alvo.produtoId) await estoqueRepo.definirSaldoProduto(alvo.produtoId, saldoContado, tx);
    else await estoqueRepo.definirSaldoInsumo(alvo.insumoId, saldoContado, tx);
    return estoqueRepo.criarMovimentacao({ tipo: 'AJUSTE', ...alvo, quantidade: delta, motivo, usuarioId }, tx);
  }, OPCOES_TRANSACAO);
  if (movimentacao) avisarCardapioAtualizado('estoque');
  return saldoDepois(alvo, movimentacao);
}

// ───────── Histórico ─────────

const movimentacaoPublica = ({ itemPedido, ...m }) => ({ ...m, pedido: itemPedido?.pedido ?? null });

/**
 * Histórico, mais recente primeiro. `proximo` = id para pedir a página
 * seguinte (`antesDeId`), ou null no fim.
 */
export async function movimentacoes({ produtoId, insumoId, tipo, antesDeId }) {
  const lista = await estoqueRepo.listarMovimentacoes({
    produtoId,
    insumoId,
    tipo,
    antesDeId,
    limite: LIMITE_MOVIMENTACOES + 1,
  });
  const pagina = lista.slice(0, LIMITE_MOVIMENTACOES);
  return {
    movimentacoes: pagina.map(movimentacaoPublica),
    proximo: lista.length > LIMITE_MOVIMENTACOES ? pagina.at(-1).id : null,
  };
}
