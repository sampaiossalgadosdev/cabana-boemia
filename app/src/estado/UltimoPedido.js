import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import * as api from '../lib/api.js';
import { avisosDaRepeticaoComSaldo, repetirComSaldo } from '../logica/cardapio.js';
import { LOJA_DA_SACOLA_ANTIGA } from '../logica/lojas.js';
import { useCliente } from './Cliente.js';
import { useCarrinho } from './Carrinho.js';
import { useCardapio } from './Cardapio.js';
import { useAvisos } from './Avisos.js';

const UltimoPedidoContext = createContext(null);

/** Loja do pedido (pedido antigo, sem `loja` na resposta, é da Cabana). */
const lojaDoPedido = (pedido) => pedido?.loja ?? LOJA_DA_SACOLA_ANTIGA;

/**
 * Último pedido do cliente NA LOJA ABERTA (botão "Repetir último pedido" da
 * página da loja) e o "repetir" usado também na aba Pedidos: só o que está no
 * cardápio da loja agora, com o preço de agora e sem passar do saldo; abre a
 * sacola se algo entrou. Pedido de outra loja: abre a página dela e repete
 * quando o cardápio dela chegar da rede (a sacola de outra loja pede para esvaziar).
 */
export function UltimoPedidoProvider({ children }) {
  const { status, chamar } = useCliente();
  const carrinho = useCarrinho();
  const cardapio = useCardapio();
  const { avisar } = useAvisos();
  const [ultimoPedido, setUltimoPedido] = useState(null);
  const [versao, setVersao] = useState(0);
  const [pendente, setPendente] = useState(null);
  // Pedido recém-criado, para a tela "pedido enviado" (o checkout troca de tela e limpa a sacola).
  const [pedidoEnviado, setPedidoEnviado] = useState(null);

  useEffect(() => {
    setUltimoPedido(null);
    if (status !== 'logado' || !cardapio.slug) return undefined;
    let vivo = true;
    chamar((token) => api.buscarUltimoPedido(token, cardapio.slug))
      .then((r) => vivo && setUltimoPedido(r.pedido))
      .catch(() => {}); // sem o botão; não atrapalha o cardápio
    return () => {
      vivo = false;
    };
  }, [status, chamar, versao, cardapio.slug]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  // Executa com o cardápio da loja do pedido já na tela.
  const executar = useCallback(
    async (pedido) => {
      const loja = { slug: cardapio.slug, nome: cardapio.loja?.nome || lojaDoPedido(pedido).nome };
      if (!cardapio.podePedir) {
        avisar(`${loja.nome} está fechada agora: dá para repetir quando abrir.`);
        return;
      }
      if (!(await carrinho.confirmarLoja(loja))) return;
      const base = carrinho.loja?.slug === loja.slug ? carrinho.itens : [];
      const r = repetirComSaldo(base, pedido, cardapio.categorias);
      const { mensagens, abrirSacola } = avisosDaRepeticaoComSaldo(r);
      if (r.adicionados) carrinho.substituir(r.itens, loja);
      mensagens.forEach(avisar);
      if (abrirSacola) router.push('/sacola');
    },
    [carrinho, cardapio, avisar],
  );

  const repetir = useCallback(
    (pedido) => {
      const { slug } = lojaDoPedido(pedido);
      if (cardapio.slug === slug && cardapio.origem === 'rede') {
        executar(pedido);
        return;
      }
      setPendente(pedido);
      cardapio.abrirLoja(slug);
      router.push(`/loja/${slug}`);
    },
    [cardapio, executar],
  );

  // Repetir pedido de outra loja: espera o cardápio dela chegar da rede.
  const executando = useRef(false);
  useEffect(() => {
    if (!pendente || executando.current || cardapio.slug !== lojaDoPedido(pendente).slug) return;
    if (cardapio.origem === 'rede') {
      executando.current = true;
      executar(pendente).finally(() => {
        executando.current = false;
        setPendente(null);
      });
    } else if (cardapio.primeiraTentativa && cardapio.semConexao) {
      avisar('Sem conexão: não deu para repetir o pedido agora.');
      setPendente(null);
    }
  }, [pendente, cardapio.slug, cardapio.origem, cardapio.atualizadoEm, cardapio.primeiraTentativa, cardapio.semConexao, executar, avisar]);

  const valor = useMemo(
    () => ({ ultimoPedido, recarregar, repetir, pedidoEnviado, setPedidoEnviado }),
    [ultimoPedido, recarregar, repetir, pedidoEnviado],
  );
  return <UltimoPedidoContext.Provider value={valor}>{children}</UltimoPedidoContext.Provider>;
}

export function useUltimoPedido() {
  const ctx = useContext(UltimoPedidoContext);
  if (!ctx) throw new Error('useUltimoPedido fora do UltimoPedidoProvider');
  return ctx;
}
