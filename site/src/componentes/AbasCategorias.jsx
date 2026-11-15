import { useEffect, useRef } from 'react';

export function AbasCategorias({ categorias, ativa, onSelecionar }) {
  const lista = useRef(null);

  // Mantém a aba ativa visível na faixa rolável.
  useEffect(() => {
    lista.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [ativa]);

  return (
    <nav className="abas" aria-label="Categorias do cardápio">
      <div className="abas__lista" ref={lista}>
        {categorias.map((c) => (
          <button
            key={c.id}
            type="button"
            className="aba"
            aria-current={c.id === ativa ? 'true' : undefined}
            onClick={() => onSelecionar(c.id)}
          >
            {c.nome}
          </button>
        ))}
      </div>
    </nav>
  );
}
