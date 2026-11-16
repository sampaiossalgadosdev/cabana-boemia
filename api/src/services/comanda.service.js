/**
 * Comandas do salão: Pedido canal SALAO que fica ABERTO enquanto o cliente
 * come, recebendo itens aos poucos.
 *
 * - Abrir: pedido sem itens, total 0, com número do dia; não imprime nada.
 * - Lançar item: na hora, numa transação que trava a comanda, revalida o
 *   produto, calcula o preço SÓ com o banco (POR_KG = round(preço × g / 1000)),
 *   baixa o estoque com a mesma regra atômica do `criarPedido` e recalcula os totais.
 * - Remover item: marca `canceladoEm` e devolve exatamente o que aquele item baixou.
 * - Fechar: forma de pagamento obrigatória → FINALIZADO; cupom CONTA só se pedido.
 *   Fechar não mexe no estoque (a baixa já aconteceu no lançamento).
 *
 * Toda alteração trava a linha do pedido primeiro (pedido → produtos →
 * insumos, a mesma ordem do cancelamento): lançar e fechar ao mesmo tempo
 * nunca deixa item numa comanda fechada. Eventos só depois do commit.
 */
import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { diaLocal } from '../lib/fuso.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import * as comandaRepo from '../repositories/comanda.repository.js';
import {
  OPCOES_TRANSACAO,
  baixarEstoque,
  calcularValores,
  estornarVendas,
  gravarItens,
  motivoIndisponivel,
  necessidadesDeEstoque,
  pedidoPublico,
} from './pedido.service.js';

const naoEncontrada = () => new ErroHttp(404, 'Comanda não encontrada', { codigo: 'NAO_ENCONTRADO' });

/**
 * Trava a comanda e confere que ainda está aberta.
 * Não existe ou não é do salão = 404; fechada/cancelada = 409 PEDIDO_ENCERRADO.
 */
async function travarAberta(tx, id) {
  const c = await comandaRepo.travar(id, tx);
  if (!c || c.canal !== 'SALAO') throw naoEncontrada();
  if (c.status !== 'ABERTO') {
    const situacao = c.status === 'CANCELADO' ? 'cancelada' : 'fechada';
    throw new ErroHttp(409, `Comanda já está ${situacao}`, { codigo: 'PEDIDO_ENCERRADO' });
  }
  return c;
}

function avisar(comanda) {
  emitirParaEquipe('pedido:atualizado', comanda);
  return comanda;
}

/** @param {{ nomeCliente: string, mesaRotulo?: string | null }} dados */
export async function abrirComanda({ nomeCliente, mesaRotulo = null }, { usuarioId = null, agora = new Date() } = {}) {
  const pedido = await prisma.$transaction(async (tx) => {
    const dia = diaLocal(agora);
    const numeroDia = await pedidoRepo.proximoNumeroDoDia(dia, tx);
    const { id } = await pedidoRepo.criarPedido(
      {
        numeroDia,
        dataRef: new Date(`${dia}T00:00:00.000Z`),
        canal: 'SALAO',
        status: 'ABERTO',
        nomeCliente,
        mesaRotulo,
        criadoPorId: usuarioId,
        criadoEm: agora,
      },
      tx,
    );
    return pedidoRepo.buscarPorId(id, tx);
  }, OPCOES_TRANSACAO);
  const comanda = pedidoPublico(pedido);
  emitirParaEquipe('pedido:novo', comanda);
  return comanda;
}

export async function listarAbertas() {
  return (await comandaRepo.listarAbertas()).map(pedidoPublico);
}

export async function buscarComanda(id) {
  const p = await pedidoRepo.buscarPorId(id);
  if (!p || p.canal !== 'SALAO') throw naoEncontrada();
  return pedidoPublico(p);
}

/**
 * @param {{ produtoId: number, quantidade?: number, pesoGramas?: number | null, observacao?: string | null }} item
 */
export async function lancarItem(id, item, { usuarioId = null } = {}) {
  const pedido = await prisma.$transaction(async (tx) => {
    await travarAberta(tx, id);

    const [produto] = await pedidoRepo.buscarProdutosParaPedido([item.produtoId], tx);
    const motivo = motivoIndisponivel(produto, { canal: 'SALAO' });
    if (motivo) {
      throw new ErroHttp(409, `Indisponível agora: ${produto?.nome ?? `produto ${item.produtoId}`} (${motivo})`, {
        codigo: 'PRODUTO_INDISPONIVEL',
        detalhes: [{ produtoId: item.produtoId, nome: produto?.nome ?? null, motivo }],
      });
    }
    if (produto.tipoPreco !== 'POR_KG' && item.pesoGramas != null) {
      throw new ErroHttp(400, `"${produto.nome}" não é vendido por peso`, { codigo: 'VALIDACAO' });
    }

    const linha = { produtoId: produto.id, quantidade: item.quantidade ?? 1, pesoGramas: item.pesoGramas, observacao: item.observacao };
    const { linhas } = calcularValores([linha], new Map([[produto.id, produto]]));
    await baixarEstoque(tx, necessidadesDeEstoque(linhas));
    await gravarItens(tx, id, linhas, usuarioId);
    await comandaRepo.recalcularTotais(id, tx);
    return pedidoRepo.buscarPorId(id, tx);
  }, OPCOES_TRANSACAO);
  return avisar(pedidoPublico(pedido));
}

export async function removerItem(id, itemId, { usuarioId = null, agora = new Date() } = {}) {
  const pedido = await prisma.$transaction(async (tx) => {
    await travarAberta(tx, id);
    if ((await comandaRepo.cancelarItemSeAtivo(id, itemId, agora, tx)) === 0) {
      const item = await comandaRepo.buscarItem(id, itemId, tx);
      if (!item) throw new ErroHttp(404, 'Item não encontrado nesta comanda', { codigo: 'NAO_ENCONTRADO' });
      throw new ErroHttp(409, 'Item já foi removido', { codigo: 'ITEM_JA_REMOVIDO' });
    }
    await estornarVendas(tx, await comandaRepo.vendasDoItem(itemId, tx), usuarioId);
    await comandaRepo.recalcularTotais(id, tx);
    return pedidoRepo.buscarPorId(id, tx);
  }, OPCOES_TRANSACAO);
  return avisar(pedidoPublico(pedido));
}

/**
 * @param {{ formaPagamento: string, imprimirConta?: boolean }} dados
 * @returns {Promise<{ comanda: object, trabalho: object | null }>}
 */
export async function fecharComanda(id, { formaPagamento, imprimirConta = false }, { agora = new Date() } = {}) {
  const { pedido, trabalho } = await prisma.$transaction(async (tx) => {
    await travarAberta(tx, id);
    if ((await comandaRepo.contarItensAtivos(id, tx)) === 0) {
      throw new ErroHttp(409, 'A comanda não tem itens. Lance os itens ou exclua a comanda.', {
        codigo: 'COMANDA_VAZIA',
      });
    }
    await comandaRepo.fechar(id, { formaPagamento, finalizadoEm: agora }, tx);
    const trabalho = imprimirConta
      ? await pedidoRepo.criarTrabalhoImpressao({ pedidoId: id, tipo: 'CONTA', status: 'PENDENTE' }, tx)
      : null;
    return { pedido: await pedidoRepo.buscarPorId(id, tx), trabalho };
  }, OPCOES_TRANSACAO);
  const comanda = avisar(pedidoPublico(pedido));
  if (trabalho) emitirParaEquipe('impressao:nova', trabalho);
  return { comanda, trabalho };
}
