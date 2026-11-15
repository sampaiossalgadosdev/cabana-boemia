import { useCallback, useEffect, useRef, useState } from 'react';
import { buscarCardapio } from '../lib/api.js';

export const INTERVALO_MS = 30_000;

/**
 * Busca o cardápio, atualiza a cada 30 s (só com a aba visível) e de novo
 * quando a aba volta a ficar visível. Em falha mantém o último cardápio e
 * marca `semConexao`; `atualizadoEm` só muda em respostas bem-sucedidas.
 */
export function useCardapio(intervaloMs = INTERVALO_MS) {
  const [estado, setEstado] = useState({ dados: null, semConexao: false, atualizadoEm: 0 });
  const controle = useRef(null);

  const buscar = useCallback(async () => {
    controle.current?.abort();
    const atual = new AbortController();
    controle.current = atual;
    try {
      const dados = await buscarCardapio(atual.signal);
      setEstado({ dados, semConexao: false, atualizadoEm: Date.now() });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setEstado((s) => ({ ...s, semConexao: true }));
    }
  }, []);

  useEffect(() => {
    buscar();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') buscar();
    }, intervaloMs);
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'visible') buscar();
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      controle.current?.abort();
    };
  }, [buscar, intervaloMs]);

  return { ...estado, recarregar: buscar };
}
