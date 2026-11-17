import { FORMAS_PAGAMENTO, NOME_PAGAMENTO, formatarPreco, formatarTelefone } from '../../lib/formatar.js';
import { avaliarTroco, textoEndereco, textoTaxaEntrega, totais } from '../../lib/lancamento.js';

/** Passo 3: forma, troco, taxa do bairro, total e Confirmar. */
export function PassoPagamento({ cliente, endereco, linhas, freteGratis = null, forma, aoMudarForma, troco, aoMudarTroco, enviando, erro, aoConfirmar }) {
  const t = totais(linhas, endereco.bairro.taxaCentavos, freteGratis);
  const avaliacao = avaliarTroco(forma, troco, t.totalCentavos);
  const pode = Boolean(forma) && !avaliacao.erro && !enviando;

  return (
    <form
      className="passo-pagamento"
      onSubmit={(e) => {
        e.preventDefault();
        if (pode) aoConfirmar(avaliacao.trocoParaCentavos);
      }}
    >
      <section className="resumo" aria-label="Resumo do pedido">
        <p className="resumo__cliente">
          <strong>{cliente.nome}</strong> · {formatarTelefone(cliente.telefone)}
        </p>
        <p>
          {textoEndereco(endereco)} · <strong>{endereco.bairro.nome}</strong>
        </p>
        <ul className="resumo__itens">
          {linhas.map((l) => (
            <li key={l.chave}>
              <div className="item">
                <span className="item__qtd">{l.quantidade}×</span>
                <span className="item__nome">{l.nome}</span>
                <span className="item__total">{formatarPreco(l.precoCentavos * l.quantidade)}</span>
              </div>
              {l.observacao && <p className="item__obs">{l.observacao}</p>}
            </li>
          ))}
        </ul>
        <dl className="pedido__valores">
          <dt>Subtotal</dt>
          <dd>{formatarPreco(t.subtotalCentavos)}</dd>
          <dt>Entrega ({endereco.bairro.nome})</dt>
          <dd>{textoTaxaEntrega(t.taxaEntregaCentavos, formatarPreco)}</dd>
          <dt className="pedido__total">Total</dt>
          <dd className="pedido__total resumo__total">{formatarPreco(t.totalCentavos)}</dd>
        </dl>
      </section>

      <section className="pagamento" aria-label="Pagamento">
        <fieldset className="formas">
          <legend>Forma de pagamento</legend>
          {FORMAS_PAGAMENTO.map((f) => (
            <label key={f} className={`forma ${forma === f ? 'forma--marcada' : ''}`}>
              <input type="radio" name="forma" value={f} checked={forma === f} onChange={() => aoMudarForma(f)} />
              {NOME_PAGAMENTO[f]}
            </label>
          ))}
        </fieldset>

        {forma === 'DINHEIRO' && (
          <label className="campo">
            <span>Troco para (R$) — vazio se não precisar</span>
            <input className="campo__grande" inputMode="decimal" autoFocus placeholder="Ex.: 100" value={troco}
              onChange={(e) => aoMudarTroco(e.target.value)} aria-invalid={Boolean(avaliacao.erro)} />
            {avaliacao.erro && <span className="erro">{avaliacao.erro}</span>}
            {avaliacao.levarCentavos != null && (
              <span className="pagamento__levar">Levar {formatarPreco(avaliacao.levarCentavos)} de troco</span>
            )}
          </label>
        )}

        {erro && <p className="aviso" role="alert">{erro}</p>}

        <button type="submit" className="botao botao--largo botao--grande" disabled={!pode}>
          {enviando ? 'Lançando…' : `Confirmar pedido · ${formatarPreco(t.totalCentavos)}`}
        </button>
        <p className="texto-suave">O total final é calculado pelo servidor com os preços de agora.</p>
      </section>
    </form>
  );
}
