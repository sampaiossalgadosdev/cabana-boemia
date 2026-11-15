/** Operações da equipe logada (PDV): fila do dia, finalizar pedido, tempo estimado. */
import { ErroHttp } from '../lib/erros.js';
import { diaLocal } from '../lib/fuso.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import * as configRepo from '../repositories/configuracao.repository.js';
import { pedidoPublico } from './pedido.service.js';
import { calcularTempoEstimado } from './publico.service.js';

/** Status de pedido "ainda aberto" (na fila). */
export const STATUS_ABERTOS = ['ABERTO', 'CONFIRMADO'];

export const TEMPO_MIN = 1;
export const TEMPO_MAX = 240;

/**
 * Pedidos de um dia local.
 * @param {{ dataRef: string, canais?: string[], somenteAbertos?: boolean }} filtro
 *   `dataRef`: "YYYY-MM-DD" ou "hoje" (dia local de `agora`).
 */
export async function listarPedidosDoDia({ dataRef, canais, somenteAbertos = true }, agora = new Date()) {
  const dia = dataRef === 'hoje' ? diaLocal(agora) : dataRef;
  const pedidos = await pedidoRepo.listarDoDia({
    dataRef: dia,
    canais,
    status: somenteAbertos ? STATUS_ABERTOS : undefined,
  });
  return { dataRef: dia, pedidos: pedidos.map(pedidoPublico) };
}

/**
 * Finaliza um pedido aberto. A forma de pagamento informada SOBRESCREVE a
 * escolhida pelo cliente (vale o que foi pago de fato). Troco só existe em
 * DINHEIRO: em outra forma é apagado. Avisa a equipe com "pedido:atualizado".
 */
export async function finalizarPedido(id, { formaPagamento }, agora = new Date()) {
  const atual = await pedidoRepo.buscarPorId(id);
  if (!atual) throw new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });

  const count = await pedidoRepo.finalizarSeAberto(
    id,
    {
      formaPagamento,
      trocoParaCentavos: formaPagamento === 'DINHEIRO' ? atual.trocoParaCentavos : null,
      finalizadoEm: agora,
    },
    STATUS_ABERTOS,
  );
  if (count === 0) {
    // Já encerrado (ou outra atendente finalizou no mesmo instante).
    const s = await pedidoRepo.buscarStatus(id);
    const situacao = s?.status === 'CANCELADO' ? 'cancelado' : 'finalizado';
    throw new ErroHttp(409, `Pedido já está ${situacao}`, { codigo: 'PEDIDO_ENCERRADO' });
  }

  const pedido = pedidoPublico(await pedidoRepo.buscarPorId(id));
  emitirParaEquipe('pedido:atualizado', pedido);
  return pedido;
}

const CONFIG_PADRAO = { tempoEstimadoPadraoMin: 40, tempoEstimadoManualMin: null, tempoManualDefinidoEm: null };

/** `manualMin` só aparece se foi definido hoje (dia local); senão null. */
function tempoPublico(config, agora) {
  const c = config ?? CONFIG_PADRAO;
  const manualDeHoje =
    c.tempoEstimadoManualMin != null &&
    c.tempoManualDefinidoEm != null &&
    diaLocal(c.tempoManualDefinidoEm) === diaLocal(agora);
  return {
    padraoMin: c.tempoEstimadoPadraoMin,
    manualMin: manualDeHoje ? c.tempoEstimadoManualMin : null,
    vigenteMin: calcularTempoEstimado(c, agora),
  };
}

export async function obterTempoEstimado(agora = new Date()) {
  return tempoPublico(await configRepo.buscar(), agora);
}

/** `minutos` null = volta ao padrão (limpa o manual e a data). */
export async function definirTempoEstimado(minutos, agora = new Date()) {
  const config = await configRepo.definirTempoManual({
    tempoEstimadoManualMin: minutos,
    tempoManualDefinidoEm: minutos == null ? null : agora,
  });
  return tempoPublico(config, agora);
}
