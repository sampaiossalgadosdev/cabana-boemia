import { useEffect, useState } from 'react';
import { obterConfig } from '../lib/config.js';
import { formatarPreco } from '../lib/dinheiro.js';
import { linkCancelamento, rotuloPagamento } from '../pedido/pedido.js';

/** Tela de sucesso: número do pedido, tempo estimado e cancelamento pelo WhatsApp. */
export function PedidoEnviado({ pedido, onFechar }) {
  const [whatsapp, setWhatsapp] = useState(null);

  useEffect(() => {
    let vivo = true;
    obterConfig()
      .then((c) => vivo && setWhatsapp(c.whatsapp ?? ''))
      .catch(() => vivo && setWhatsapp(''));
    return () => {
      vivo = false;
    };
  }, []);

  const link = whatsapp ? linkCancelamento(whatsapp, pedido.numeroDia, pedido.nomeCliente) : null;

  return (
    <section className="sucesso" aria-labelledby="titulo-sucesso">
      <div className="sucesso__selo" aria-hidden="true">
        ✓
      </div>
      <h3 id="titulo-sucesso" className="sucesso__titulo">
        Pedido nº {pedido.numeroDia} recebido!
      </h3>
      {pedido.tempoEstimadoMin != null && (
        <p className="sucesso__tempo">
          Previsão de entrega: <strong>cerca de {pedido.tempoEstimadoMin} min</strong>
        </p>
      )}

      <ul className="sucesso__itens">
        {pedido.itens.map((i) => (
          <li key={i.id}>
            <span>
              {i.quantidade}× {i.nome}
              {i.observacao && <span className="observacao">{i.observacao}</span>}
            </span>
            <span>{formatarPreco(i.totalCentavos)}</span>
          </li>
        ))}
        <li>
          <span>Entrega ({pedido.bairroNome})</span>
          <span>{formatarPreco(pedido.taxaEntregaCentavos)}</span>
        </li>
        <li className="sucesso__total">
          <span>Total</span>
          <span>{formatarPreco(pedido.totalCentavos)}</span>
        </li>
      </ul>
      <p className="nota nota--esquerda">
        {rotuloPagamento(pedido.formaPagamento)} na entrega
        {pedido.trocoParaCentavos ? ` · troco para ${formatarPreco(pedido.trocoParaCentavos)}` : ''}
        <br />
        {pedido.enderecoTexto}
      </p>

      <button type="button" className="botao botao--primario botao--bloco checkout-passo__acao" onClick={onFechar}>
        Voltar ao cardápio
      </button>
      {link ? (
        <a className="botao botao--texto botao--bloco" href={link} target="_blank" rel="noopener noreferrer">
          Deseja cancelar seu pedido?
        </a>
      ) : (
        whatsapp === '' && <p className="nota">Para cancelar, fale com o restaurante.</p>
      )}
    </section>
  );
}
