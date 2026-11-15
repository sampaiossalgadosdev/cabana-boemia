import { useEffect, useState } from 'react';
import { Dialogo } from './Dialogo.jsx';
import { Checkout } from './Checkout.jsx';
import { PedidoEnviado } from './PedidoEnviado.jsx';
import { formatarPreco } from '../lib/dinheiro.js';
import { subtotal } from '../carrinho/carrinho.js';
import { useCarrinho } from '../carrinho/CarrinhoContext.jsx';

const rotuloItens = (n) => (n === 1 ? '1 item' : `${n} itens`);

/** Barra fixa no rodapé; some com o carrinho vazio. */
export function BarraCarrinho({ onAbrir }) {
  const { totalItens, totalCentavos } = useCarrinho();
  if (!totalItens) return null;
  return (
    <div className="barra-carrinho">
      <button type="button" className="barra-carrinho__botao" onClick={onAbrir}>
        <span className="barra-carrinho__contador" aria-hidden="true">
          {totalItens}
        </span>
        <span className="barra-carrinho__texto">Ver carrinho · {rotuloItens(totalItens)}</span>
        <span className="barra-carrinho__total">{formatarPreco(totalCentavos)}</span>
      </button>
    </div>
  );
}

function ItemCarrinho({ item, onEditar, onRemover }) {
  return (
    <li className="item-carrinho">
      <div className="item-carrinho__linha">
        <span>
          <span className="item-carrinho__qtd">{item.quantidade}×</span> {item.nome}
        </span>
        <span>{formatarPreco(subtotal(item))}</span>
      </div>
      {item.observacao && (
        <div className="observacao">
          <span className="sr-only">Observação: </span>
          {item.observacao}
        </div>
      )}
      <div className="item-carrinho__acoes">
        <button type="button" className="botao botao--texto" onClick={() => onEditar(item)}>
          Editar
        </button>
        <button type="button" className="botao botao--texto" onClick={() => onRemover(item)}>
          Remover
        </button>
      </div>
    </li>
  );
}

/**
 * Gaveta do carrinho. "Continuar" passa para o checkout na mesma gaveta
 * (login, telefone, dados, pagamento); ao enviar, mostra o pedido recebido.
 */
export function GavetaCarrinho({ aberta, onFechar, onEditar, fechado = false, onPedidoEnviado, onCardapioDesatualizado }) {
  const { itens, totalItens, totalCentavos, remover, substituir } = useCarrinho();
  const [etapa, setEtapa] = useState('itens');
  const [enviado, setEnviado] = useState(null);

  // Fechou a gaveta ou o carrinho esvaziou (ex.: item saiu do cardápio): volta aos itens.
  useEffect(() => {
    if (!aberta || itens.length === 0) setEtapa('itens');
    if (!aberta) setEnviado(null);
  }, [aberta, itens.length]);

  const aoEnviar = (pedido) => {
    setEnviado(pedido);
    substituir([]);
    onPedidoEnviado?.(pedido);
  };

  if (enviado) {
    return (
      <Dialogo aberto={aberta} titulo="Pedido enviado" onFechar={onFechar}>
        <PedidoEnviado pedido={enviado} onFechar={onFechar} />
      </Dialogo>
    );
  }

  const noCheckout = etapa === 'checkout';

  return (
    <Dialogo
      aberto={aberta}
      titulo={noCheckout ? 'Finalizar pedido' : 'Seu carrinho'}
      onFechar={onFechar}
      rodape={
        itens.length > 0 &&
        (noCheckout ? (
          <button type="button" className="botao botao--secundario botao--bloco" onClick={() => setEtapa('itens')}>
            Voltar ao carrinho
          </button>
        ) : (
          <>
            <div className="total">
              <span>Total dos itens ({rotuloItens(totalItens)})</span>
              <span>{formatarPreco(totalCentavos)}</span>
            </div>
            <button
              type="button"
              className="botao botao--primario botao--bloco"
              disabled={fechado}
              onClick={() => setEtapa('checkout')}
            >
              Continuar
            </button>
            {fechado && <p className="nota">Estamos fechados agora. Os pedidos voltam quando abrirmos.</p>}
          </>
        ))
      }
    >
      {itens.length === 0 ? (
        <p className="vazio">Seu carrinho está vazio.</p>
      ) : noCheckout ? (
        <Checkout onPedidoEnviado={aoEnviar} onCardapioDesatualizado={onCardapioDesatualizado} />
      ) : (
        <ul className="itens-carrinho">
          {itens.map((item) => (
            <ItemCarrinho
              key={item.id}
              item={item}
              onEditar={onEditar}
              onRemover={(i) => remover(i.id)}
            />
          ))}
        </ul>
      )}
    </Dialogo>
  );
}
