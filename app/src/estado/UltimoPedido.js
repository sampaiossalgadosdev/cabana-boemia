import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import * as api from '../lib/api.js';
import { avisosDaRepeticaoComSaldo, repetirComSaldo } from '../logica/cardapio.js';
import { useCliente } from './Cliente.js';
import { useCarrinho } from './Carrinho.js';
import { useCardapio } from './Cardapio.js';
import { useAvisos } from './Avisos.js';

const UltimoPedidoContext = createContext(null);

/**
 * Último pedido do cliente logado (botão "Repetir último pedido" no Início) e
 * o "repetir" usado também na aba Pedidos: só o que está no cardápio agora,
 * com o preço de agora e sem passar do saldo; abre a sacola se algo entrou.
 */
export function UltimoPedidoProvider({ children }) {
  const { status, chamar } = useCliente();
  const carrinho = useCarrinho();
  const { categorias } = useCardapio();
  const { avisar } = useAvisos();
  const [ultimoPedido, setUltimoPedido] = useState(null);
  const [versao, setVersao] = useState(0);
  // Pedido recém-criado, para a tela "pedido enviado" (o checkout troca de tela e limpa a sacola).
  const [pedidoEnviado, setPedidoEnviado] = useState(null);

  useEffect(() => {
    if (status !== 'logado') {
      setUltimoPedido(null);
      return undefined;
    }
    let vivo = true;
    chamar((token) => api.buscarUltimoPedido(token))
      .then((r) => vivo && setUltimoPedido(r.pedido))
      .catch(() => {}); // sem o botão; não atrapalha o cardápio
    return () => {
      vivo = false;
    };
  }, [status, chamar, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  const repetir = useCallback(
    (pedido) => {
      const r = repetirComSaldo(carrinho.itens, pedido, categorias);
      const { mensagens, abrirSacola } = avisosDaRepeticaoComSaldo(r);
      if (r.adicionados) carrinho.substituir(r.itens);
      mensagens.forEach(avisar);
      if (abrirSacola) router.push('/sacola');
    },
    [carrinho, categorias, avisar],
  );

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
