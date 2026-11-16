import { useCallback, useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import { formatarPreco } from '../../lib/formatar.js';
import { aplicarComanda, contarItens, filtrarComandas, tempoAberta } from '../../lib/salao.js';
import { ComandaAberta } from './ComandaAberta.jsx';

const RECARREGAR_MS = 5 * 60_000;
const RELOGIO_MS = 30_000;
const AVISO_MS = 6000;

/**
 * Salão: grade das comandas abertas (nome, total parcial, tempo aberta),
 * busca pelo nome e "+ Nova comanda". Segue os eventos do socket (outro PDV
 * lançando) e recarrega ao (re)conectar e a cada 5 min.
 */
export function Salao({ statusConexao }) {
  const [comandas, setComandas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [abertaId, setAbertaId] = useState(null);
  const [nova, setNova] = useState(null); // { nomeCliente, mesaRotulo } | null
  const [criando, setCriando] = useState(false);
  const [erroNova, setErroNova] = useState('');
  const [aviso, setAviso] = useState('');
  const [agora, setAgora] = useState(() => new Date());
  const campoBusca = useRef(null);

  const carregar = useCallback(async () => {
    try {
      const r = await chamar(pdv.comandas.listar());
      setComandas(r.comandas);
      setErro('');
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, RECARREGAR_MS);
    const relogio = setInterval(() => setAgora(new Date()), RELOGIO_MS);
    return () => {
      clearInterval(id);
      clearInterval(relogio);
    };
  }, [carregar]);

  useEffect(() => {
    if (statusConexao === 'conectado') carregar();
  }, [statusConexao, carregar]);

  useEffect(() => {
    const aplicar = (pedido) => setComandas((l) => aplicarComanda(l, pedido));
    const a = pdv.aoEvento('pedido:novo', aplicar);
    const b = pdv.aoEvento('pedido:atualizado', aplicar);
    return () => {
      a();
      b();
    };
  }, []);

  useEffect(() => {
    if (!aviso) return undefined;
    const id = setTimeout(() => setAviso(''), AVISO_MS);
    return () => clearTimeout(id);
  }, [aviso]);

  const aberta = comandas.find((c) => c.id === abertaId) ?? null;
  // Fechada/cancelada por outro PDV enquanto estava aberta aqui: volta para a grade.
  useEffect(() => {
    if (abertaId && !carregando && !aberta) setAbertaId(null);
  }, [abertaId, aberta, carregando]);

  const visiveis = filtrarComandas(comandas, busca);

  /** Abrir limpa a busca: ao voltar, a grade mostra todas as comandas. */
  const abrir = (id) => {
    setAbertaId(id);
    setBusca('');
  };

  // Esc na grade: fecha o "Nova comanda", depois limpa a busca.
  useEffect(() => {
    if (abertaId) return undefined;
    function aoTeclar(e) {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (e.target.closest?.('.campo-tempo')) return;
      e.preventDefault();
      if (nova) setNova(null);
      else setBusca('');
      campoBusca.current?.focus();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [abertaId, nova]);

  async function criar(e) {
    e.preventDefault();
    if (!nova.nomeCliente.trim()) {
      setErroNova('Informe o nome do cliente');
      return;
    }
    setCriando(true);
    setErroNova('');
    try {
      const { comanda } = await chamar(pdv.comandas.abrir(nova));
      setComandas((l) => aplicarComanda(l, comanda));
      setNova(null);
      abrir(comanda.id);
    } catch (err) {
      setErroNova(err.message);
    } finally {
      setCriando(false);
    }
  }

  const voltar = useCallback(() => {
    setAbertaId(null);
    setTimeout(() => campoBusca.current?.focus(), 0);
  }, []);

  if (aberta) {
    return (
      <ComandaAberta key={aberta.id} comanda={aberta} agora={agora}
        aoMudar={(c) => setComandas((l) => aplicarComanda(l, c))}
        aoFechada={(c, mensagem) => {
          if (c) setComandas((l) => aplicarComanda(l, c));
          else carregar();
          setAviso(mensagem);
          voltar();
        }}
        aoVoltar={voltar} />
    );
  }

  return (
    <section className="salao" aria-labelledby="titulo-salao">
      <div className="fila__cabecalho">
        <h2 id="titulo-salao">Comandas abertas</h2>
        <span className="fila__contagem">{comandas.length}</span>
        <input ref={campoBusca} className="salao__busca" type="search" placeholder="Buscar pelo nome ou mesa…"
          aria-label="Buscar comanda" value={busca} autoFocus
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && visiveis.length === 1) abrir(visiveis[0].id);
          }} />
        <button type="button" className="botao" onClick={() => setNova({ nomeCliente: busca.trim(), mesaRotulo: '' })}>
          + Nova comanda
        </button>
      </div>

      {aviso && <p className="aviso-sucesso" role="status">{aviso}</p>}
      {erro && <p className="aviso" role="alert">Não foi possível atualizar as comandas: {erro}</p>}

      {nova && (
        <form className="nova-comanda" onSubmit={criar}>
          <label className="campo nova-comanda__nome">
            Nome do cliente
            <input className="campo__grande" value={nova.nomeCliente} maxLength={60} autoFocus disabled={criando}
              onChange={(e) => setNova({ ...nova, nomeCliente: e.target.value })} />
          </label>
          <label className="campo nova-comanda__mesa">
            Mesa (opcional)
            <input className="campo__grande" value={nova.mesaRotulo} maxLength={10} disabled={criando}
              onChange={(e) => setNova({ ...nova, mesaRotulo: e.target.value })} />
          </label>
          <button type="button" className="botao botao--contorno" disabled={criando} onClick={() => setNova(null)}>
            Cancelar
          </button>
          <button type="submit" className="botao" disabled={criando}>
            {criando ? 'Abrindo…' : 'Abrir comanda'}
          </button>
          {erroNova && <p className="erro nova-comanda__erro" role="alert">{erroNova}</p>}
        </form>
      )}

      {carregando ? (
        <p className="fila__vazia">Carregando…</p>
      ) : comandas.length === 0 ? (
        <p className="fila__vazia">Nenhuma comanda aberta. Toque em "+ Nova comanda" quando o cliente chegar.</p>
      ) : visiveis.length === 0 ? (
        <p className="fila__vazia">Nenhuma comanda com "{busca}".</p>
      ) : (
        <div className="salao__grade">
          {visiveis.map((c) => {
            const itens = contarItens(c);
            return (
              <button key={c.id} type="button" className="cartao-comanda" onClick={() => abrir(c.id)}>
                <span className="cartao-comanda__nome">{c.nomeCliente}</span>
                <span className="cartao-comanda__info">
                  #{c.numeroDia}
                  {c.mesaRotulo ? ` · Mesa ${c.mesaRotulo}` : ''}
                </span>
                <span className="cartao-comanda__total">{formatarPreco(c.totalCentavos)}</span>
                <span className="cartao-comanda__rodape">
                  <span>{itens === 0 ? 'sem itens' : `${itens} ${itens === 1 ? 'item' : 'itens'}`}</span>
                  <span>⏱ {tempoAberta(c.criadoEm, agora)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
