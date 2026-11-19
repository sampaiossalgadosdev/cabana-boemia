import { useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import {
  FORMAS_PAGAMENTO,
  NOME_CANAL,
  NOME_PAGAMENTO,
  formatarDataHora,
  formatarPreco,
  formatarTelefone,
} from '../../lib/formatar.js';
import { STATUS, STATUS_ANDAMENTO, estaAberto, tituloDoPedido } from '../../lib/painel.js';
import { avaliarAgendamento, dataHoraLocal } from '../../lib/novoPedido.js';
import { diaOperacional } from '../../lib/caixa.js';

/**
 * Opções do pedido (diálogo): andamento (Em aberto / Em preparo / Saiu para
 * entrega), horário da encomenda, finalizar (forma de pagamento), reimprimir
 * e cancelar. Mostra os itens e os valores do pedido.
 */
export function DetalhePedido({ pedido, aoFechar, aoAtualizado }) {
  const dialogo = useRef(null);
  const [acao, setAcao] = useState(null); // null | 'finalizar' | 'cancelar' | 'horario'
  const [forma, setForma] = useState(pedido.formaPagamento ?? '');
  const [horario, setHorario] = useState(() => (pedido.agendadoPara ? dataHoraLocal(pedido.agendadoPara) : { data: '', hora: '' }));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    dialogo.current?.showModal();
  }, []);

  const aberto = estaAberto(pedido);
  const status = STATUS[pedido.status] ?? { rotulo: pedido.status, classe: 'aberto' };

  async function executar(promessa, { fechar = false, mensagem = '' } = {}) {
    setEnviando(true);
    setErro('');
    setAviso('');
    try {
      const r = await chamar(promessa);
      if (r?.pedido) aoAtualizado(r.pedido);
      setAcao(null);
      if (mensagem) setAviso(mensagem);
      if (fechar) dialogo.current?.close();
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  }

  function salvarHorario() {
    const { instante, erro: e } = avaliarAgendamento(horario.data, horario.hora, new Date(), diaOperacional);
    if (e) {
      setErro(e);
      return;
    }
    executar(pdv.pedidos.alterarAgendamento(pedido.id, instante.toISOString()), { mensagem: 'Horário alterado.' });
  }

  function finalizar() {
    if (!forma) {
      setErro('Escolha a forma de pagamento');
      return;
    }
    executar(pdv.pedidos.finalizar(pedido.id, forma), { fechar: true });
  }

  const troco =
    pedido.formaPagamento === 'DINHEIRO' && pedido.trocoParaCentavos && !pedido.pagoEm
      ? pedido.trocoParaCentavos - pedido.totalCentavos
      : null;

  return (
    <dialog ref={dialogo} className="painel detalhe-pedido" onClose={aoFechar} aria-labelledby="titulo-detalhe">
      <div className="painel__corpo">
        <div className="painel__topo">
          <h2 id="titulo-detalhe">{tituloDoPedido(pedido)}</h2>
          <button type="button" className="botao botao--contorno botao--pequeno" onClick={() => dialogo.current?.close()}>
            Fechar <kbd>Esc</kbd>
          </button>
        </div>

        <p className={`status-pedido status-pedido--${status.classe}`}>
          {status.rotulo} · {NOME_CANAL[pedido.canal] ?? pedido.canal}
          {pedido.encomenda && ` · para ${formatarDataHora(pedido.agendadoPara)}`}
        </p>
        <div className="detalhe-pedido__cliente">
          {pedido.telefone && <span>{formatarTelefone(pedido.telefone)}</span>}
          {pedido.retirarNoBalcao ? (
            <strong>Retirar no balcão</strong>
          ) : (
            pedido.enderecoTexto && (
              <span>
                {pedido.enderecoTexto}
                {pedido.bairroNome && ` · ${pedido.bairroNome}`}
              </span>
            )
          )}
        </div>

        <ul className="pedido__itens">
          {pedido.itens.map((i) => (
            <li key={i.id}>
              <div className="item">
                <span className="item__qtd">{i.quantidade}×</span>
                <span className="item__nome">{i.nome}</span>
                <span className="item__total">{formatarPreco(i.totalCentavos)}</span>
              </div>
              {i.observacao && <p className="item__obs">{i.observacao}</p>}
            </li>
          ))}
        </ul>
        {pedido.observacao && <p className="item__obs">Obs. do pedido: {pedido.observacao}</p>}

        <dl className="pedido__valores">
          <dt>Subtotal</dt>
          <dd>{formatarPreco(pedido.subtotalCentavos)}</dd>
          {!pedido.retirarNoBalcao && (
            <>
              <dt>Entrega</dt>
              <dd>{pedido.taxaEntregaCentavos === 0 ? 'Grátis' : formatarPreco(pedido.taxaEntregaCentavos)}</dd>
            </>
          )}
          {pedido.descontoCentavos > 0 && (
            <>
              <dt>Desconto</dt>
              <dd>− {formatarPreco(pedido.descontoCentavos)}</dd>
            </>
          )}
          <dt className="pedido__total">Total</dt>
          <dd className="pedido__total">{formatarPreco(pedido.totalCentavos)}</dd>
          <dt>Pagamento</dt>
          <dd>
            {NOME_PAGAMENTO[pedido.formaPagamento] ?? '—'}
            {pedido.pagoEm ? ' · já pago' : ' · na entrega'}
            {troco != null && ` · troco p/ ${formatarPreco(pedido.trocoParaCentavos)} (levar ${formatarPreco(troco)})`}
          </dd>
        </dl>

        {aberto && (
          <fieldset className="painel__grupo">
            <legend>Alterar status</legend>
            <div className="segmentado" role="group" aria-label="Status do pedido">
              {STATUS_ANDAMENTO.map((s) => {
                const ativo = STATUS[pedido.status]?.classe === STATUS[s].classe;
                return (
                  <button key={s} type="button" disabled={enviando || ativo} aria-pressed={ativo}
                    className={`segmentado__opcao ${ativo ? 'segmentado__opcao--ativa' : ''}`}
                    onClick={() => executar(pdv.pedidos.alterarStatus(pedido.id, s))}>
                    {STATUS[s].rotulo}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {acao === 'horario' && (
          <div className="detalhe-pedido__acao">
            <div className="painel__linha">
              <label className="campo">
                <span>Data</span>
                <input type="date" value={horario.data} onChange={(e) => setHorario({ ...horario, data: e.target.value })} />
              </label>
              <label className="campo">
                <span>Horário</span>
                <input type="time" value={horario.hora} onChange={(e) => setHorario({ ...horario, hora: e.target.value })} />
              </label>
            </div>
            <div className="finalizar__acoes">
              <button type="button" className="botao botao--contorno" onClick={() => setAcao(null)} disabled={enviando}>Voltar</button>
              <button type="button" className="botao" onClick={salvarHorario} disabled={enviando}>Salvar horário</button>
            </div>
          </div>
        )}

        {acao === 'finalizar' && (
          <div className="detalhe-pedido__acao">
            {pedido.pagoEm ? (
              <p className="texto-suave">Já pago em {NOME_PAGAMENTO[pedido.formaPagamento]}. Finalizar marca como entregue.</p>
            ) : (
              <fieldset className="finalizar__formas" disabled={enviando}>
                <legend>Forma de pagamento</legend>
                {FORMAS_PAGAMENTO.map((f) => (
                  <label key={f} className={`opcao ${forma === f ? 'opcao--marcada' : ''}`}>
                    <input type="radio" name="forma-detalhe" value={f} checked={forma === f} onChange={() => setForma(f)} />
                    {NOME_PAGAMENTO[f]}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="finalizar__acoes">
              <button type="button" className="botao botao--contorno" onClick={() => setAcao(null)} disabled={enviando}>Voltar</button>
              <button type="button" className="botao" onClick={finalizar} disabled={enviando}>
                {enviando ? 'Finalizando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}

        {acao === 'cancelar' && (
          <div className="detalhe-pedido__acao cancelar">
            <p className="cancelar__pergunta">
              Cancelar o pedido #{pedido.numeroDia}? O estoque volta e sai um cupom de cancelamento.
              {pedido.pagoEm && ' Ele já foi pago: devolva o valor ao cliente.'}
            </p>
            <div className="finalizar__acoes">
              <button type="button" className="botao botao--contorno" onClick={() => setAcao(null)} disabled={enviando} autoFocus>Não</button>
              <button type="button" className="botao botao--perigo" disabled={enviando}
                onClick={() => executar(pdv.pedidos.cancelar(pedido.id), { fechar: true })}>
                {enviando ? 'Cancelando…' : 'Sim, cancelar'}
              </button>
            </div>
          </div>
        )}

        {erro && <p className="erro" role="alert">{erro}</p>}
        {aviso && <p className="pedido__reimpressao" role="status">{aviso}</p>}

        {!acao && (
          <div className="detalhe-pedido__botoes">
            <button type="button" className="botao botao--contorno" disabled={enviando}
              onClick={() => executar(pdv.pedidos.reimprimir(pedido.id), { mensagem: 'Enviado para a impressora.' })}>
              Imprimir
            </button>
            {aberto && pedido.encomenda && (
              <button type="button" className="botao botao--contorno" onClick={() => setAcao('horario')}>Alterar horário</button>
            )}
            {aberto && (
              <button type="button" className="botao botao--contorno" onClick={() => setAcao('cancelar')}>Cancelar pedido</button>
            )}
            {aberto && (
              <button type="button" className="botao" onClick={() => setAcao('finalizar')}>Finalizar</button>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
