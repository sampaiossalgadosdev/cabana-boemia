import { useState } from 'react';
import { api } from '../lib/api.js';
import { formatarDataHora } from '../lib/formatar.js';
import { formatarReais } from '../lib/dinheiro.js';
import { Campo, CampoDinheiro, Confirmar, Dialogo, EstadoCarga, useAvisar, useCarregar } from '../componentes/comuns.jsx';
import { NOMES_ORIGEM_ESTORNO, NOMES_STATUS_ESTORNO, NOMES_STATUS_PAGAMENTO, acoesDoPagamento, restanteParaEstornar } from '../lib/pagamentosAdmin.js';

const STATUS_PEDIDO = {
  CONFIRMADO: 'Em aberto',
  ABERTO: 'Em aberto',
  EM_PREPARO: 'Em preparo',
  SAIU_ENTREGA: 'Saiu para entrega',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado',
};

/**
 * Plataforma (só ADMIN), Etapa 5 do pagamento online: pagamentos pelo app, cancelar com estorno
 * (pedido aberto: o estoque volta) ou estornar pedido finalizado (sem cancelar), total ou parcial
 * e com motivo; reembolsos pendentes (o Mercado Pago recusou): tentar de novo ou resolvido por fora.
 */
export function TelaPagamentosAdmin() {
  const [filtro, setFiltro] = useState('acao');
  const [busca, setBusca] = useState('');
  const pedidoId = /^\d+$/.test(busca.trim()) ? Number(busca.trim()) : undefined;
  const carga = useCarregar(() => api.plataforma.pagamentos.listar({ acao: filtro === 'acao', pedidoId }), [filtro, pedidoId]);
  const [estornar, setEstornar] = useState(null); // pagamento
  const [resolver, setResolver] = useState(null); // pagamento
  const [confirmar, setConfirmar] = useState(null);
  const avisar = useAvisar();

  function tentarDeNovo(p) {
    setConfirmar({
      titulo: 'Tentar o estorno de novo?',
      texto: `O Mercado Pago é consultado antes: se o valor já voltou ao cliente, só marcamos como feito. Senão, pedimos o estorno de ${formatarReais(p.estornos.at(-1)?.valorCentavos ?? 0)} de novo.`,
      confirmar: 'Tentar de novo',
      acao: async () => {
        const r = await api.plataforma.pagamentos.tentarEstorno(p.id);
        avisar(r.resultado === 'CONCLUIDO' ? 'Estorno feito.' : r.resultado === 'PROCESSANDO' ? 'Estorno em processamento no Mercado Pago.' : 'O Mercado Pago recusou de novo.', r.resultado === 'FALHOU' ? 'erro' : undefined);
        await carga.recarregar();
      },
    });
  }

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Pagamentos online</h1>
          <p className="pagina__sub">
            Pix pelo app. Cancele com estorno, estorne um pedido entregue ou resolva um reembolso que o Mercado Pago recusou.
          </p>
        </div>
      </div>

      <section className="cartao">
        <div className="grade-form">
          <Campo rotulo="Mostrar">
            {(id) => (
              <select id={id} className="entrada" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                <option value="acao">Pedem ação (reembolso pendente, contestação)</option>
                <option value="todos">Todos os pagos (últimos 100)</option>
              </select>
            )}
          </Campo>
          <Campo rotulo="Código do pedido" ajuda="O número que aparece nos alertas (não o nº do dia).">
            {(id) => (
              <input id={id} className="entrada entrada--curta" inputMode="numeric" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: 1234" />
            )}
          </Campo>
        </div>
      </section>

      <EstadoCarga carga={carga}>
        {({ pagamentos }) =>
          pagamentos.length === 0 ? (
            <section className="cartao" style={{ marginTop: 16 }}>
              <p className="estado">{filtro === 'acao' ? 'Nada pedindo ação.' : 'Nenhum pagamento encontrado.'}</p>
            </section>
          ) : (
            <section className="cartao tabela-rolagem" style={{ marginTop: 16 }}>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Pago em</th>
                    <th>Loja</th>
                    <th>Pedido</th>
                    <th>Valor</th>
                    <th>Pagamento</th>
                    <th className="fim">
                      <span className="visualmente-oculto">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagamentos.map((p) => {
                    const acoes = acoesDoPagamento(p);
                    return (
                      <tr key={p.id}>
                        <td>{p.aprovadoEm ? formatarDataHora(p.aprovadoEm) : '—'}</td>
                        <td>{p.pedido.loja.nome}</td>
                        <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>
                          {p.pedido.numeroDia ? `nº ${p.pedido.numeroDia}` : 'sem número'} · código {p.pedido.id}
                          <br />
                          <span className="suave">
                            {p.pedido.nomeCliente} · {STATUS_PEDIDO[p.pedido.status] ?? p.pedido.status}
                            {p.pedido.aceitoEm ? ' · aceito' : ''}
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {formatarReais(p.valorCentavos)}
                          {p.valorReembolsadoCentavos > 0 && (
                            <>
                              <br />
                              <span className="suave">estornado {formatarReais(p.valorReembolsadoCentavos)}</span>
                            </>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>
                          <strong>{NOMES_STATUS_PAGAMENTO[p.status] ?? p.status}</strong>
                          {p.estornos.length > 0 && (
                            <ul className="lista-estornos">
                              {p.estornos.map((e) => (
                                <li key={e.id}>
                                  {formatarReais(e.valorCentavos)} · {NOMES_STATUS_ESTORNO[e.status] ?? e.status} · {NOMES_ORIGEM_ESTORNO[e.origem] ?? e.origem}
                                  {e.usuario && ` (${e.usuario})`}
                                  <br />
                                  <span className="suave">
                                    {e.motivo}
                                    {e.erro && ` · erro: ${e.erro}`}
                                    {e.observacao && ` · ${e.observacao}`}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="fim">
                          <div className="acoes">
                            {acoes.includes('estornar') && (
                              <button type="button" className="botao botao--pequeno" onClick={() => setEstornar(p)}>
                                {acoes.includes('cancela') ? 'Cancelar com estorno' : 'Estornar'}
                              </button>
                            )}
                            {acoes.includes('tentar') && (
                              <button type="button" className="botao botao--pequeno botao--primario" onClick={() => tentarDeNovo(p)}>
                                Tentar de novo
                              </button>
                            )}
                            {acoes.includes('resolver') && (
                              <button type="button" className="botao botao--pequeno" onClick={() => setResolver(p)}>
                                Resolvido por fora
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )
        }
      </EstadoCarga>

      <DialogoEstorno
        pagamento={estornar}
        aoFechar={() => setEstornar(null)}
        aoFeito={async (r) => {
          setEstornar(null);
          const pendente = r.pedido.pagamentoOnline?.situacao === 'ESTORNO_PENDENTE';
          avisar(
            pendente
              ? 'O Mercado Pago não fez o estorno. Ele ficou como reembolso pendente.'
              : r.cancelado
                ? 'Pedido cancelado e valor estornado.'
                : 'Valor estornado.',
            pendente ? 'erro' : undefined,
          );
          await carga.recarregar();
        }}
      />
      <DialogoResolvido
        pagamento={resolver}
        aoFechar={() => setResolver(null)}
        aoFeito={async () => {
          setResolver(null);
          avisar('Reembolso marcado como resolvido por fora.');
          await carga.recarregar();
        }}
      />
      <Confirmar pedido={confirmar} aoFechar={() => setConfirmar(null)} />
    </>
  );
}

function DialogoEstorno({ pagamento, aoFechar, aoFeito }) {
  const [valor, setValor] = useState(null);
  const [texto, setTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const restante = pagamento ? restanteParaEstornar(pagamento) : 0;
  const aberto = pagamento && acoesDoPagamento(pagamento).includes('cancela');

  function fechar() {
    setValor(null);
    setTexto('');
    setMotivo('');
    setErro('');
    aoFechar();
  }

  async function enviar() {
    if (motivo.trim().length < 3) return setErro('Escreva o motivo do estorno.');
    if (texto.trim() && (valor == null || valor < 1 || valor > restante)) return setErro(`O valor vai de R$ 0,01 até ${formatarReais(restante)}.`);
    setEnviando(true);
    setErro('');
    try {
      const r = await api.plataforma.pagamentos.estornar(pagamento.pedido.id, { valorCentavos: texto.trim() ? valor : null, motivo: motivo.trim() });
      setValor(null);
      setTexto('');
      setMotivo('');
      await aoFeito(r);
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(pagamento)}
      titulo={aberto ? 'Cancelar com estorno' : 'Estornar pedido entregue'}
      aoFechar={fechar}
      aoEnviar={enviar}
      rodape={
        <>
          <button type="button" className="botao" onClick={fechar} disabled={enviando}>
            Voltar
          </button>
          <button type="submit" className="botao botao--perigo" disabled={enviando}>
            {enviando ? 'Enviando…' : aberto ? 'Cancelar e estornar' : 'Estornar'}
          </button>
        </>
      }
    >
      {pagamento && (
        <>
          <p>
            {aberto
              ? 'O pedido é cancelado, o estoque volta, sai o cupom de cancelamento na loja e o valor volta ao cliente pelo Mercado Pago.'
              : 'O pedido continua finalizado (o estoque não volta); o valor volta ao cliente pelo Mercado Pago e aparece à parte no relatório do dia.'}
          </p>
          <Campo rotulo="Valor a estornar (R$)" ajuda={`Vazio = tudo o que ainda não voltou (${formatarReais(restante)}).`}>
            {(id, d) => (
              <CampoDinheiro
                id={id}
                descritoPor={d}
                valor={valor}
                aoMudar={(c, t) => {
                  setValor(c);
                  setTexto(t);
                }}
              />
            )}
          </Campo>
          <Campo rotulo="Motivo (obrigatório)">
            {(id) => (
              <input id={id} className="entrada" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: item faltando no pedido" />
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

function DialogoResolvido({ pagamento, aoFechar, aoFeito }) {
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  function fechar() {
    setObservacao('');
    setErro('');
    aoFechar();
  }

  async function enviar() {
    if (observacao.trim().length < 3) return setErro('Escreva o que foi feito.');
    setEnviando(true);
    setErro('');
    try {
      await api.plataforma.pagamentos.resolvido(pagamento.id, observacao.trim());
      setObservacao('');
      await aoFeito();
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(pagamento)}
      titulo="Resolvido por fora"
      aoFechar={fechar}
      aoEnviar={enviar}
      rodape={
        <>
          <button type="button" className="botao" onClick={fechar} disabled={enviando}>
            Voltar
          </button>
          <button type="submit" className="botao botao--primario" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Marcar como resolvido'}
          </button>
        </>
      }
    >
      <p>Use quando o valor voltou ao cliente fora do sistema (ex.: Pix devolvido pela loja). O Mercado Pago não é chamado.</p>
      <Campo rotulo="O que foi feito (obrigatório)">
        {(id) => <textarea id={id} className="entrada" rows={3} maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)} />}
      </Campo>
      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
    </Dialogo>
  );
}
