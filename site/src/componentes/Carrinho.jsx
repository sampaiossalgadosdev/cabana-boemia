import { useEffect, useState } from 'react';
import { Dialogo } from './Dialogo.jsx';
import { Checkout } from './Checkout.jsx';
import { PedidoEnviado } from './PedidoEnviado.jsx';
import { formatarPreco } from '../lib/dinheiro.js';
import { subtotal } from '../carrinho/carrinho.js';
import { useCarrinho } from '../carrinho/CarrinhoContext.jsx';

export const rotuloItens = (n) => (n === 1 ? '1 item' : `${n} itens`);

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
 * Gaveta da sacola. "Continuar" passa para o checkout na mesma gaveta
 * (login, telefone, dados, pagamento); ao enviar, mostra o pedido recebido.
 */
export function GavetaCarrinho({
  aberta,
  onFechar,
  onEditar,
  fechado = false,
  onPedidoEnviado,
  onCardapioDesatualizado,
  freteGratis = null,
  onFreteGratis,
}) {
  const { itens, totalItens, totalCentavos, remover, substituir } = useCarrinho();
  const [etapa, setEtapa] = useState('itens');
  const [enviado, setEnviado] = useState(null);

  // Fechou a gaveta ou a sacola esvaziou (ex.: item saiu do cardápio): volta aos itens.
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
      titulo={noCheckout ? 'Finalizar pedido' : 'Sua sacola'}
      onFechar={onFechar}
      rodape={
        itens.length > 0 &&
        (noCheckout ? (
          <button type="button" className="botao botao--secundario botao--bloco" onClick={() => setEtapa('itens')}>
            Voltar à sacola
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
        <p className="vazio">Sua sacola está vazia.</p>
      ) : noCheckout ? (
        <Checkout
          onPedidoEnviado={aoEnviar}
          onCardapioDesatualizado={onCardapioDesatualizado}
          freteGratis={freteGratis}
          onFreteGratis={onFreteGratis}
        />
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
