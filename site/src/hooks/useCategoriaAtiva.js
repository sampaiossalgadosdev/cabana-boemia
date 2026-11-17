import { useCallback, useEffect, useRef, useState } from 'react';

export const idSecao = (categoriaId) => `categoria-${categoriaId}`;

/**
 * Aba ativa acompanha a rolagem (IntersectionObserver). Ao tocar numa aba,
 * rola até a seção e ignora o observer até a rolagem assentar.
 * `visivel` = false enquanto outra aba (Pedidos/Perfil) desmonta as seções:
 * ao voltar ao Início o observer é refeito com as seções novas.
 */
export function useCategoriaAtiva(categorias, visivel = true) {
  const [ativa, setAtiva] = useState(categorias[0]?.id ?? null);
  const travadoAte = useRef(0);
  const chave = categorias.map((c) => c.id).join(',');

  useEffect(() => {
    if (!categorias.length || !visivel) return undefined;
    setAtiva((a) => (categorias.some((c) => c.id === a) ? a : categorias[0].id));

    const observer = new IntersectionObserver(
      (entradas) => {
        if (Date.now() < travadoAte.current) return;
        const visivel = entradas
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visivel) setAtiva(Number(visivel.target.dataset.categoria));
      },
      // Faixa logo abaixo das abas fixas.
      { rootMargin: '-64px 0px -65% 0px' },
    );
    for (const c of categorias) {
      const el = document.getElementById(idSecao(c.id));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [chave, visivel]); // `chave` resume `categorias`: só refaz quando as seções mudam

  const irPara = useCallback((categoriaId) => {
    setAtiva(categoriaId);
    travadoAte.current = Date.now() + 800;
    const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(idSecao(categoriaId))
      ?.scrollIntoView({ behavior: reduzir ? 'auto' : 'smooth', block: 'start' });
  }, []);

  return { ativa, irPara };
}
