import { useState } from 'react';
import { api } from '../lib/api.js';
import { formatarReais } from '../lib/dinheiro.js';
import {
  descreverDiferenca,
  descreverExpediente,
  formatarDia,
  formatarHora,
  formatarPeso,
  larguraBarra,
  somarDias,
} from '../lib/formatar.js';
import { EstadoCarga, useAvisar, useCarregar } from '../componentes/comuns.jsx';

const NOME_FORMA = { DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Débito', CREDITO: 'Crédito' };
const NOME_MEIO_ONLINE = { PIX: 'Pix', CARTAO_ONLINE: 'Cartão' };
const NOME_CANAL = { SITE: 'Site', APP: 'App', WHATSAPP: 'WhatsApp', SALAO: 'Salão' };

async function carregar(data) {
  const [relatorio, { caixas }] = await Promise.all([api.relatorios.dia(data), api.relatorios.caixas(data)]);
  return { relatorio, caixas };
}

/**
 * Relatório do dia OPERACIONAL (vira na hora configurada, padrão 04:00):
 * números principais, formas de pagamento, canais, produtos e caixas.
 */
export function TelaRelatorio() {
  const [data, setData] = useState('hoje');
  const [hoje, setHoje] = useState(null);
  const carga = useCarregar(async () => {
    const r = await carregar(data);
    if (data === 'hoje') setHoje(r.relatorio.data);
    return r;
  }, [data]);
  const avisar = useAvisar();
  const [imprimindo, setImprimindo] = useState(false);
  const dia = carga.dados?.relatorio.data;

  async function imprimir() {
    setImprimindo(true);
    try {
      await api.relatorios.imprimir(dia);
      avisar('Resumo do dia enviado para a impressora do balcão.');
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      setImprimindo(false);
    }
  }

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Relatório do dia</h1>
          <p className="pagina__sub">
            {carga.dados
              ? `Expediente: ${descreverExpediente(carga.dados.relatorio.inicio, carga.dados.relatorio.fim)}`
              : 'Só pedidos finalizados; o dia vira na hora definida em Configurações.'}
          </p>
        </div>
        <button type="button" className="botao botao--primario" onClick={imprimir} disabled={!dia || imprimindo}>
          {imprimindo ? 'Enviando…' : 'Imprimir fechamento do dia'}
        </button>
      </div>

      <div className="seletor-dia">
        <button
          type="button"
          className="botao botao--icone"
          aria-label="Dia anterior"
          disabled={!dia || carga.carregando}
          onClick={() => setData(somarDias(dia, -1))}
        >
          ‹
        </button>
        <input
          type="date"
          className="entrada"
          aria-label="Dia"
          value={dia ?? ''}
          max={hoje ?? undefined}
          onChange={(e) => e.target.value && setData(e.target.value)}
        />
        <button
          type="button"
          className="botao botao--icone"
          aria-label="Próximo dia"
          disabled={!dia || !hoje || dia >= hoje || carga.carregando}
          onClick={() => setData(somarDias(dia, 1))}
        >
          ›
        </button>
        {dia && <span className="suave">{formatarDia(dia)}</span>}
        {hoje && dia !== hoje && (
          <button type="button" className="botao botao--texto botao--pequeno" onClick={() => setData('hoje')}>
            Ir para hoje
          </button>
        )}
      </div>

      <EstadoCarga carga={carga}>{({ relatorio, caixas }) => <Conteudo r={relatorio} caixas={caixas} />}</EstadoCarga>
    </>
  );
}

function Conteudo({ r, caixas }) {
  const [top, setTop] = useState('quantidade');
  // Pago online (Pix/cartão no app) à parte das formas pagas na entrega (Decisão 19).
  const online = (r.pagoOnline ?? []).filter((p) => p.quantidade > 0);
  const maiorForma = Math.max(...r.porFormaPagamento.map((f) => f.totalCentavos), ...online.map((p) => p.totalCentavos));
  const produtos = top === 'quantidade' ? r.topPorQuantidade : r.topPorValor;

  return (
    <>
      <section className="numeros" aria-label="Números principais">
        <div className="numero numero--destaque">
          <span className="numero__rotulo">Total vendido</span>
          <span className="numero__valor">{formatarReais(r.totalCentavos)}</span>
        </div>
        <div className="numero">
          <span className="numero__rotulo">Pedidos</span>
          <span className="numero__valor">{r.quantidadePedidos}</span>
        </div>
        <div className="numero">
          <span className="numero__rotulo">Ticket médio</span>
          <span className="numero__valor">{formatarReais(r.ticketMedioCentavos)}</span>
        </div>
        <div className="numero">
          <span className="numero__rotulo">Taxas de entrega</span>
          <span className="numero__valor">{formatarReais(r.taxaEntregaCentavos)}</span>
        </div>
      </section>
      <p className="suave nota-cancelados">
        Fora dos totais: {r.cancelados.quantidade} pedido(s) cancelado(s) ({formatarReais(r.cancelados.totalCentavos)})
        {' · '}
        {r.itensRemovidos.quantidade} item(ns) removido(s) de comandas ({formatarReais(r.itensRemovidos.totalCentavos)})
        {r.descontoCentavos > 0 && ` · Descontos dados no PDV: ${formatarReais(r.descontoCentavos)} (já descontados do total)`}
        {r.estornosDeFinalizados?.quantidade > 0 &&
          ` · ${r.estornosDeFinalizados.quantidade} estorno(s) de pedido(s) entregue(s) (${formatarReais(r.estornosDeFinalizados.totalCentavos)})`}
      </p>

      <div className="grade-relatorio">
        <section className="cartao">
          <div className="cartao__topo">
            <h2 className="cartao__titulo">{online.length ? 'Pago na entrega' : 'Por forma de pagamento'}</h2>
          </div>
          <ul className="barras">
            {r.porFormaPagamento.map((f) => (
              <li key={f.forma} className="barra" title={`${NOME_FORMA[f.forma]}: ${f.quantidade} pedido(s), ${formatarReais(f.totalCentavos)}`}>
                <span className="barra__rotulo">{NOME_FORMA[f.forma]}</span>
                <span className="barra__trilho">
                  <span className="barra__marca" style={{ width: `${larguraBarra(f.totalCentavos, maiorForma)}%` }} />
                </span>
                <span className="barra__valor">
                  {formatarReais(f.totalCentavos)}
                  <small>{f.quantidade} ped.</small>
                </span>
              </li>
            ))}
          </ul>
          {online.length > 0 && (
            <>
              <h3 className="cartao__titulo" style={{ marginTop: 16 }}>Pago online (fora do caixa)</h3>
              <ul className="barras">
                {online.map((p) => (
                  <li key={p.meio} className="barra" title={`${NOME_MEIO_ONLINE[p.meio]} online: ${p.quantidade} pedido(s), ${formatarReais(p.totalCentavos)}`}>
                    <span className="barra__rotulo">{NOME_MEIO_ONLINE[p.meio]} online</span>
                    <span className="barra__trilho">
                      <span className="barra__marca" style={{ width: `${larguraBarra(p.totalCentavos, maiorForma)}%` }} />
                    </span>
                    <span className="barra__valor">
                      {formatarReais(p.totalCentavos)}
                      <small>{p.quantidade} ped.</small>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="cartao">
          <div className="cartao__topo">
            <h2 className="cartao__titulo">Por canal</h2>
          </div>
          <table className="tabela">
            <tbody>
              {r.porCanal.map((c) => (
                <tr key={c.canal}>
                  <td>{NOME_CANAL[c.canal]}</td>
                  <td className="num">{c.quantidade} ped.</td>
                  <td className="num">
                    <strong>{formatarReais(c.totalCentavos)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="cartao tabela-rolagem">
        <div className="cartao__topo">
          <h2 className="cartao__titulo">Produtos mais vendidos</h2>
          <div className="abas abas--pequenas" role="tablist" aria-label="Ordenar por">
            {[
              ['quantidade', 'Por quantidade'],
              ['valor', 'Por valor'],
            ].map(([v, rot]) => (
              <button key={v} type="button" role="tab" className="aba" aria-selected={top === v} onClick={() => setTop(v)}>
                {rot}
              </button>
            ))}
          </div>
        </div>
        <table className="tabela">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Produto</th>
              <th className="num">Qtd.</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p, i) => (
              <tr key={p.produtoId}>
                <td className="num suave">{i + 1}</td>
                <td className="produto-nome">
                  {p.nome}
                  {p.pesoGramas ? <small>{formatarPeso(p.pesoGramas)}</small> : null}
                </td>
                <td className="num">{p.quantidade}</td>
                <td className="num">{formatarReais(p.totalCentavos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!produtos.length && <div className="tabela-vazia">Nenhuma venda finalizada neste dia.</div>}
      </section>

      <h2 className="titulo-secao">Caixas do dia</h2>
      {!caixas.length && <div className="cartao tabela-vazia">Nenhum caixa aberto neste dia.</div>}
      {caixas.map((c) => (
        <CartaoCaixa key={c.id} c={c} />
      ))}
    </>
  );
}

function CartaoCaixa({ c }) {
  const dif = descreverDiferenca(c.diferencaCentavos);
  const movimentos = (tipo) => c.movimentos.filter((m) => m.tipo === tipo);
  return (
    <section className="cartao caixa-dia">
      <div className="cartao__topo">
        <div>
          <h3 className="cartao__titulo">Caixa #{c.id}</h3>
          <span className="suave">
            Aberto às {formatarHora(c.abertoEm)} por {c.abertoPor?.nome}
            {c.aberto ? ' · ainda aberto' : ` · fechado às ${formatarHora(c.fechadoEm)} por ${c.fechadoPor?.nome}`}
          </span>
        </div>
        {dif && (
          <span className={`etiqueta ${dif.tipo === 'faltou' ? 'etiqueta--alerta' : dif.tipo === 'sobrou' ? 'etiqueta--aviso' : 'etiqueta--ok'}`}>
            {dif.tipo === 'faltou' ? `Faltou ${formatarReais(dif.centavos)}` : dif.tipo === 'sobrou' ? `Sobrou ${formatarReais(dif.centavos)}` : 'Bateu'}
          </span>
        )}
        {!dif && <span className="etiqueta etiqueta--ouro">Aberto</span>}
      </div>
      <div className="caixa-dia__corpo">
        <dl className="contas">
          <div>
            <dt>Fundo de troco (abertura)</dt>
            <dd>{formatarReais(c.valorInicialCentavos)}</dd>
          </div>
          <div>
            <dt>Vendas em dinheiro</dt>
            <dd>+ {formatarReais(c.vendasDinheiroCentavos)}</dd>
          </div>
          <div>
            <dt>Suprimentos</dt>
            <dd>+ {formatarReais(c.suprimentosCentavos)}</dd>
          </div>
          <div>
            <dt>Sangrias</dt>
            <dd>− {formatarReais(c.sangriasCentavos)}</dd>
          </div>
          <div className="contas__total">
            <dt>Esperado na gaveta{c.aberto ? ' (até agora)' : ''}</dt>
            <dd>{formatarReais(c.esperadoCentavos)}</dd>
          </div>
          <div>
            <dt>Contado</dt>
            <dd>{c.valorContadoCentavos == null ? '—' : formatarReais(c.valorContadoCentavos)}</dd>
          </div>
          <div className={dif?.tipo === 'faltou' ? 'contas__falta' : undefined}>
            <dt>Diferença</dt>
            <dd>
              {dif == null
                ? '—'
                : dif.tipo === 'faltou'
                  ? `− ${formatarReais(dif.centavos)}`
                  : dif.tipo === 'sobrou'
                    ? `+ ${formatarReais(dif.centavos)}`
                    : formatarReais(0)}
            </dd>
          </div>
        </dl>
        <div className="movimentos">
          {[
            ['SUPRIMENTO', 'Suprimentos'],
            ['SANGRIA', 'Sangrias'],
          ].map(([tipo, titulo]) => (
            <div key={tipo}>
              <h4>{titulo}</h4>
              {!movimentos(tipo).length && <p className="suave">Nenhum.</p>}
              <ul>
                {movimentos(tipo).map((m) => (
                  <li key={m.id}>
                    <span className="suave">{formatarHora(m.criadoEm)}</span> {m.motivo}
                    <span className="suave"> · {m.usuario?.nome}</span>
                    <strong>{formatarReais(m.valorCentavos)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {c.observacao && (
            <p className="suave">
              <strong>Observação do fechamento:</strong> {c.observacao}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
