import { EventEmitter } from 'node:events';

/**
 * Barramento interno de eventos para a equipe (PDV/retaguarda). Os services
 * publicam aqui SÓ DEPOIS do commit; o Socket.IO (lib/tempoReal.js) repassa
 * para a sala da equipe. Sem Socket.IO (testes), ninguém escuta e nada quebra.
 */
const barramento = new EventEmitter();
barramento.setMaxListeners(50);

/** @param {'pedido:novo' | 'pedido:atualizado' | 'impressao:nova'} evento */
export function emitirParaEquipe(evento, dados) {
  barramento.emit('equipe', evento, dados);
}

/** @returns {() => void} função para parar de escutar */
export function aoEmitirParaEquipe(ouvinte) {
  const seguro = (evento, dados) => {
    try {
      ouvinte(evento, dados);
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
