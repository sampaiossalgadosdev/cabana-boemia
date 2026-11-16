import { useCallback, useEffect, useState } from 'react';

/** Telas da retaguarda (caminho sob /admin). A primeira é a inicial. */
export const TELAS = [
  { caminho: 'cardapio-do-dia', titulo: 'Cardápio do dia' },
  { caminho: 'produtos', titulo: 'Produtos' },
  { caminho: 'categorias', titulo: 'Categorias' },
  { caminho: 'estoque', titulo: 'Estoque' },
  { caminho: 'turnos', titulo: 'Turnos e horários' },
  { caminho: 'bairros', titulo: 'Bairros e taxas' },
  { caminho: 'equipe', titulo: 'Equipe' },
  { caminho: 'configuracoes', titulo: 'Configurações' },
];

const BASE = import.meta.env.BASE_URL ?? '/admin/'; // "/admin/"

/** "/admin/produtos" → "produtos"; desconhecido → a primeira tela. */
export function telaDoCaminho(pathname) {
  const resto = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '');
  const caminho = resto.split('/')[0];
  return TELAS.some((t) => t.caminho === caminho) ? caminho : TELAS[0].caminho;
}

/** Roteador mínimo com a History API (sem biblioteca). */
export function useRota() {
  const [tela, setTela] = useState(() => telaDoCaminho(window.location.pathname));
  useEffect(() => {
    const aoVoltar = () => setTela(telaDoCaminho(window.location.pathname));
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, []);
  const ir = useCallback((caminho) => {
    if (`${BASE}${caminho}` !== window.location.pathname) window.history.pushState(null, '', `${BASE}${caminho}`);
    setTela(caminho);
    window.scrollTo(0, 0);
  }, []);
  return [tela, ir];
}
