import { Dialogo } from './Dialogo.jsx';
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

/** Gaveta com os itens. Checkout fica para depois (botão desabilitado). */
export function GavetaCarrinho({ aberta, onFechar, onEditar }) {
  const { itens, totalItens, totalCentavos, remover } = useCarrinho();

  return (
    <Dialogo
      aberto={aberta}
      titulo="Seu carrinho"
      onFechar={onFechar}
      rodape={
        itens.length > 0 && (
          <>
            <div className="total">
              <span>Total dos itens ({rotuloItens(totalItens)})</span>
              <span>{formatarPreco(totalCentavos)}</span>
            </div>
            <button type="button" className="botao botao--primario botao--bloco" disabled>
              Continuar
            </button>
            <p className="nota">Finalização do pedido em breve.</p>
          </>
        )
      }
    >
      {itens.length === 0 ? (
        <p className="vazio">Seu carrinho está vazio.</p>
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
