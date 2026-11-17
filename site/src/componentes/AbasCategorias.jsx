import { useEffect, useRef } from 'react';

export function AbasCategorias({ categorias, ativa, onSelecionar }) {
  const lista = useRef(null);

  // Mantém a aba ativa visível na faixa rolável. Rola SÓ a faixa (horizontal):
  // scrollIntoView numa faixa sticky também rolava a página (~50 px para cima
  // no fim do cardápio, escondendo o final atrás da barra da sacola).
  useEffect(() => {
    const faixa = lista.current;
    const aba = faixa?.querySelector('[aria-current="true"]');
    if (!aba) return;
    const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    faixa.scrollTo({
      left: aba.offsetLeft - (faixa.clientWidth - aba.offsetWidth) / 2,
      behavior: reduzir ? 'auto' : 'smooth',
    });
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
