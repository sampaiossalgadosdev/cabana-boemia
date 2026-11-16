import { useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import { FORMAS_PAGAMENTO, NOME_PAGAMENTO, formatarPreco } from '../../lib/formatar.js';
import { acoesDoPendente, descreverPendente } from '../../lib/caixa.js';

/**
 * Lista do 409 PEDIDOS_ABERTOS com atalho para finalizar (ou fechar a conta
 * da comanda) e cancelar cada pedido ali mesmo. Cada resolvido sai da lista.
 */
export function PendentesFechamento({ pedidos, aoResolver }) {
  return (
    <div className="pendentes" role="group" aria-label="Pedidos abertos">
      <p className="aviso">
        {pedidos.length === 1 ? 'Há 1 pedido aberto.' : `Há ${pedidos.length} pedidos abertos.`} Finalize ou cancele para
        fechar o caixa.
      </p>
      <ul className="pendentes__lista">
        {pedidos.map((p) => (
          <ItemPendente key={p.id} pedido={p} aoResolver={aoResolver} />
        ))}
      </ul>
    </div>
  );
}

function ItemPendente({ pedido, aoResolver }) {
  const acoes = acoesDoPendente(pedido);
  const [acao, setAcao] = useState(null); // null | 'finalizar' | 'cancelar'
  const [forma, setForma] = useState(pedido.formaPagamento ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function executar(fn) {
    setEnviando(true);
    setErro('');
    try {
      await fn();
      aoResolver(pedido.id);
    } catch (err) {
      // Já resolvido em outro lugar: sai da lista do mesmo jeito.
      if (err.codigo === 'PEDIDO_ENCERRADO' || err.status === 404) aoResolver(pedido.id);
      else {
        setErro(err.message);
        setEnviando(false);
      }
    }
  }

  const finalizar = () => {
    if (!forma) {
      setErro('Escolha a forma de pagamento');
      return;
    }
    executar(() =>
      pedido.canal === 'SALAO'
        ? chamar(pdv.comandas.fechar(pedido.id, { formaPagamento: forma, imprimirConta: false }))
        : chamar(pdv.pedidos.finalizar(pedido.id, forma)),
    );
  };

  return (
    <li className="pendente">
      <div className="pendente__topo">
        <span className="pendente__nome">{descreverPendente(pedido)}</span>
        <strong>{formatarPreco(pedido.totalCentavos)}</strong>
      </div>

      {acao === 'finalizar' ? (
        <>
          <fieldset className="finalizar__formas" disabled={enviando}>
            <legend>Forma de pagamento</legend>
            {FORMAS_PAGAMENTO.map((f) => (
              <label key={f} className={`opcao ${forma === f ? 'opcao--marcada' : ''}`}>
                <input type="radio" name={`forma-pendente-${pedido.id}`} value={f} checked={forma === f}
                  onChange={() => setForma(f)} />
                {NOME_PAGAMENTO[f]}
              </label>
            ))}
          </fieldset>
          <div className="finalizar__acoes">
            <button type="button" className="botao botao--contorno" disabled={enviando} onClick={() => setAcao(null)}>Voltar</button>
            <button type="button" className="botao" disabled={enviando} onClick={finalizar}>
              {enviando ? 'Enviando…' : 'Confirmar'}
            </button>
          </div>
        </>
      ) : acao === 'cancelar' ? (
        <>
          <p className="cancelar__pergunta">{acoes.rotuloCancelar} {descreverPendente(pedido)}? {acoes.avisoCancelar}</p>
          <div className="finalizar__acoes">
            <button type="button" className="botao botao--contorno" disabled={enviando} onClick={() => setAcao(null)} autoFocus>Não</button>
            <button type="button" className="botao botao--perigo" disabled={enviando}
              onClick={() => executar(() => chamar(pdv.pedidos.cancelar(pedido.id)))}>
              {enviando ? 'Enviando…' : `Sim, ${acoes.rotuloCancelar.toLowerCase()}`}
            </button>
          </div>
        </>
      ) : (
        <div className="pendente__acoes">
          <button type="button" className="botao botao--contorno botao--pequeno" onClick={() => setAcao('cancelar')}>
            {acoes.rotuloCancelar}
          </button>
          {acoes.finalizar && (
            <button type="button" className="botao botao--pequeno" onClick={() => setAcao('finalizar')}>
              {acoes.rotuloFinalizar}
            </button>
          )}
        </div>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </li>
  );
}
