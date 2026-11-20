import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { centavosParaCampo, lerReais } from '../lib/dinheiro.js';

// ───────── Avisos flutuantes ─────────

const AvisosContexto = createContext(() => {});

export function AvisosProvider({ children }) {
  const [avisos, setAvisos] = useState([]);
  const avisar = useCallback((texto, tipo = 'ok') => {
    const id = Math.random();
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'erro' ? 6000 : 3000);
  }, []);
  return (
    <AvisosContexto.Provider value={avisar}>
      {children}
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso${a.tipo === 'erro' ? ' aviso--erro' : ''}`}>
            {a.texto}
          </div>
        ))}
      </div>
    </AvisosContexto.Provider>
  );
}

/** avisar(texto, 'ok' | 'erro') */
export const useAvisar = () => useContext(AvisosContexto);

// ───────── Diálogo com formulário ─────────

/**
 * <dialog> nativo (foco preso, Esc fecha). O conteúdo é um <form>: Enter
 * envia. `aoEnviar` recebe o evento já com preventDefault.
 */
export function Dialogo({ aberto, titulo, aoFechar, aoEnviar, rodape, largo = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      className={`dialogo${largo ? ' dialogo--largo' : ''}`}
      aria-label={titulo}
      onCancel={(e) => {
        e.preventDefault();
        aoFechar();
      }}
    >
      {aberto && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            aoEnviar?.(e);
          }}
        >
          <div className="dialogo__topo">
            <h2 className="dialogo__titulo">{titulo}</h2>
            <button type="button" className="dialogo__fechar" onClick={aoFechar} aria-label="Fechar">
              ×
            </button>
          </div>
          <div className="dialogo__corpo">{children}</div>
          {rodape && <div className="dialogo__rodape">{rodape}</div>}
        </form>
      )}
    </dialog>
  );
}

/** Confirmação simples ("Desativar Ana?"). */
export function Confirmar({ pedido, aoFechar }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setErro('');
    setOcupado(false);
  }, [pedido]);
  return (
    <Dialogo
      aberto={Boolean(pedido)}
      titulo={pedido?.titulo ?? ''}
      aoFechar={aoFechar}
      aoEnviar={async () => {
        setOcupado(true);
        setErro('');
        try {
          await pedido.acao();
          aoFechar();
        } catch (err) {
          setErro(err.message);
          setOcupado(false);
        }
      }}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Voltar
          </button>
          <button type="submit" className="botao botao--primario" disabled={ocupado}>
            {ocupado ? 'Aguarde…' : (pedido?.confirmar ?? 'Confirmar')}
          </button>
        </>
      }
    >
      {erro && <div className="alerta">{erro}</div>}
      <p style={{ marginTop: 0 }}>{pedido?.texto}</p>
    </Dialogo>
  );
}

// ───────── Campos ─────────

/** Rótulo + controle + ajuda/erro. `children(id)` recebe o id para o controle. */
export function Campo({ rotulo, ajuda, erro, className = '', children }) {
  const id = useId();
  return (
    <div className={`campo ${className}`}>
      <label className="campo__rotulo" htmlFor={id}>
        {rotulo}
      </label>
      {children(id, erro ? `${id}-erro` : undefined)}
      {erro ? (
        <span id={`${id}-erro`} className="campo__erro">
          {erro}
        </span>
      ) : (
        ajuda && <span className="campo__ajuda">{ajuda}</span>
      )}
    </div>
  );
}

/**
 * Campo em reais que guarda o texto digitado e devolve centavos (ou null
 * se inválido) em `aoMudar(centavos, texto)`.
 */
export function CampoDinheiro({ id, valor, aoMudar, invalido, descritoPor, ...resto }) {
  const [texto, setTexto] = useState(() => centavosParaCampo(valor));
  const ultimo = useRef(valor);
  useEffect(() => {
    if (valor !== ultimo.current) {
      ultimo.current = valor;
      setTexto(centavosParaCampo(valor));
    }
  }, [valor]);
  return (
    <input
      id={id}
      className="entrada entrada--dinheiro entrada--curta"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0,00"
      value={texto}
      aria-invalid={invalido || undefined}
      aria-describedby={descritoPor}
      onChange={(e) => {
        setTexto(e.target.value);
        const c = lerReais(e.target.value);
        ultimo.current = c;
        aoMudar(c, e.target.value);
      }}
      onBlur={() => {
        const c = lerReais(texto);
        if (c != null) setTexto(centavosParaCampo(c));
      }}
      {...resto}
    />
  );
}

/** Interruptor liga/desliga (checkbox com role="switch"). */
export function Interruptor({ ligado, aoMudar, rotulo, ocultarRotulo = false, desabilitado = false }) {
  return (
    <label className="interruptor">
      <input
        type="checkbox"
        role="switch"
        checked={ligado}
        disabled={desabilitado}
        onChange={(e) => aoMudar(e.target.checked)}
      />
      <span className={ocultarRotulo ? 'visualmente-oculto' : undefined}>{rotulo}</span>
    </label>
  );
}

// ───────── Estados de carga ─────────

/**
 * Carrega dados ao montar e expõe `recarregar`. Mantém os dados atuais
 * durante a recarga (sem piscar a tela).
 */
export function useCarregar(buscar, deps = []) {
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: true });
  const vivo = useRef(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recarregar = useCallback(async () => {
    setEstado((e) => ({ ...e, carregando: true }));
    try {
      const dados = await buscar();
      if (vivo.current) setEstado({ dados, erro: null, carregando: false });
      return dados;
    } catch (erro) {
      if (vivo.current) setEstado((e) => ({ ...e, erro, carregando: false }));
      return null;
    }
  }, deps);
  useEffect(() => {
    vivo.current = true;
    recarregar();
    return () => {
      vivo.current = false;
    };
  }, [recarregar]);
  return { ...estado, recarregar };
}

/** Carregando / erro com "Tentar de novo" antes de ter dados. */
export function EstadoCarga({ carga, children }) {
  if (carga.dados) return children(carga.dados);
  if (carga.erro) {
    return (
      <div className="estado">
        <p>{carga.erro.message}</p>
        <button type="button" className="botao" onClick={carga.recarregar}>
          Tentar de novo
        </button>
      </div>
    );
  }
  return <div className="estado">Carregando…</div>;
}

// ───────── Logo ─────────

/** Logo da loja (enviada na retaguarda); sem logo ou se a imagem falhar, o nome. */
export function LogoLoja({ nome, logoUrl, className }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [logoUrl]);
  if (!logoUrl || falhou) return <div className={`menu__nome ${className ?? ''}`}>{nome}</div>;
  return <img className={className} src={logoUrl} alt={nome} onError={() => setFalhou(true)} />;
}
