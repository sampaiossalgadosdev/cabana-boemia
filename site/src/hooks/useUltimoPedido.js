import { useCallback, useEffect, useState } from 'react';
import { buscarUltimoPedido } from '../lib/api.js';
import { useCliente } from '../cliente/ClienteContext.jsx';

/** Último pedido do cliente logado (null se não tem ou não está logado). */
export function useUltimoPedido() {
  const { token, status } = useCliente();
  const [pedido, setPedido] = useState(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (status !== 'logado' || !token) {
      setPedido(null);
      return undefined;
    }
    let vivo = true;
    buscarUltimoPedido(token)
      .then((r) => vivo && setPedido(r.pedido))
      .catch(() => {}); // sem botão de repetir; não atrapalha o cardápio
    return () => {
      vivo = false;
    };
  }, [token, status, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { ultimoPedido: pedido, recarregarUltimoPedido: recarregar };
}
