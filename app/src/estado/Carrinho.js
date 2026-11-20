import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import { Alert } from 'react-native';
import { adicionar, editar, remover, totalCentavos, totalItens } from '../logica/carrinho.js';
import { carregarSacola, precisaEsvaziar, salvarSacola } from '../logica/lojas.js';

const lojaDa = (loja) => (loja ? { slug: loja.slug, nome: loja.nome } : null);

function reducer(estado, acao) {
  const { itens } = estado;
  switch (acao.tipo) {
    case 'carregado': {
      // O cliente pode ter adicionado algo antes de o AsyncStorage responder: vale a loja dele, e soma se for a mesma.
      if (itens.length && estado.loja && acao.sacola.loja?.slug !== estado.loja.slug) return { ...estado, carregado: true };
      const somados = itens.reduce(
        (acc, i) => adicionar(acc, { id: i.produtoId, nome: i.nome, precoCentavos: i.precoCentavos }, i.quantidade, i.observacao),
        acao.sacola.itens,
      );
      return { carregado: true, loja: estado.loja ?? acao.sacola.loja, itens: somados };
    }
    case 'adicionar': {
      // Outra loja: quem chamou já confirmou que pode esvaziar.
      const base = estado.loja && estado.loja.slug !== acao.loja.slug ? [] : itens;
      return { ...estado, loja: lojaDa(acao.loja), itens: adicionar(base, acao.produto, acao.quantidade, acao.observacao) };
    }
    case 'editar':
      return { ...estado, itens: editar(itens, acao.id, acao.dados) };
    case 'remover': {
      const restantes = remover(itens, acao.id);
      return { ...estado, itens: restantes, loja: restantes.length ? estado.loja : null };
    }
    case 'substituir':
      return { ...estado, itens: acao.itens, loja: acao.itens.length ? lojaDa(acao.loja ?? estado.loja) : null };
    default:
      return estado;
  }
}

const CarrinhoContext = createContext(null);

/**
 * Sacola (o código continua "carrinho", como no site), PRESA A UMA LOJA: um
 * pedido é sempre de uma loja só. Pôr item de outra loja pergunta se pode
 * esvaziar (`confirmarLoja`). Salva no AsyncStorage `{ loja, itens }` a cada
 * mudança, só depois de ler o que estava salvo (a sacola antiga, sem loja,
 * vira da Cabana).
 */
export function CarrinhoProvider({ children }) {
  const [estado, despachar] = useReducer(reducer, { carregado: false, loja: null, itens: [] });

  useEffect(() => {
    let vivo = true;
    carregarSacola().then((sacola) => vivo && despachar({ tipo: 'carregado', sacola }));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (estado.carregado) salvarSacola(estado);
  }, [estado]);

  /**
   * Antes de pôr na sacola um item da `loja`: se a sacola tem itens de outra,
   * pergunta. @returns {Promise<boolean>} pode seguir
   */
  const confirmarLoja = useCallback(
    (loja) =>
      new Promise((resolve) => {
        if (!precisaEsvaziar(estado, loja.slug)) return resolve(true);
        Alert.alert(
          'Sacola de outra loja',
          `Sua sacola tem itens de ${estado.loja.nome}. Um pedido é de uma loja só: esvaziar a sacola e começar em ${loja.nome}?`,
          [
            { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Esvaziar e adicionar', style: 'destructive', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      }),
    [estado],
  );

  const valor = useMemo(
    () => ({
      carregado: estado.carregado,
      loja: estado.loja,
      itens: estado.itens,
      totalItens: totalItens(estado.itens),
      totalCentavos: totalCentavos(estado.itens),
      confirmarLoja,
      /** @param {{ slug: string, nome: string }} loja a loja do produto */
      adicionar: (produto, quantidade, observacao, loja) => despachar({ tipo: 'adicionar', produto, quantidade, observacao, loja }),
      editar: (id, dados) => despachar({ tipo: 'editar', id, dados }),
      remover: (id) => despachar({ tipo: 'remover', id }),
      substituir: (itens, loja) => despachar({ tipo: 'substituir', itens, loja }),
    }),
    [estado, confirmarLoja],
  );

  return <CarrinhoContext.Provider value={valor}>{children}</CarrinhoContext.Provider>;
}

export function useCarrinho() {
  const ctx = useContext(CarrinhoContext);
  if (!ctx) throw new Error('useCarrinho fora do CarrinhoProvider');
  return ctx;
}
