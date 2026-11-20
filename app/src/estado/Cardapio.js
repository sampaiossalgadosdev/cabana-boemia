import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { buscarCardapioDaLoja, buscarConfigDaLoja, ehErroDeRede } from '../lib/api.js';
import { conciliar, mensagensDaConciliacao } from '../logica/carrinho.js';
import { categoriasVisiveis, lerCardapioDaLoja, podePedir, salvarCardapioDaLoja } from '../logica/cardapio.js';
import { useCarrinho } from './Carrinho.js';
import { useAvisos } from './Avisos.js';

export const INTERVALO_MS = 30_000;
const CardapioContext = createContext(null);
const VAZIO = { dados: null, config: null, origem: null, salvoEm: 0, atualizadoEm: 0 };

/**
 * Cardápio DA LOJA ABERTA (`abrirLoja(slug)`, chamado pela página da loja),
 * com a configuração dela (nome, logo, cor, WhatsApp, dados legais, frete grátis):
 * - busca ao abrir a loja, a cada 30 s com o app em primeiro plano (AppState),
 *   ao voltar para o app e quando a internet volta (NetInfo);
 * - a última resposta boa de CADA loja fica salva no aparelho: sem internet,
 *   a loja abre com ela e mostra a faixa "sem conexão";
 * - só resposta da rede concilia a sacola, e só se a sacola é desta loja
 *   (tira o que sumiu, atualiza preço e avisa). O salvo nunca concilia.
 */
export function CardapioProvider({ children }) {
  const carrinho = useCarrinho();
  const { avisar } = useAvisos();
  const [slug, setSlug] = useState(null);
  // origem: 'rede' (agora) | 'aparelho' (salvo) | null (nada ainda)
  const [estado, setEstado] = useState(VAZIO);
  const [semConexao, setSemConexao] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [primeiraTentativa, setPrimeiraTentativa] = useState(false);
  const controle = useRef(null);
  const slugRef = useRef(null);
  const emPrimeiroPlano = useRef(AppState.currentState === 'active');

  const buscar = useCallback(async ({ forcar = false } = {}) => {
    const loja = slugRef.current;
    if (!loja) return;
    controle.current?.abort();
    const atual = new AbortController();
    controle.current = atual;
    setBuscando(true);
    try {
      const [dados, config] = await Promise.all([
        buscarCardapioDaLoja(loja, atual.signal, { forcar }),
        buscarConfigDaLoja(loja, atual.signal, { forcar }),
      ]);
      if (slugRef.current !== loja) return;
      const agora = Date.now();
      setEstado({ dados, config, origem: 'rede', salvoEm: agora, atualizadoEm: agora });
      setSemConexao(false);
      salvarCardapioDaLoja(loja, { cardapio: dados, config }, agora);
    } catch (erro) {
      if (erro.name === 'AbortError' && controle.current !== atual) return;
      if (slugRef.current !== loja) return;
      // Erro HTTP (API fora, 5xx) também vira "sem conexão"; loja que saiu da vitrine (404) idem: mostra a salva.
      setSemConexao(true);
      if (!ehErroDeRede(erro) && erro.name !== 'AbortError') console.warn('Cardápio:', erro.message);
    } finally {
      if (controle.current === atual) {
        setBuscando(false);
        setPrimeiraTentativa(true);
      }
    }
  }, []);

  /** Página da loja: troca a loja (mostra a salva no aparelho enquanto a rede responde) ou atualiza a mesma. */
  const abrirLoja = useCallback(
    (novo) => {
      if (!novo) return;
      // A mesma loja de novo (voltou da lista): mantém o que está na tela e atualiza.
      if (novo === slugRef.current) {
        buscar();
        return;
      }
      slugRef.current = novo;
      setSlug(novo);
      controle.current?.abort();
      setEstado(VAZIO);
      setSemConexao(false);
      setPrimeiraTentativa(false);
      lerCardapioDaLoja(novo).then((salvo) => {
        if (slugRef.current !== novo || !salvo) return;
        setEstado((e) => (e.origem ? e : { dados: salvo.dados, config: salvo.config, origem: 'aparelho', salvoEm: salvo.salvoEm, atualizadoEm: 0 }));
      });
      buscar();
    },
    [buscar],
  );

  useEffect(() => () => controle.current?.abort(), []);

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
      if (!conectado && slugRef.current) setSemConexao(true);
      else if (conectado && !conectadoAntes) buscar();
      conectadoAntes = conectado;
    });
  }, [buscar]);

  // Cada cardápio novo DA REDE concilia a sacola, se ela é desta loja.
  const carrinhoRef = useRef(carrinho);
  carrinhoRef.current = carrinho;
  useEffect(() => {
    const c = carrinhoRef.current;
    if (!estado.atualizadoEm || !c.carregado || c.loja?.slug !== slug) return;
    const r = conciliar(c.itens, estado.dados.categorias);
    if (!r.mudou) return;
    c.substituir(r.itens);
    mensagensDaConciliacao(r).forEach(avisar);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando chega cardápio novo ou a sacola termina de carregar
  }, [estado.atualizadoEm, carrinho.carregado]);

  // recarregar = o cliente pediu ("Tentar de novo"): sempre do servidor, sem o cache de 15 s.
  const recarregar = useCallback(() => buscar({ forcar: true }), [buscar]);

  const valor = useMemo(() => {
    const categorias = categoriasVisiveis(estado.dados);
    // A loja (para o tema, a sacola e o cancelamento): a configuração dela.
    const loja = estado.config ? { ...estado.config, slug: estado.config.slug ?? slug } : slug ? { slug, nome: '' } : null;
    return {
      ...estado,
      slug,
      loja,
      abrirLoja,
      categorias,
      produtosPorId: new Map(estado.dados?.categorias.flatMap((c) => c.produtos).map((p) => [p.id, p]) ?? []),
      aberto: Boolean(estado.dados?.aberto),
      podePedir: podePedir(estado),
      semConexao,
      buscando,
      primeiraTentativa,
      recarregar,
    };
  }, [estado, slug, abrirLoja, semConexao, buscando, primeiraTentativa, recarregar]);

  return <CardapioContext.Provider value={valor}>{children}</CardapioContext.Provider>;
}

export function useCardapio() {
  const ctx = useContext(CardapioContext);
  if (!ctx) throw new Error('useCardapio fora do CardapioProvider');
  return ctx;
}
