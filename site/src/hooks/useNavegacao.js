import { useCallback, useEffect, useState } from 'react';
import { abaDoCaminho, caminhoDaAba } from '../lib/navegacao.js';

/** Aba atual ligada à URL (history.pushState + popstate). */
export function useNavegacao() {
  const [aba, setAba] = useState(() => abaDoCaminho(window.location.pathname));

  useEffect(() => {
    const aoVoltar = () => setAba(abaDoCaminho(window.location.pathname));
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, []);

  const irPara = useCallback((id) => {
    const caminho = caminhoDaAba(id);
    if (window.location.pathname !== caminho) window.history.pushState(null, '', caminho);
    setAba(id);
    window.scrollTo(0, 0);
  }, []);

  return { aba, irPara };
}
