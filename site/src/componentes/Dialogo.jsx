import { useEffect, useRef } from 'react';

/**
 * <dialog> nativo (foco preso, Esc fecha, fundo inerte). Toque fora do
 * conteúdo também fecha. `onFechar` é chamado em qualquer forma de fechar.
 */
export function Dialogo({ aberto, titulo, onFechar, rodape, children }) {
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
      className="dialogo"
      aria-label={titulo}
      onClose={onFechar}
      onClick={(e) => {
        if (e.target === ref.current) onFechar();
      }}
    >
      {aberto && (
        <>
          <div className="dialogo__topo">
            <h2 className="dialogo__titulo">{titulo}</h2>
            <button type="button" className="dialogo__fechar" onClick={onFechar} aria-label="Fechar">
              ×
            </button>
          </div>
          <div className="dialogo__corpo">{children}</div>
          {rodape && <div className="dialogo__rodape">{rodape}</div>}
        </>
      )}
    </dialog>
  );
}
