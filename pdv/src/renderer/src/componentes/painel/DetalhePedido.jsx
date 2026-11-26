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
import {
  STATUS,
  STATUS_ANDAMENTO,
  estaAberto,
  faixaPagoOnline,
  formatarChaveNfce,
  lojaPodeCancelar,
  pagoOnline,
  precisaAceite,
  problemaNaChaveNfce,
  recebeDinheiro,
  rotuloFinalizar,
  seloEstorno,
  tituloDoPedido,
} from '../../lib/painel.js';
import { avaliarAgendamento, dataHoraLocal } from '../../lib/novoPedido.js';
import { diaOperacional } from '../../lib/caixa.js';
import { textoDistancia } from '@restaurante/shared/cupom';

/**
 * Opções do pedido (diálogo): andamento (Em aberto / Em preparo / Saiu para
 * entrega), horário da encomenda, finalizar (forma de pagamento), reimprimir
 * e cancelar; registrar a chave da NFC-e emitida. Mostra os itens e os valores do pedido.
 * Pago online (Etapa 5): faixa "não cobrar na entrega", Aceitar/Recusar antes do aceite
 * (recusar estorna o cliente), sem cancelar depois do aceite e finalizar sem forma nem caixa.
 * Dinheiro com os entregadores do Taaki: o Finalizar vira "Recebi o dinheiro".
 */
export function DetalhePedido({ pedido, aoFechar, aoAtualizado }) {
  const dialogo = useRef(null);
  const [acao, setAcao] = useState(null); // null | 'finalizar' | 'cancelar' | 'horario' | 'nfce'
  const [chave, setChave] = useState(() => formatarChaveNfce(pedido.chaveNfce ?? ''));
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
  const online = pagoOnline(pedido);
  const aceite = precisaAceite(pedido);
  const dinheiro = recebeDinheiro(pedido);
  const faixa = faixaPagoOnline(pedido);
  const estorno = seloEstorno(pedido);
  const podeCancelar = lojaPodeCancelar(pedido);

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
    if (online) {
      executar(pdv.pedidos.finalizarOnline(pedido.id), { fechar: true });
      return;
    }
    if (dinheiro) {
      executar(pdv.pedidos.finalizar(pedido.id, 'DINHEIRO'), { fechar: true });
      return;
    }
    if (!forma) {
      setErro('Escolha a forma de pagamento');
      return;
    }
    executar(pdv.pedidos.finalizar(pedido.id, forma), { fechar: true });
  }

  function salvarNfce(apagar = false) {
    const problema = apagar ? null : problemaNaChaveNfce(chave);
    if (problema) {
      setErro(problema);
      return;
    }
    executar(pdv.pedidos.nfce(pedido.id, apagar ? null : chave), { mensagem: apagar ? 'Chave da NFC-e apagada.' : 'Chave da NFC-e registrada.' });
    if (apagar) setChave('');
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
          {estorno && <span className="selo selo--estorno">{estorno}</span>}
        </p>
        {faixa && <p className="faixa-online" role="note">{faixa}</p>}
        {aceite && <p className="aviso-aceite">Aguardando o aceite da loja. Depois de aceito, só o Taaki cancela.</p>}
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
          {!pedido.retirarNoBalcao && pedido.enderecoTexto && (
            <span className="detalhe-pedido__mapa">
              {textoDistancia(pedido) ? <span>Distância: {textoDistancia(pedido)}</span> : null}
              {pedido.linkMapa ? (
                <button
                  type="button"
                  className="botao botao--contorno botao--pequeno"
                  disabled={enviando}
                  onClick={() => chamar(pdv.mapa.abrir(pedido.linkMapa)).catch((err) => setErro(err.message))}
                >
                  Abrir no mapa
                </button>
              ) : (
                <span className="detalhe-pedido__sem-pino">Sem pino no mapa</span>
              )}
            </span>
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
            {online ? ' · pago online' : pedido.pagoEm ? ' · já pago' : ' · na entrega'}
            {online && pedido.pagamentoOnline.valorEstornadoCentavos > 0 && ` · estornado ${formatarPreco(pedido.pagamentoOnline.valorEstornadoCentavos)}`}
            {troco != null && ` · troco p/ ${formatarPreco(pedido.trocoParaCentavos)} (levar ${formatarPreco(troco)})`}
          </dd>
          {pedido.chaveNfce && (
            <>
              <dt>NFC-e</dt>
              <dd className="detalhe-pedido__nfce">{formatarChaveNfce(pedido.chaveNfce)}</dd>
            </>
          )}
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
            {online ? (
              <p className="texto-suave">Pago online pelo app. Finalizar marca como entregue (não cobrar nada na entrega).</p>
            ) : dinheiro ? (
              <p className="texto-suave">Confirme que recebeu {formatarPreco(pedido.totalCentavos)} em dinheiro do entregador.</p>
            ) : pedido.pagoEm ? (
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

        {acao === 'nfce' && (
          <div className="detalhe-pedido__acao">
            <label className="campo">
              <span>Chave da NFC-e (44 números)</span>
              <input
                className="detalhe-pedido__nfce"
                inputMode="numeric"
                autoFocus
                value={chave}
                placeholder="Digite ou leia o código de barras da nota"
                onChange={(e) => setChave(formatarChaveNfce(e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && salvarNfce()}
              />
            </label>
            <div className="finalizar__acoes">
              <button type="button" className="botao botao--contorno" onClick={() => setAcao(null)} disabled={enviando}>Voltar</button>
              {pedido.chaveNfce && (
                <button type="button" className="botao botao--contorno" onClick={() => salvarNfce(true)} disabled={enviando}>Apagar chave</button>
              )}
              <button type="button" className="botao" onClick={() => salvarNfce()} disabled={enviando}>
                {enviando ? 'Salvando…' : 'Salvar chave'}
              </button>
            </div>
          </div>
        )}

        {acao === 'cancelar' && (
          <div className="detalhe-pedido__acao cancelar">
            <p className="cancelar__pergunta">
              {online
                ? `Recusar o pedido #${pedido.numeroDia}? O valor volta ao cliente pelo Mercado Pago, o estoque volta e sai um cupom de cancelamento.`
                : `Cancelar o pedido #${pedido.numeroDia}? O estoque volta e sai um cupom de cancelamento.`}
              {!online && pedido.pagoEm && ' Ele já foi pago: devolva o valor ao cliente.'}
            </p>
            <div className="finalizar__acoes">
              <button type="button" className="botao botao--contorno" onClick={() => setAcao(null)} disabled={enviando} autoFocus>Não</button>
              <button type="button" className="botao botao--perigo" disabled={enviando}
                onClick={() => executar(pdv.pedidos.cancelar(pedido.id), { fechar: true })}>
                {enviando ? (online ? 'Recusando…' : 'Cancelando…') : online ? 'Sim, recusar' : 'Sim, cancelar'}
              </button>
            </div>
          </div>
        )}

        {aberto && !podeCancelar && !acao && <p className="texto-suave">Para cancelar, fale com o Taaki.</p>}
        {erro && <p className="erro" role="alert">{erro}</p>}
        {aviso && <p className="pedido__reimpressao" role="status">{aviso}</p>}

        {!acao && (
          <div className="detalhe-pedido__botoes">
            <button type="button" className="botao botao--contorno" disabled={enviando}
              onClick={() => executar(pdv.pedidos.reimprimir(pedido.id), { mensagem: 'Enviado para a impressora.' })}>
              Imprimir
            </button>
            {pedido.status !== 'CANCELADO' && (
              <button type="button" className="botao botao--contorno" onClick={() => { setErro(''); setAcao('nfce'); }}>
                {pedido.chaveNfce ? 'NFC-e registrada' : 'Registrar NFC-e'}
              </button>
            )}
            {aberto && pedido.encomenda && (
              <button type="button" className="botao botao--contorno" onClick={() => setAcao('horario')}>Alterar horário</button>
            )}
            {aceite && (
              <button type="button" className="botao botao--contorno" onClick={() => setAcao('cancelar')}>
                Recusar (o cliente recebe o valor de volta)
              </button>
            )}
            {aberto && !aceite && podeCancelar && (
              <button type="button" className="botao botao--contorno" onClick={() => setAcao('cancelar')}>Cancelar pedido</button>
            )}
            {aberto && aceite && (
              <button type="button" className="botao" disabled={enviando}
                onClick={() => executar(pdv.pedidos.aceitar(pedido.id), { mensagem: 'Pedido aceito.' })}>
                Aceitar
              </button>
            )}
            {aberto && !aceite && (
              <button type="button" className="botao" onClick={() => setAcao('finalizar')}>{rotuloFinalizar(pedido)}</button>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
