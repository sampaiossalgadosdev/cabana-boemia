import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatarReais } from '../lib/dinheiro.js';
import { Campo, CampoDinheiro, Dialogo, EstadoCarga, useAvisar, useCarregar } from '../componentes/comuns.jsx';
import { DialogoFechamento, EtiquetaStatus, TabelaLancamentos } from './TelaFechamento.jsx';
import {
  nomeDaSemana,
  pegarAjustePedido,
  progressoCampanha,
  textoDoSaldoAdmin,
  valorComSinal,
  valorDoAjuste,
} from '../lib/financeiro.js';

const hojeEmBrasilia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/**
 * Plataforma (só ADMIN), Etapa 6 do pagamento online: fechamentos semanais das lojas (o que cada
 * loja deve ao Taaki ou o Taaki deve à loja), semana atual de cada loja, quitar, ajuste manual
 * (observação obrigatória) e o resumo da campanha de frete grátis contra o orçamento.
 */
export function TelaFinanceiro() {
  const [status, setStatus] = useState('AGUARDANDO_PAGAMENTO');
  const [lojaId, setLojaId] = useState('');
  const carga = useCarregar(() => api.plataforma.financeiro.listar({ status: status || undefined, lojaId: lojaId || undefined }), [status, lojaId]);
  const campanha = useCarregar(() => api.plataforma.financeiro.campanha());
  const lojas = useCarregar(() => api.plataforma.lojas.listar());
  const [detalhe, setDetalhe] = useState(null); // id do fechamento
  const [semana, setSemana] = useState(null); // loja da semana atual
  const [quitar, setQuitar] = useState(null); // fechamento
  const [ajuste, setAjuste] = useState(null); // { lojaId?, pedidoId? }
  const avisar = useAvisar();

  // Atalho vindo de "Pagamentos online" (estorno de pedido finalizado com entrega pelo Taaki).
  useEffect(() => {
    const pedido = pegarAjustePedido();
    if (pedido) setAjuste(pedido);
  }, []);

  async function recarregarTudo() {
    await Promise.all([carga.recarregar(), campanha.recarregar()]);
  }

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Financeiro</h1>
          <p className="pagina__sub">
            Acerto semanal com as lojas (segunda a domingo). Positivo = a loja deve ao Taaki; negativo = o Taaki deve à loja.
          </p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setAjuste({})}>
          Ajuste manual
        </button>
      </div>

      <EstadoCarga carga={campanha}>{({ campanha: c }) => <CartaoCampanha campanha={c} />}</EstadoCarga>

      <EstadoCarga carga={carga}>
        {({ fechamentos, semanaAtual }) => (
          <>
            <section className="cartao tabela-rolagem" style={{ marginTop: 16 }}>
              <div className="cartao__topo">
                <h2 className="cartao__titulo">Semana atual (ainda não fechada)</h2>
              </div>
              {semanaAtual.length === 0 ? (
                <p className="estado">Nenhuma loja com lançamento nesta semana.</p>
              ) : (
                <table className="tabela tabela--empilhada">
                  <thead>
                    <tr>
                      <th>Loja</th>
                      <th>Semana</th>
                      <th>Saldo parcial</th>
                      <th className="fim">
                        <span className="visualmente-oculto">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanaAtual.map((s) => (
                      <tr key={s.loja.id}>
                        <td>{s.loja.nome}</td>
                        <td>{nomeDaSemana(s.inicio, s.domingo)}</td>
                        <td style={{ whiteSpace: 'normal' }}>
                          {textoDoSaldoAdmin(s.saldoCentavos, s.loja.nome)}
                          <br />
                          <span className="suave">{s.quantidade} lançamento(s)</span>
                        </td>
                        <td className="fim">
                          <button type="button" className="botao botao--pequeno" onClick={() => setSemana(s.loja)}>
                            Ver lançamentos
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="cartao" style={{ marginTop: 16 }}>
              <div className="cartao__topo">
                <h2 className="cartao__titulo">Fechamentos</h2>
              </div>
              <div className="grade-form cartao__corpo">
                <Campo rotulo="Situação">
                  {(id) => (
                    <select id={id} className="entrada" value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="AGUARDANDO_PAGAMENTO">Aguardando pagamento</option>
                      <option value="QUITADO">Quitados</option>
                      <option value="">Todos</option>
                    </select>
                  )}
                </Campo>
                <Campo rotulo="Loja">
                  {(id) => (
                    <select id={id} className="entrada" value={lojaId} onChange={(e) => setLojaId(e.target.value)}>
                      <option value="">Todas</option>
                      {(lojas.dados?.lojas ?? []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nome}
                        </option>
                      ))}
                    </select>
                  )}
                </Campo>
              </div>
              {fechamentos.length === 0 ? (
                <p className="estado">Nenhum fechamento {status === 'AGUARDANDO_PAGAMENTO' ? 'aguardando pagamento' : 'encontrado'}.</p>
              ) : (
                <div className="tabela-rolagem">
                  <table className="tabela tabela--empilhada">
                    <thead>
                      <tr>
                        <th>Semana</th>
                        <th>Loja</th>
                        <th>Saldo</th>
                        <th>Situação</th>
                        <th className="fim">
                          <span className="visualmente-oculto">Ações</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {fechamentos.map((f) => (
                        <tr key={f.id}>
                          <td>{nomeDaSemana(f.inicio, f.domingo)}</td>
                          <td>{f.loja.nome}</td>
                          <td style={{ whiteSpace: 'normal' }}>{textoDoSaldoAdmin(f.saldoCentavos, f.loja.nome)}</td>
                          <td>
                            <EtiquetaStatus fechamento={f} />
                          </td>
                          <td className="fim">
                            <div className="acoes">
                              <button type="button" className="botao botao--pequeno" onClick={() => setDetalhe(f.id)}>
                                Detalhe
                              </button>
                              {f.status === 'AGUARDANDO_PAGAMENTO' && (
                                <button type="button" className="botao botao--pequeno botao--primario" onClick={() => setQuitar(f)}>
                                  Marcar como quitado
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </EstadoCarga>

      <DialogoFechamento
        id={detalhe}
        buscar={api.plataforma.financeiro.detalhe}
        saldo={(v, nome) => textoDoSaldoAdmin(v, nome)}
        valor={valorComSinal}
        aoFechar={() => setDetalhe(null)}
      />
      <DialogoSemanaAtual loja={semana} aoFechar={() => setSemana(null)} />
      <DialogoQuitar
        fechamento={quitar}
        aoFechar={() => setQuitar(null)}
        aoFeito={async () => {
          setQuitar(null);
          avisar('Fechamento marcado como quitado.');
          await recarregarTudo();
        }}
      />
      <DialogoAjuste
        inicial={ajuste}
        lojas={lojas.dados?.lojas ?? []}
        aoFechar={() => setAjuste(null)}
        aoFeito={async () => {
          setAjuste(null);
          avisar('Ajuste lançado na semana atual da loja.');
          await recarregarTudo();
        }}
      />
    </>
  );
}

function CartaoCampanha({ campanha: c }) {
  const p = progressoCampanha(c);
  return (
    <section className="cartao">
      <div className="cartao__topo">
        <h2 className="cartao__titulo">Campanha: frete grátis na primeira compra</h2>
      </div>
      <div className="cartao__corpo">
        <p className="saldo-fechamento">{p.texto}</p>
        <div className="barra-campanha" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.porcentagem} aria-label="Orçamento da campanha usado">
          <span className={`barra-campanha__marca${p.estourou ? ' barra-campanha__marca--estourou' : ''}`} style={{ width: `${p.porcentagem}%` }} />
        </div>
        <p className="suave">
          {c.usos} uso(s): {c.usosEntregaTaaki} com entregador do Taaki ({formatarReais(c.taxasEntregaTaakiCentavos)} em taxas que o cliente não pagou) e{' '}
          {c.usosEntregaLoja} com motoboy da loja ({formatarReais(c.creditosLojaCentavos)} em créditos para as lojas).
          {p.estourou ? ' O orçamento foi passado.' : ` Restam ${formatarReais(c.restanteCentavos)}.`}
        </p>
      </div>
    </section>
  );
}

function DialogoSemanaAtual({ loja, aoFechar }) {
  const carga = useCarregar(() => (loja ? api.plataforma.financeiro.semanaAtual(loja.id) : Promise.resolve(null)), [loja?.id]);
  const s = carga.dados?.loja?.id === loja?.id ? carga.dados?.semanaAtual : null;
  return (
    <Dialogo
      aberto={Boolean(loja)}
      largo
      titulo={loja ? `Semana atual · ${loja.nome}` : 'Semana atual'}
      aoFechar={aoFechar}
      rodape={
        <button type="button" className="botao" onClick={aoFechar}>
          Fechar
        </button>
      }
    >
      {carga.erro && <p className="erro">{carga.erro.message}</p>}
      {!s && !carga.erro && <p className="estado">Carregando…</p>}
      {s && (
        <>
          <p className="saldo-fechamento">
            {nomeDaSemana(s.inicio, s.domingo)}: {textoDoSaldoAdmin(s.saldoCentavos, loja.nome)}
          </p>
          <TabelaLancamentos lancamentos={s.lancamentos} valor={valorComSinal} />
        </>
      )}
    </Dialogo>
  );
}

function DialogoQuitar({ fechamento: f, aoFechar, aoFeito }) {
  const [data, setData] = useState(hojeEmBrasilia);
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setData(hojeEmBrasilia());
    setObservacao('');
    setErro('');
  }, [f?.id]);

  async function enviar() {
    if (!data) return setErro('Informe a data do pagamento.');
    setEnviando(true);
    setErro('');
    try {
      await api.plataforma.financeiro.quitar(f.id, { quitadoEm: data, observacao: observacao.trim() || null });
      await aoFeito();
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(f)}
      titulo="Marcar como quitado"
      aoFechar={aoFechar}
      aoEnviar={enviar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar} disabled={enviando}>
            Voltar
          </button>
          <button type="submit" className="botao botao--primario" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Marcar como quitado'}
          </button>
        </>
      }
    >
      {f && (
        <>
          <p style={{ marginTop: 0 }}>
            Semana de {nomeDaSemana(f.inicio, f.domingo)}: {textoDoSaldoAdmin(f.saldoCentavos, f.loja.nome)}. Depois de quitado, o fechamento não muda
            mais.
          </p>
          <Campo rotulo="Data do pagamento">
            {(id) => <input id={id} type="date" className="entrada entrada--curta" max={hojeEmBrasilia()} value={data} onChange={(e) => setData(e.target.value)} />}
          </Campo>
          <Campo rotulo="Observação (opcional)">
            {(id) => (
              <input id={id} className="entrada" maxLength={300} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: Pix recebido da loja" />
            )}
          </Campo>
          {erro && (
            <p className="erro" role="alert">
              {erro}
            </p>
          )}
        </>
      )}
    </Dialogo>
  );
}

function DialogoAjuste({ inicial, lojas, aoFechar, aoFeito }) {
  const [lojaId, setLojaId] = useState('');
  const [direcao, setDirecao] = useState('LOJA_DEVE');
  const [valor, setValor] = useState(null);
  const [pedido, setPedido] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!inicial) return;
    setLojaId(inicial.lojaId ? String(inicial.lojaId) : '');
    setDirecao(inicial.direcao ?? 'LOJA_DEVE');
    setValor(null);
    setPedido(inicial.pedidoId ? String(inicial.pedidoId) : '');
    setObservacao(inicial.observacao ?? '');
    setErro('');
  }, [inicial]);

  async function enviar() {
    if (!lojaId) return setErro('Escolha a loja.');
    if (!valor || valor < 1) return setErro('Informe o valor.');
    if (pedido.trim() && !/^\d+$/.test(pedido.trim())) return setErro('O código do pedido é só número.');
    if (observacao.trim().length < 3) return setErro('Escreva o motivo do ajuste.');
    setEnviando(true);
    setErro('');
    try {
      await api.plataforma.financeiro.ajuste({
        lojaId: Number(lojaId),
        valorCentavos: valorDoAjuste(direcao, valor),
        pedidoId: pedido.trim() ? Number(pedido.trim()) : null,
        observacao: observacao.trim(),
      });
      await aoFeito();
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(inicial)}
      titulo="Ajuste manual"
      aoFechar={aoFechar}
      aoEnviar={enviar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar} disabled={enviando}>
            Voltar
          </button>
          <button type="submit" className="botao botao--primario" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Lançar ajuste'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>Entra na semana atual da loja. Semanas já fechadas não mudam.</p>
      {inicial?.lembrete && <div className="alerta">{inicial.lembrete}</div>}
      <div className="grade-form">
        <Campo rotulo="Loja">
          {(id) => (
            <select id={id} className="entrada" value={lojaId} onChange={(e) => setLojaId(e.target.value)}>
              <option value="">Escolha…</option>
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo rotulo="Quem deve">
          {(id) => (
            <select id={id} className="entrada" value={direcao} onChange={(e) => setDirecao(e.target.value)}>
              <option value="LOJA_DEVE">A loja deve ao Taaki</option>
              <option value="TAAKI_DEVE">O Taaki deve à loja</option>
            </select>
          )}
        </Campo>
        <Campo rotulo="Valor (R$)">
          {(id) => <CampoDinheiro id={id} valor={valor} aoMudar={(c) => setValor(c)} />}
        </Campo>
        <Campo rotulo="Código do pedido (opcional)">
          {(id) => <input id={id} className="entrada entrada--curta" inputMode="numeric" value={pedido} onChange={(e) => setPedido(e.target.value)} />}
        </Campo>
      </div>
      <Campo rotulo="Motivo (obrigatório)">
        {(id) => (
          <input id={id} className="entrada" maxLength={300} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: entregador atrasou, Taaki devolve a taxa" />
        )}
      </Campo>
      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
    </Dialogo>
  );
}
