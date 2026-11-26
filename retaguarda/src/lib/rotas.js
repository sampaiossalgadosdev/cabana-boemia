import { useCallback, useEffect, useState } from 'react';

/** Telas de uma loja (caminho sob /admin). A primeira é a inicial. */
export const TELAS_LOJA = [
  { caminho: 'cardapio-do-dia', titulo: 'Cardápio do dia' },
  { caminho: 'relatorio', titulo: 'Relatório do dia' },
  { caminho: 'produtos', titulo: 'Produtos' },
  { caminho: 'categorias', titulo: 'Categorias' },
  { caminho: 'estoque', titulo: 'Estoque' },
  { caminho: 'turnos', titulo: 'Turnos e horários' },
  { caminho: 'bairros', titulo: 'Bairros e taxas' },
  { caminho: 'equipe', titulo: 'Equipe' },
  { caminho: 'perfil', titulo: 'Perfil da loja' },
  { caminho: 'pagamento-online', titulo: 'Pagamento online' },
  { caminho: 'configuracoes', titulo: 'Configurações' },
];

/** Telas da plataforma (só ADMIN, sem loja escolhida). */
export const TELAS_PLATAFORMA = [
  { caminho: 'lojas', titulo: 'Lojas' },
  { caminho: 'bairros-cidade', titulo: 'Bairros da cidade' },
  { caminho: 'anuncios', titulo: 'Anúncios' },
  { caminho: 'exclusoes', titulo: 'Exclusão de contas' },
  { caminho: 'alertas', titulo: 'Alertas' },
  { caminho: 'pagamentos', titulo: 'Pagamentos online' },
];

/** Todas (para reconhecer o caminho). */
export const TELAS = [...TELAS_LOJA, ...TELAS_PLATAFORMA];

/**
 * Telas do menu: DONO = as da loja; ADMIN sem loja = as da plataforma; ADMIN
 * numa loja = as da loja (volta à plataforma pelo seletor).
 */
export function telasDoMenu(papel, lojaAberta) {
  if (papel === 'ADMIN' && !lojaAberta) return TELAS_PLATAFORMA;
  return TELAS_LOJA;
}

/** A tela pedida, se está no menu; senão a primeira do menu. */
export function telaPermitida(tela, menu) {
  return menu.some((t) => t.caminho === tela) ? tela : menu[0].caminho;
}

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
