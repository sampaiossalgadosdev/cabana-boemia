import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { buscarCardapio, ehErroDeRede } from '../lib/api.js';
import { conciliar, mensagensDaConciliacao } from '../logica/carrinho.js';
import { categoriasVisiveis, lerCardapioSalvo, podePedir, salvarCardapio } from '../logica/cardapio.js';
import { useCarrinho } from './Carrinho.js';
import { useAvisos } from './Avisos.js';

export const INTERVALO_MS = 30_000;
const CardapioContext = createContext(null);

/**
 * Cardápio da loja, como o useCardapio do site, adaptado ao celular:
 * - busca ao abrir, a cada 30 s com o app em primeiro plano (AppState) e ao
 *   voltar para o app; também quando a internet volta (NetInfo);
 * - a última resposta boa fica salva no aparelho: sem internet, o app abre
 *   com ela e mostra a faixa "sem conexão";
 * - só resposta da rede concilia a sacola (tira o que sumiu, atualiza preço e
 *   avisa). O cardápio salvo nunca concilia: poderia estar velho.
 */
export function CardapioProvider({ children }) {
  const carrinho = useCarrinho();
  const { avisar } = useAvisos();
  // origem: 'rede' (agora) | 'aparelho' (salvo) | null (nada ainda)
  const [estado, setEstado] = useState({ dados: null, origem: null, salvoEm: 0, atualizadoEm: 0 });
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
      const dados = await buscarCardapio(atual.signal, { forcar });
      const agora = Date.now();
      setEstado({ dados, origem: 'rede', salvoEm: agora, atualizadoEm: agora });
      setSemConexao(false);
      salvarCardapio(dados, agora);
    } catch (erro) {
      if (erro.name === 'AbortError' && controle.current !== atual) return; // trocada por outra busca
      // Erro HTTP (API fora, 5xx) também vira "sem conexão": o cliente não tem o que fazer além de esperar.
      setSemConexao(true);
      if (!ehErroDeRede(erro) && erro.name !== 'AbortError') console.warn('Cardápio:', erro.message);
    } finally {
      if (controle.current === atual) {
        setBuscando(false);
        setPrimeiraTentativa(true);
      }
    }
  }, []);

  // Abre com o cardápio salvo (se houver) enquanto a rede responde.
  useEffect(() => {
    let vivo = true;
    lerCardapioSalvo().then((salvo) => {
      if (!vivo || !salvo) return;
      setEstado((e) => (e.origem ? e : { dados: salvo.dados, origem: 'aparelho', salvoEm: salvo.salvoEm, atualizadoEm: 0 }));
    });
    buscar();
    return () => {
      vivo = false;
      controle.current?.abort();
    };
  }, [buscar]);

  // 30 s, só em primeiro plano; voltar para o app busca na hora.
  useEffect(() => {
    const timer = setInterval(() => {
      if (emPrimeiroPlano.current) buscar();
    }, INTERVALO_MS);
    const assinatura = AppState.addEventListener('change', (s) => {
      const voltou = s === 'active' && !emPrimeiroPlano.current;
      emPrimeiroPlano.current = s === 'active';
      if (voltou) buscar();
    });
    return () => {
      clearInterval(timer);
      assinatura.remove();
    };
  }, [buscar]);

  // Internet caiu: faixa na hora. Voltou: busca sem esperar os 30 s.
  useEffect(() => {
    let conectadoAntes = true;
    return NetInfo.addEventListener((s) => {
      const conectado = s.isConnected !== false && s.isInternetReachable !== false;
      if (!conectado) setSemConexao(true);
      else if (!conectadoAntes) buscar();
      conectadoAntes = conectado;
    });
  }, [buscar]);

  // Cada cardápio novo DA REDE concilia a sacola (depois que ela foi lida do aparelho).
  const itensRef = useRef(carrinho.itens);
  itensRef.current = carrinho.itens;
  useEffect(() => {
    if (!estado.atualizadoEm || !carrinho.carregado) return;
    const r = conciliar(itensRef.current, estado.dados.categorias);
    if (!r.mudou) return;
    carrinho.substituir(r.itens);
    mensagensDaConciliacao(r).forEach(avisar);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando chega cardápio novo ou a sacola termina de carregar
  }, [estado.atualizadoEm, carrinho.carregado]);

  // recarregar = o cliente pediu ("Tentar de novo"): sempre do servidor, sem o cache de 15 s.
  const recarregar = useCallback(() => buscar({ forcar: true }), [buscar]);

  const valor = useMemo(() => {
    const categorias = categoriasVisiveis(estado.dados);
    return {
      ...estado,
      categorias,
      produtosPorId: new Map(estado.dados?.categorias.flatMap((c) => c.produtos).map((p) => [p.id, p]) ?? []),
      aberto: Boolean(estado.dados?.aberto),
      podePedir: podePedir(estado),
      semConexao,
      buscando,
      primeiraTentativa,
      recarregar,
    };
  }, [estado, semConexao, buscando, primeiraTentativa, recarregar]);

  return <CardapioContext.Provider value={valor}>{children}</CardapioContext.Provider>;
}

export function useCardapio() {
  const ctx = useContext(CardapioContext);
  if (!ctx) throw new Error('useCardapio fora do CardapioProvider');
  return ctx;
}
