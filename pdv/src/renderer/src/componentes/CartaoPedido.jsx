import { useState } from 'react';
import {
  FORMAS_PAGAMENTO,
  NOME_CANAL,
  NOME_PAGAMENTO,
  formatarHora,
  formatarPeso,
  formatarPreco,
  formatarTelefone,
} from '../lib/formatar.js';

/**
 * Um pedido da fila. "Finalizar" abre a escolha da forma de pagamento
 * (pré-selecionada com a do pedido; a escolhida sobrescreve).
 */
export function CartaoPedido({ pedido, novo, aoFinalizar, aoCancelar, aoVer }) {
  const [acao, setAcao] = useState(null); // null | 'finalizar' | 'cancelar'
  const finalizando = acao === 'finalizar';
  const [forma, setForma] = useState(pedido.formaPagamento ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    if (!forma) {
      setErro('Escolha a forma de pagamento');
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      await aoFinalizar(pedido.id, forma);
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  async function confirmarCancelamento() {
    setEnviando(true);
    setErro('');
    try {
      await aoCancelar(pedido.id);
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  const fechar = () => {
    setAcao(null);
    setErro('');
  };

  const troco =
    pedido.formaPagamento === 'DINHEIRO' && pedido.trocoParaCentavos
      ? pedido.trocoParaCentavos - pedido.totalCentavos
      : null;

  return (
    <article
      className={`pedido ${novo ? 'pedido--novo' : ''}`}
      onPointerDown={novo ? aoVer : undefined}
      aria-label={`Pedido ${pedido.numeroDia}`}
    >
      <header className="pedido__topo">
        <span className="pedido__numero">#{pedido.numeroDia}</span>
        <span className={`selo selo--${pedido.canal.toLowerCase()}`}>{NOME_CANAL[pedido.canal] ?? pedido.canal}</span>
        {novo && <span className="selo selo--novo">Novo</span>}
        <span className="pedido__hora">
          {formatarHora(pedido.criadoEm)}
          {pedido.tempoEstimadoMin ? ` · ${pedido.tempoEstimadoMin} min` : ''}
        </span>
      </header>

      <div className="pedido__cliente">
        <strong>{pedido.nomeCliente}</strong>
        {pedido.telefone && <span>{formatarTelefone(pedido.telefone)}</span>}
      </div>
      {pedido.enderecoTexto && (
        <p className="pedido__endereco">
          {pedido.enderecoTexto}
          {pedido.bairroNome && <span className="pedido__bairro"> · {pedido.bairroNome}</span>}
        </p>
      )}

      <ul className="pedido__itens">
        {pedido.itens.map((i) => (
          <li key={i.id}>
            <div className="item">
              <span className="item__qtd">{i.pesoGramas ? formatarPeso(i.pesoGramas) : `${i.quantidade}×`}</span>
              <span className="item__nome">{i.nome}</span>
              <span className="item__total">{formatarPreco(i.totalCentavos)}</span>
            </div>
            {i.observacao && <p className="item__obs">{i.observacao}</p>}
          </li>
        ))}
      </ul>

      <dl className="pedido__valores">
        {pedido.taxaEntregaCentavos > 0 && (
          <>
            <dt>Entrega</dt>
            <dd>{formatarPreco(pedido.taxaEntregaCentavos)}</dd>
          </>
        )}
        <dt className="pedido__total">Total</dt>
        <dd className="pedido__total">{formatarPreco(pedido.totalCentavos)}</dd>
        <dt>Pagamento</dt>
        <dd>
          {NOME_PAGAMENTO[pedido.formaPagamento] ?? '—'}
          {troco != null && (
            <span className="pedido__troco">
              {' '}
              · troco p/ {formatarPreco(pedido.trocoParaCentavos)} (levar {formatarPreco(troco)})
            </span>
          )}
        </dd>
      </dl>

      {finalizando ? (
        <div className="finalizar">
          <fieldset className="finalizar__formas" disabled={enviando}>
            <legend>Forma de pagamento</legend>
            {FORMAS_PAGAMENTO.map((f) => (
              <label key={f} className={`opcao ${forma === f ? 'opcao--marcada' : ''}`}>
                <input type="radio" name={`forma-${pedido.id}`} value={f} checked={forma === f}
                  onChange={() => setForma(f)} />
                {NOME_PAGAMENTO[f]}
              </label>
            ))}
          </fieldset>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="finalizar__acoes">
            <button type="button" className="botao botao--contorno" disabled={enviando} onClick={fechar}>
              Voltar
            </button>
            <button type="button" className="botao" disabled={enviando} onClick={confirmar}>
              {enviando ? 'Finalizando…' : 'Confirmar'}
            </button>
          </div>
        </div>
      ) : acao === 'cancelar' ? (
        <div className="finalizar cancelar" role="group" aria-label="Cancelar pedido">
          <p className="cancelar__pergunta">
            Cancelar o pedido #{pedido.numeroDia}? O estoque volta e sai um cupom de cancelamento.
          </p>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="finalizar__acoes">
            <button type="button" className="botao botao--contorno" disabled={enviando} onClick={fechar} autoFocus>
              Não
            </button>
            <button type="button" className="botao botao--perigo" disabled={enviando} onClick={confirmarCancelamento}>
              {enviando ? 'Cancelando…' : 'Sim, cancelar'}
            </button>
          </div>
        </div>
      ) : (
        <div className="pedido__acoes">
          <button type="button" className="botao botao--contorno" onClick={() => setAcao('cancelar')}>
            Cancelar
          </button>
          <button type="button" className="botao" onClick={() => setAcao('finalizar')}>
            Finalizar
          </button>
        </div>
      )}
    </article>
  );
}
