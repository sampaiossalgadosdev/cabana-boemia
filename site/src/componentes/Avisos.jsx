import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const DURACAO_MS = 7000;
const AvisosContext = createContext(null);

/** Avisos temporários (ex.: item removido do carrinho, preço alterado). */
export function AvisosProvider({ children }) {
  const [avisos, setAvisos] = useState([]);
  const proximoId = useRef(1);
  const timers = useRef(new Map());

  const fechar = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setAvisos((lista) => lista.filter((a) => a.id !== id));
  }, []);

  const avisar = useCallback(
    (texto) => {
      const id = proximoId.current++;
      setAvisos((lista) => [...lista, { id, texto }]);
      timers.current.set(id, setTimeout(() => fechar(id), DURACAO_MS));
    },
    [fechar],
  );

  useEffect(() => {
    const ativos = timers.current;
    return () => ativos.forEach(clearTimeout);
  }, []);

  const valor = useMemo(() => ({ avisar }), [avisar]);

  return (
    <AvisosContext.Provider value={valor}>
      {children}
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className="aviso">
            <p>{a.texto}</p>
            <button type="button" onClick={() => fechar(a.id)} aria-label="Fechar aviso">
              ×
            </button>
          </div>
        ))}
      </div>
    </AvisosContext.Provider>
  );
}

export function useAvisos() {
  const ctx = useContext(AvisosContext);
  if (!ctx) throw new Error('useAvisos fora do AvisosProvider');
  return ctx;
}
