import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import {
  adicionar,
  editar,
  remover,
  carregarCarrinho,
  salvarCarrinho,
  totalCentavos,
  totalItens,
} from './carrinho.js';

function reducer(itens, acao) {
  switch (acao.tipo) {
    case 'adicionar':
      return adicionar(itens, acao.produto, acao.quantidade, acao.observacao);
    case 'editar':
      return editar(itens, acao.id, acao.dados);
    case 'remover':
      return remover(itens, acao.id);
    case 'substituir':
      return acao.itens;
    default:
      return itens;
  }
}

const CarrinhoContext = createContext(null);

export function CarrinhoProvider({ children }) {
  const [itens, despachar] = useReducer(reducer, undefined, () => carregarCarrinho());

  useEffect(() => {
    salvarCarrinho(itens);
  }, [itens]);

  const valor = useMemo(
    () => ({
      itens,
      totalItens: totalItens(itens),
      totalCentavos: totalCentavos(itens),
      adicionar: (produto, quantidade, observacao) =>
        despachar({ tipo: 'adicionar', produto, quantidade, observacao }),
      editar: (id, dados) => despachar({ tipo: 'editar', id, dados }),
      remover: (id) => despachar({ tipo: 'remover', id }),
      substituir: (novos) => despachar({ tipo: 'substituir', itens: novos }),
    }),
    [itens],
  );

  return <CarrinhoContext.Provider value={valor}>{children}</CarrinhoContext.Provider>;
}

export function useCarrinho() {
  const ctx = useContext(CarrinhoContext);
  if (!ctx) throw new Error('useCarrinho fora do CarrinhoProvider');
  return ctx;
}
