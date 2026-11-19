import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { adicionar, editar, remover, carregarCarrinho, salvarCarrinho, totalCentavos, totalItens } from '../logica/carrinho.js';

function reducer(estado, acao) {
  const { itens } = estado;
  switch (acao.tipo) {
    case 'carregado':
      // O cliente pode ter adicionado algo antes de o AsyncStorage responder: soma.
      return { carregado: true, itens: itens.reduce((acc, i) => adicionar(acc, { id: i.produtoId, nome: i.nome, precoCentavos: i.precoCentavos }, i.quantidade, i.observacao), acao.itens) };
    case 'adicionar':
      return { ...estado, itens: adicionar(itens, acao.produto, acao.quantidade, acao.observacao) };
    case 'editar':
      return { ...estado, itens: editar(itens, acao.id, acao.dados) };
    case 'remover':
      return { ...estado, itens: remover(itens, acao.id) };
    case 'substituir':
      return { ...estado, itens: acao.itens };
    default:
      return estado;
  }
}

const CarrinhoContext = createContext(null);

/**
 * Sacola (o código continua "carrinho", como no site). Salva no AsyncStorage a
 * cada mudança, só depois de ler o que estava salvo (senão gravaria a sacola
 * vazia por cima).
 */
export function CarrinhoProvider({ children }) {
  const [estado, despachar] = useReducer(reducer, { carregado: false, itens: [] });

  useEffect(() => {
    let vivo = true;
    carregarCarrinho().then((itens) => vivo && despachar({ tipo: 'carregado', itens }));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (estado.carregado) salvarCarrinho(estado.itens);
  }, [estado]);

  const valor = useMemo(
    () => ({
      carregado: estado.carregado,
      itens: estado.itens,
      totalItens: totalItens(estado.itens),
      totalCentavos: totalCentavos(estado.itens),
      adicionar: (produto, quantidade, observacao) => despachar({ tipo: 'adicionar', produto, quantidade, observacao }),
      editar: (id, dados) => despachar({ tipo: 'editar', id, dados }),
      remover: (id) => despachar({ tipo: 'remover', id }),
      substituir: (itens) => despachar({ tipo: 'substituir', itens }),
    }),
    [estado],
  );

  return <CarrinhoContext.Provider value={valor}>{children}</CarrinhoContext.Provider>;
}

export function useCarrinho() {
  const ctx = useContext(CarrinhoContext);
  if (!ctx) throw new Error('useCarrinho fora do CarrinhoProvider');
  return ctx;
}
