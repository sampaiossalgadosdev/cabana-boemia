import { useCallback, useEffect, useState } from 'react';
import { useCliente } from '../cliente/ClienteContext.jsx';
import { sessaoExpirou } from '../cliente/sessao.js';
import * as api from '../lib/api.js';
import { formatarPreco } from '../lib/dinheiro.js';
import { dataDoPedido, resumoItens, rotuloPagamento } from '../pedido/pedido.js';
import { EntrarComGoogle } from './EntrarComGoogle.jsx';

const ERRO_GENERICO = 'Não foi possível carregar seus pedidos. Confira sua conexão e tente de novo.';

function CartaoPedido({ pedido, podeRepetir, onRepetir }) {
  const cancelado = pedido.status === 'CANCELADO';
  return (
    <li className={`cartao-pedido${cancelado ? ' cartao-pedido--cancelado' : ''}`}>
      <div className="cartao-pedido__topo">
        <span className="cartao-pedido__numero">Pedido nº {pedido.numeroDia}</span>
        <time className="cartao-pedido__data" dateTime={pedido.criadoEm}>
          {dataDoPedido(pedido.criadoEm)}
        </time>
      </div>
      <p className="cartao-pedido__itens">{resumoItens(pedido.itens)}</p>
      <div className="cartao-pedido__rodape">
        <div>
          <strong className="cartao-pedido__total">{formatarPreco(pedido.totalCentavos)}</strong>
          <span className="cartao-pedido__pagamento">
            {pedido.formaPagamento ? rotuloPagamento(pedido.formaPagamento) : ''}
            {cancelado && <span className="cartao-pedido__selo">Cancelado</span>}
          </span>
        </div>
        <button
          type="button"
          className="botao botao--secundario"
          disabled={!podeRepetir || pedido.itens.length === 0}
          onClick={() => onRepetir(pedido)}
        >
          Repetir pedido
        </button>
      </div>
    </li>
  );
}

/**
 * Aba "Pedidos": histórico do cliente logado (mais novo primeiro, 20 por vez)
 * com "Repetir pedido". Sem login, pede o login com Google.
 */
export function TelaPedidos({ fechado, onRepetir }) {
  const { token, status, sair } = useCliente();
  const [pedidos, setPedidos] = useState(null);
  const [proximo, setProximo] = useState(null);
  const [erro, setErro] = useState('');
  const [carregandoMais, setCarregandoMais] = useState(false);

  const carregar = useCallback(
    async (antesDeId) => {
      setErro('');
      try {
        const r = await api.listarPedidos(token, antesDeId);
        setPedidos((atual) => (antesDeId ? [...(atual ?? []), ...r.pedidos] : r.pedidos));
        setProximo(r.proximo);
      } catch (err) {
        if (sessaoExpirou(err)) sair();
        else setErro(ERRO_GENERICO);
      }
    },
    [token, sair],
  );

  useEffect(() => {
    if (status === 'logado') carregar();
    else setPedidos(null);
  }, [status, carregar]);

  if (status === 'carregando') return <p className="nota">Carregando…</p>;
  if (status !== 'logado') {
    return (
      <div className="pagina-cliente">
        <h1 className="pagina-cliente__titulo">Pedidos</h1>
        <EntrarComGoogle
          titulo="Entre para ver seus pedidos"
          texto="Com sua conta Google você vê os pedidos que já fez e repete qualquer um com um toque."
        />
      </div>
    );
  }

  return (
    <div className="pagina-cliente">
      <h1 className="pagina-cliente__titulo">Pedidos</h1>
      {fechado && pedidos?.length > 0 && (
        <p className="nota nota--esquerda">Estamos fechados agora: dá para repetir um pedido quando abrirmos.</p>
      )}
      {pedidos === null ? (
        erro ? (
          <div className="vazio">
            <p>{erro}</p>
            <button type="button" className="botao botao--secundario" onClick={() => carregar()}>
              Tentar de novo
            </button>
          </div>
        ) : (
          <p className="nota">Carregando seus pedidos…</p>
        )
      ) : pedidos.length === 0 ? (
        <p className="vazio">Você ainda não fez nenhum pedido.</p>
      ) : (
        <>
          <ul className="lista-pedidos">
            {pedidos.map((p) => (
              <CartaoPedido key={p.id} pedido={p} podeRepetir={!fechado} onRepetir={onRepetir} />
            ))}
          </ul>
          {erro && (
            <p className="erro" role="alert">
              {erro}
            </p>
          )}
          {proximo && (
            <button
              type="button"
              className="botao botao--texto botao--bloco"
              disabled={carregandoMais}
              onClick={async () => {
                setCarregandoMais(true);
                await carregar(proximo);
                setCarregandoMais(false);
              }}
            >
              {carregandoMais ? 'Carregando…' : 'Ver pedidos mais antigos'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
