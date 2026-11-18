import { useEffect, useRef } from 'react';
import { FORMAS_PAGAMENTO, NOME_PAGAMENTO, formatarPreco } from '../../lib/formatar.js';
import { avaliarTroco } from '../../lib/lancamento.js';

const NOME_FORMA = { ...NOME_PAGAMENTO, DEBITO: 'Cartão de débito', CREDITO: 'Cartão de crédito' };

/**
 * Pagamento (abre no "Lançar"): resumo do total, uma forma de pagamento,
 * troco em dinheiro e "Pago agora" / "Pagar na entrega". "Finalizar pedido"
 * cria o pedido na API (que imprime a comanda se a impressora estiver ligada).
 */
export function ModalPagamento({ totais: t, retirarNoBalcao, forma, aoMudarForma, troco, aoMudarTroco, pagoAgora, aoMudarPagoAgora, enviando, erro, aoFinalizar, aoFechar }) {
  const dialogo = useRef(null);
  useEffect(() => {
    dialogo.current?.showModal();
  }, []);

  // Pago agora em dinheiro: o troco sai na hora, no balcão (não vai no cupom).
  const avaliacao = avaliarTroco(pagoAgora ? null : forma, troco, t.totalCentavos);
  const pode = Boolean(forma) && !avaliacao.erro && !enviando;

  return (
    <dialog ref={dialogo} className="painel modal-pagamento" onClose={aoFechar} aria-labelledby="titulo-pagamento"
      onCancel={(e) => {
        if (enviando) e.preventDefault();
      }}>
      <form className="painel__corpo" onSubmit={(e) => {
        e.preventDefault();
        if (pode) aoFinalizar(avaliacao.trocoParaCentavos);
      }}>
        <div className="painel__topo">
          <h2 id="titulo-pagamento">Pagamento</h2>
          <button type="button" className="botao botao--contorno botao--pequeno" disabled={enviando} onClick={() => dialogo.current?.close()}>
            Voltar <kbd>Esc</kbd>
          </button>
        </div>

        <dl className="pedido__valores">
          <dt>Itens</dt>
          <dd>{formatarPreco(t.subtotalCentavos)}</dd>
          <dt>Entrega</dt>
          <dd>{retirarNoBalcao ? 'Retirada no balcão' : t.taxaEntregaCentavos === 0 ? 'Grátis' : formatarPreco(t.taxaEntregaCentavos)}</dd>
          {t.descontoCentavos > 0 && (
            <>
              <dt>Desconto</dt>
              <dd>− {formatarPreco(t.descontoCentavos)}</dd>
            </>
          )}
          <dt className="pedido__total">Total</dt>
          <dd className="pedido__total modal-pagamento__total">{formatarPreco(t.totalCentavos)}</dd>
        </dl>

        <div className="segmentado modal-pagamento__quando" role="radiogroup" aria-label="Quando paga">
          {[
            [false, 'Pagar na entrega'],
            [true, 'Pago agora'],
          ].map(([valor, rotulo]) => (
            <button key={rotulo} type="button" role="radio" aria-checked={pagoAgora === valor}
              className={`segmentado__opcao ${pagoAgora === valor ? 'segmentado__opcao--ativa' : ''}`}
              onClick={() => aoMudarPagoAgora(valor)}>
              {rotulo}
            </button>
          ))}
        </div>

        <fieldset className="formas">
          <legend>Forma de pagamento</legend>
          {FORMAS_PAGAMENTO.map((f) => (
            <label key={f} className={`forma ${forma === f ? 'forma--marcada' : ''}`}>
              <input type="radio" name="forma-novo-pedido" value={f} checked={forma === f} onChange={() => aoMudarForma(f)} />
              {NOME_FORMA[f]}
            </label>
          ))}
        </fieldset>

        {forma === 'DINHEIRO' && !pagoAgora && (
          <label className="campo">
            <span>Troco para (R$) — vazio se não precisar</span>
            <input className="campo__grande" inputMode="decimal" placeholder="Ex.: 100" value={troco}
              onChange={(e) => aoMudarTroco(e.target.value)} aria-invalid={Boolean(avaliacao.erro)} />
            {avaliacao.erro && <span className="erro">{avaliacao.erro}</span>}
            {avaliacao.levarCentavos != null && (
              <span className="pagamento__levar">Levar {formatarPreco(avaliacao.levarCentavos)} de troco</span>
            )}
          </label>
        )}
        {pagoAgora && <p className="texto-suave">O valor entra no caixa agora. O pedido continua no painel até ser entregue.</p>}

        {erro && <p className="aviso" role="alert">{erro}</p>}

        <button type="submit" className="botao botao--largo botao--grande" disabled={!pode}>
          {enviando ? 'Lançando…' : `Finalizar pedido · ${formatarPreco(t.totalCentavos)}`}
        </button>
        <p className="texto-suave">O total final é calculado pelo servidor com os preços de agora.</p>
      </form>
    </dialog>
  );
}
