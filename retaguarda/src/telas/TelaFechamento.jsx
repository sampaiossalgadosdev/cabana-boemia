import { useState } from 'react';
import { api } from '../lib/api.js';
import { formatarDataHora } from '../lib/formatar.js';
import { Dialogo, EstadoCarga, useCarregar } from '../componentes/comuns.jsx';
import { NOMES_STATUS_FECHAMENTO, nomeDaSemana, nomeDoPedido, textoDoSaldo, valorParaLoja } from '../lib/financeiro.js';

const formatarData = (iso) => formatarDataHora(iso).slice(0, 8);

/**
 * Loja (DONO; ADMIN numa loja): o acerto semanal com o Taaki (Etapa 6 do pagamento online).
 * Semana atual ainda aberta (parcial) e as semanas fechadas, cada uma com os pedidos e
 * lançamentos, e o saldo em linguagem simples.
 */
export function TelaFechamento() {
  const carga = useCarregar(() => api.fechamento.obter());
  const [aberto, setAberto] = useState(null); // id do fechamento no diálogo

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Fechamento</h1>
          <p className="pagina__sub">
            O acerto da semana (segunda a domingo) entre a loja e o Taaki: taxas de entrega dos entregadores do Taaki que a loja
            recebeu e créditos do frete grátis pago pelo Taaki.
          </p>
        </div>
      </div>

      <EstadoCarga carga={carga}>
        {({ semanaAtual, semanaAnterior, fechamentos }) => (
          <>
            {semanaAnterior && (
              <section className="cartao" style={{ marginBottom: 16 }}>
                <div className="cartao__topo">
                  <h2 className="cartao__titulo">Semana anterior ({nomeDaSemana(semanaAnterior.inicio, semanaAnterior.domingo)})</h2>
                  <span className="etiqueta etiqueta--aviso">fechando</span>
                </div>
                <div className="cartao__corpo">
                  <p className={`saldo-fechamento${semanaAnterior.saldoCentavos > 0 ? ' saldo-fechamento--deve' : ''}`}>
                    {textoDoSaldo(semanaAnterior.saldoCentavos)}
                  </p>
                  <p className="suave">Esta semana já terminou e está sendo fechada. Em instantes ela aparece em "Semanas fechadas".</p>
                </div>
                <TabelaLancamentos lancamentos={semanaAnterior.lancamentos} />
              </section>
            )}
            <section className="cartao">
              <div className="cartao__topo">
                <h2 className="cartao__titulo">Semana de {nomeDaSemana(semanaAtual.inicio, semanaAtual.domingo)}</h2>
                <span className="etiqueta">parcial</span>
              </div>
              <div className="cartao__corpo">
                <p className={`saldo-fechamento${semanaAtual.saldoCentavos > 0 ? ' saldo-fechamento--deve' : ''}`}>
                  {textoDoSaldo(semanaAtual.saldoCentavos)}
                </p>
                <p className="suave">A semana fecha na segunda-feira, depois da virada do dia. Até lá, o valor ainda pode mudar.</p>
              </div>
              {semanaAtual.lancamentos.length > 0 && <TabelaLancamentos lancamentos={semanaAtual.lancamentos} />}
            </section>

            <section className="cartao tabela-rolagem" style={{ marginTop: 16 }}>
              <div className="cartao__topo">
                <h2 className="cartao__titulo">Semanas fechadas</h2>
              </div>
              {fechamentos.length === 0 ? (
                <p className="estado">Nenhuma semana fechada ainda.</p>
              ) : (
                <table className="tabela tabela--empilhada">
                  <thead>
                    <tr>
                      <th>Semana</th>
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
                        <td style={{ whiteSpace: 'normal' }}>{textoDoSaldo(f.saldoCentavos)}</td>
                        <td>
                          <EtiquetaStatus fechamento={f} />
                        </td>
                        <td className="fim">
                          <button type="button" className="botao botao--pequeno" onClick={() => setAberto(f.id)}>
                            Ver pedidos
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </EstadoCarga>

      <DialogoFechamento id={aberto} buscar={api.fechamento.detalhe} aoFechar={() => setAberto(null)} />
    </>
  );
}

export function EtiquetaStatus({ fechamento: f }) {
  if (f.status === 'QUITADO') {
    return <span className="etiqueta etiqueta--ok">Quitado{f.quitadoEm ? ` em ${formatarData(f.quitadoEm)}` : ''}</span>;
  }
  return <span className="etiqueta etiqueta--aviso">{NOMES_STATUS_FECHAMENTO[f.status] ?? f.status}</span>;
}

/** Lançamentos (do ponto de vista da loja, ou do ADMIN com `valor`). */
export function TabelaLancamentos({ lancamentos, valor = valorParaLoja }) {
  return (
    <div className="tabela-rolagem">
      <table className="tabela tabela--empilhada">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Pedido</th>
            <th>O que é</th>
            <th className="num">Valor</th>
          </tr>
        </thead>
        <tbody>
          {lancamentos.map((l) => (
            <tr key={l.id}>
              <td>{formatarDataHora(l.criadoEm)}</td>
              <td style={{ whiteSpace: 'normal' }}>
                {nomeDoPedido(l.pedido)}
                {l.pedido?.nomeCliente && (
                  <>
                    <br />
                    <span className="suave">{l.pedido.nomeCliente}</span>
                  </>
                )}
              </td>
              <td style={{ whiteSpace: 'normal', maxWidth: 340 }}>
                {l.descricao}
                {l.observacao && l.tipo !== 'ESTORNO' && (
                  <>
                    <br />
                    <span className="suave">{l.observacao}</span>
                  </>
                )}
              </td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                {valor(l.valorCentavos)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Diálogo com o detalhe de um fechamento (`buscar` = rota da loja ou do ADMIN). */
export function DialogoFechamento({ id, buscar, aoFechar, saldo = textoDoSaldo, valor = valorParaLoja, rodapeExtra = null }) {
  const carga = useCarregar(() => (id ? buscar(id) : Promise.resolve(null)), [id]);
  // Durante a troca de fechamento o useCarregar mantém o anterior: só mostra o pedido.
  const f = carga.dados?.fechamento?.id === id ? carga.dados.fechamento : null;
  return (
    <Dialogo
      aberto={Boolean(id)}
      largo
      titulo={f ? `Semana de ${nomeDaSemana(f.inicio, f.domingo)}${f.loja ? ` · ${f.loja.nome}` : ''}` : 'Fechamento'}
      aoFechar={aoFechar}
      rodape={
        <>
          {rodapeExtra?.(f)}
          <button type="button" className="botao" onClick={aoFechar}>
            Fechar
          </button>
        </>
      }
    >
      {carga.erro && <p className="erro">{carga.erro.message}</p>}
      {!f && !carga.erro && <p className="estado">Carregando…</p>}
      {f && (
        <>
          <p className="saldo-fechamento">{saldo(f.saldoCentavos, f.loja?.nome)}</p>
          <p>
            <EtiquetaStatus fechamento={f} />
            {f.quitadoPor && <span className="suave"> · marcado por {f.quitadoPor}</span>}
            {f.observacao && <span className="suave"> · {f.observacao}</span>}
          </p>
          <TabelaLancamentos lancamentos={f.lancamentos} valor={valor} />
        </>
      )}
    </Dialogo>
  );
}
