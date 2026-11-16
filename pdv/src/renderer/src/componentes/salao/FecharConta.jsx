import { useEffect, useRef, useState } from 'react';
import { FORMAS_PAGAMENTO, NOME_PAGAMENTO, formatarPreco } from '../../lib/formatar.js';

/**
 * Fechar conta: forma de pagamento obrigatória; "Imprimir conta" só se a
 * atendente marcar (desmarcado por padrão).
 */
export function FecharConta({ comanda, aoConfirmar, aoFechar }) {
  const dialogo = useRef(null);
  const [forma, setForma] = useState('');
  const [imprimir, setImprimir] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    dialogo.current?.showModal();
  }, []);

  async function confirmar() {
    if (!forma) {
      setErro('Escolha a forma de pagamento');
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      await aoConfirmar({ formaPagamento: forma, imprimirConta: imprimir });
      dialogo.current?.close();
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <dialog ref={dialogo} className="painel" onClose={aoFechar} aria-labelledby="titulo-fechar">
      <div className="painel__corpo">
        <div className="painel__topo">
          <h2 id="titulo-fechar">Fechar conta · {comanda.nomeCliente}</h2>
          <strong className="fechar-conta__total">{formatarPreco(comanda.totalCentavos)}</strong>
        </div>

        <fieldset className="finalizar__formas" disabled={enviando}>
          <legend>Forma de pagamento</legend>
          {FORMAS_PAGAMENTO.map((f) => (
            <label key={f} className={`opcao ${forma === f ? 'opcao--marcada' : ''}`}>
              <input type="radio" name="forma-comanda" value={f} checked={forma === f}
                onChange={() => {
                  setForma(f);
                  setErro('');
                }} />
              {NOME_PAGAMENTO[f]}
            </label>
          ))}
        </fieldset>

        <label className="opcao opcao--caixa">
          <input type="checkbox" checked={imprimir} disabled={enviando} onChange={(e) => setImprimir(e.target.checked)} />
          Imprimir conta
        </label>

        {erro && <p className="erro" role="alert">{erro}</p>}

        <div className="painel__acoes">
          <button type="button" className="botao botao--contorno" disabled={enviando} onClick={() => dialogo.current?.close()}>
            Voltar
          </button>
          <button type="button" className="botao botao--grande" disabled={enviando} onClick={confirmar}>
            {enviando ? 'Fechando…' : 'Confirmar pagamento'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
