import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import { diaOperacional } from '../../lib/caixa.js';
import {
  FILTROS_STATUS,
  FILTROS_TIPO,
  aplicarPedido,
  entraNoPainel,
  filtrarPedidos,
  ordenarPedidos,
  pedidosParaRealertar,
  tocaAlerta,
} from '../../lib/painel.js';
import { tocarAlerta } from '../../lib/som.js';
import { Logo } from '../Logo.jsx';
import { IconeAtualizar, IconeLupa } from '../Icones.jsx';
import { LinhaPedido } from './LinhaPedido.jsx';
import { DetalhePedido } from './DetalhePedido.jsx';

/** Recarga de segurança (eventos perdidos, virada do dia). */
const RECARREGAR_MS = 5 * 60_000;
/** O atraso e o "sem aceite" (pago online) são recalculados a cada 30 s. */
const RELOGIO_MS = 30_000;

/**
 * Painel de pedidos do delivery (tela inicial): filtros, lista
 * "Entregas/Encomendas" (site + WhatsApp do dia operacional) e o botão
 * NOVO PEDIDO. Fica montado mesmo no Salão e durante o lançamento: o alerta
 * do pedido do site continua tocando.
 */
export function PainelDelivery({ statusConexao, aoNovoPedido, recarga = 0 }) {
  const [agora, setAgora] = useState(() => new Date());
  const hoje = diaOperacional(agora);
  const [dia, setDia] = useState(null); // null = hoje (acompanha a virada do dia)
  const [status, setStatus] = useState('andamento');
  const [tipo, setTipo] = useState('todos');
  const [busca, setBusca] = useState('');
  const [pedidos, setPedidos] = useState([]);
  const [diaCarregado, setDiaCarregado] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [novos, setNovos] = useState(() => new Set());
  const [abertoId, setAbertoId] = useState(null);
  const diaRef = useRef(null);
  // Pagos online que já tocaram de novo por estarem 5 minutos sem aceite (um toque extra cada).
  const realertados = useRef(new Set());

  const diaPedido = dia ?? 'hoje';

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await chamar(pdv.pedidos.listar(diaPedido));
      setPedidos(r.pedidos.filter(entraNoPainel));
      setDiaCarregado(r.dataRef);
      diaRef.current = r.dataRef;
      setErro('');
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }, [diaPedido]);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, RECARREGAR_MS);
    return () => clearInterval(id);
  }, [carregar, recarga]);

  useEffect(() => {
    if (statusConexao === 'conectado') carregar();
  }, [statusConexao, carregar]);

  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), RELOGIO_MS);
    return () => clearInterval(id);
  }, []);

  // Tempo real: pedido novo (alerta do site) e atualizações (status, finalizar, cancelar).
  useEffect(() => {
    const pararNovo = pdv.aoEvento('pedido:novo', (pedido) => {
      if (!entraNoPainel(pedido)) return; // ex.: comanda do salão
      setPedidos((lista) => aplicarPedido(lista, pedido, diaRef.current));
      if (tocaAlerta(pedido)) {
        setNovos((n) => new Set(n).add(pedido.id));
        tocarAlerta();
      }
    });
    const pararAtualizado = pdv.aoEvento('pedido:atualizado', (pedido) => {
      setPedidos((lista) => aplicarPedido(lista, pedido, diaRef.current));
    });
    return () => {
      pararNovo();
      pararAtualizado();
    };
  }, []);

  // Pago online sem aceite há 5 minutos: toca de novo (uma vez por pedido) e a linha fica em destaque.
  useEffect(() => {
    const ids = pedidosParaRealertar(pedidos, realertados.current, agora);
    if (!ids.length) return;
    for (const id of ids) realertados.current.add(id);
    tocarAlerta();
  }, [pedidos, agora]);

  const visiveis = useMemo(
    () => ordenarPedidos(filtrarPedidos(pedidos, { status, tipo, busca })),
    [pedidos, status, tipo, busca],
  );
  const pedidoAberto = pedidos.find((p) => p.id === abertoId) ?? null;

  const visto = (id) =>
    setNovos((n) => {
      if (!n.has(id)) return n;
      const m = new Set(n);
      m.delete(id);
      return m;
    });

  return (
    <section className="painel-delivery" aria-label="Pedidos do delivery">
      <div className="painel-delivery__filtros">
        <label className="campo campo--inline">
          <span>Data</span>
          <input type="date" value={dia ?? hoje} max={hoje}
            onChange={(e) => setDia(!e.target.value || e.target.value === hoje ? null : e.target.value)} />
        </label>
        <label className="campo campo--inline">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {FILTROS_STATUS.map((f) => (
              <option key={f.valor} value={f.valor}>{f.rotulo}</option>
            ))}
          </select>
        </label>
        <label className="campo campo--inline campo--busca">
          <span className="visualmente-oculto">Pesquisar</span>
          <IconeLupa className="campo__icone" />
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar (cliente, nº do pedido, telefone)" />
        </label>
        <label className="campo campo--inline">
          <span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {FILTROS_TIPO.map((f) => (
              <option key={f.valor} value={f.valor}>{f.rotulo}</option>
            ))}
          </select>
        </label>
        <button type="button" className="botao-icone painel-delivery__atualizar" onClick={carregar} disabled={carregando}
          aria-label="Atualizar a lista" title="Atualizar a lista">
          <IconeAtualizar />
        </button>
      </div>

      <div className="painel-delivery__corpo">
        <div className="lista-pedidos">
          <h2 className="lista-pedidos__titulo">
            Entregas/Encomendas <span className="fila__contagem">{visiveis.length}</span>
            {diaCarregado && diaCarregado !== hoje && <span className="texto-suave"> · dia {diaCarregado.split('-').reverse().join('/')}</span>}
          </h2>
          {erro && <p className="aviso" role="alert">{erro}</p>}
          {!visiveis.length ? (
            <p className="lista-pedidos__vazia">{carregando ? 'Carregando…' : 'Nenhum pedido com esses filtros.'}</p>
          ) : (
            <ul className="lista-pedidos__itens">
              {visiveis.map((p) => (
                <LinhaPedido key={p.id} pedido={p} agora={agora} novo={novos.has(p.id)}
                  aoVer={() => visto(p.id)}
                  aoAbrir={(id) => {
                    visto(id);
                    setAbertoId(id);
                  }} />
              ))}
            </ul>
          )}
        </div>

        <aside className="painel-delivery__lado">
          <Logo className="painel-delivery__logo" recorte />
          <button type="button" className="botao botao--novo-pedido" onClick={aoNovoPedido}>
            NOVO PEDIDO <kbd>F2</kbd>
          </button>
        </aside>
      </div>

      {pedidoAberto && (
        <DetalhePedido key={pedidoAberto.id} pedido={pedidoAberto} aoFechar={() => setAbertoId(null)}
          aoAtualizado={(p) => setPedidos((lista) => aplicarPedido(lista, p, diaRef.current))} />
      )}
    </section>
  );
}
