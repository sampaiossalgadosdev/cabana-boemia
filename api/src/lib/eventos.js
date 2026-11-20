import { EventEmitter } from 'node:events';

/**
 * Barramento interno de eventos para a equipe (PDV/retaguarda). Os services
 * publicam aqui SÓ DEPOIS do commit, sempre com a loja do dado; o Socket.IO
 * (lib/tempoReal.js) repassa só para a sala daquela loja. Sem Socket.IO
 * (testes), ninguém escuta e nada quebra.
 */
const barramento = new EventEmitter();
barramento.setMaxListeners(50);

/**
 * @param {number} lojaId loja do pedido/caixa/cardápio: só a equipe dela recebe
 * @param {'pedido:novo' | 'pedido:atualizado' | 'impressao:nova' | 'caixa:atualizado' | 'cardapio:atualizado'} evento
 */
export function emitirParaEquipe(lojaId, evento, dados) {
  barramento.emit('equipe', evento, dados, lojaId);
}

/**
 * A retaguarda mudou algo que o PDV mostra (produtos, categorias, cardápio do
 * dia, turnos, bairros, estoque, configuração): o PDV recarrega o que estiver
 * na tela. Chamar SÓ depois do commit.
 * @param {number} lojaId
 * @param {'produtos' | 'categorias' | 'cardapio-do-dia' | 'turnos' | 'bairros' | 'estoque' | 'config' | 'loja'} origem ('loja' = nome, logo ou cor)
 */
export function avisarCardapioAtualizado(lojaId, origem) {
  emitirParaEquipe(lojaId, 'cardapio:atualizado', { origem });
}

/**
 * @param {(evento: string, dados: unknown, lojaId: number) => void} ouvinte
 * @returns {() => void} função para parar de escutar
 */
export function aoEmitirParaEquipe(ouvinte) {
  const seguro = (evento, dados, lojaId) => {
    try {
      ouvinte(evento, dados, lojaId);
    } catch (err) {
      console.error(`Falha ao repassar o evento "${evento}":`, err);
    }
  };
  barramento.on('equipe', seguro);
  return () => barramento.off('equipe', seguro);
}

/**
 * Eventos internos da API (não vão para a equipe). Ex.: "usuario:desativado"
 * faz o Socket.IO derrubar na hora as conexões daquele usuário.
 * @param {'usuario:desativado'} evento
 */
export function emitirInterno(evento, dados) {
  barramento.emit(`interno:${evento}`, dados);
}

/** @returns {() => void} função para parar de escutar */
export function aoEventoInterno(evento, ouvinte) {
  const seguro = (dados) => {
    try {
      ouvinte(dados);
    } catch (err) {
      console.error(`Falha ao tratar o evento interno "${evento}":`, err);
    }
  };
  barramento.on(`interno:${evento}`, seguro);
  return () => barramento.off(`interno:${evento}`, seguro);
}
