import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { buscarLojas, ehErroDeRede } from '../lib/api.js';
import { lerLojasSalvas, salvarLojas } from '../logica/lojas.js';

const LojasContext = createContext(null);

/**
 * Vitrine (GET /publico/lojas): lojas ativas com logo, cor, aberta agora e a
 * próxima abertura. Busca ao abrir, ao voltar para o app e quando a internet
 * volta; a última resposta boa fica no aparelho (sem internet, mostra a salva
 * com a faixa "sem conexão").
 */
export function LojasProvider({ children }) {
  const [estado, setEstado] = useState({ lojas: null, origem: null, salvoEm: 0 });
  const [semConexao, setSemConexao] = useState(false);
  const [buscando, setBuscando] = useState(true);
  const [primeiraTentativa, setPrimeiraTentativa] = useState(false);
  const controle = useRef(null);
  const emPrimeiroPlano = useRef(AppState.currentState === 'active');

  const buscar = useCallback(async ({ forcar = false } = {}) => {
    controle.current?.abort();
    const atual = new AbortController();
    controle.current = atual;
    setBuscando(true);
    try {
      const { lojas } = await buscarLojas(atual.signal, { forcar });
      const agora = Date.now();
      setEstado({ lojas, origem: 'rede', salvoEm: agora });
      setSemConexao(false);
      salvarLojas(lojas, agora);
    } catch (erro) {
      if (erro.name === 'AbortError' && controle.current !== atual) return;
      setSemConexao(true);
      if (!ehErroDeRede(erro) && erro.name !== 'AbortError') console.warn('Lojas:', erro.message);
    } finally {
      if (controle.current === atual) {
        setBuscando(false);
        setPrimeiraTentativa(true);
      }
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    lerLojasSalvas().then((salvo) => {
      if (vivo && salvo) setEstado((e) => (e.origem ? e : { lojas: salvo.lojas, origem: 'aparelho', salvoEm: salvo.salvoEm }));
    });
    buscar();
    return () => {
      vivo = false;
      controle.current?.abort();
    };
  }, [buscar]);

  useEffect(() => {
    const assinatura = AppState.addEventListener('change', (s) => {
      const voltou = s === 'active' && !emPrimeiroPlano.current;
      emPrimeiroPlano.current = s === 'active';
      if (voltou) buscar();
    });
    let conectadoAntes = true;
    const pararRede = NetInfo.addEventListener((s) => {
      const conectado = s.isConnected !== false && s.isInternetReachable !== false;
      if (!conectado) setSemConexao(true);
      else if (!conectadoAntes) buscar();
      conectadoAntes = conectado;
    });
    return () => {
      assinatura.remove();
      pararRede();
    };
  }, [buscar]);

  const recarregar = useCallback(() => buscar({ forcar: true }), [buscar]);
  const valor = useMemo(
    () => ({ ...estado, semConexao, buscando, primeiraTentativa, recarregar }),
    [estado, semConexao, buscando, primeiraTentativa, recarregar],
  );
  return <LojasContext.Provider value={valor}>{children}</LojasContext.Provider>;
}

export function useLojas() {
  const ctx = useContext(LojasContext);
  if (!ctx) throw new Error('useLojas fora do LojasProvider');
  return ctx;
}
