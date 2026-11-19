/**
 * Tema do app: TODA cor, fonte, raio e a logo saem daqui. Componentes nunca
 * escrevem cor solta: leem `useTema()`. No multi-loja, cada loja terá o seu
 * objeto com o mesmo formato (vindo da API ou de um arquivo por loja) e o
 * <TemaProvider tema={...}> troca tudo de uma vez.
 *
 * Por enquanto: Cabana Boemia (CLAUDE.md › Identidade visual; os mesmos
 * valores de site/src/estilos/tokens.css).
 */
import { createContext, createElement, useContext, useMemo } from 'react';

const marcaCabana = {
  vermelho: '#C8102E',
  vermelhoEscuro: '#9E0B22',
  dourado: '#C9A646',
  preto: '#111111',
  creme: '#FBF3E8',
  laranja: '#D9541E',
  branco: '#FFFFFF',
};

/** @typedef {typeof temaCabana} Tema */
export const temaCabana = {
  id: 'cabana-boemia',
  nome: 'Cabana Boemia',
  // Laço recortado (PNG transparente); trocar pela logo oficial quando chegar.
  logo: require('../../../shared/assets/logo-cabana-boemia-recorte.png'),
  marca: marcaCabana,
  cores: {
    fundo: marcaCabana.creme,
    superficie: marcaCabana.branco,
    texto: marcaCabana.preto,
    textoSuave: '#5E5249',
    textoInverso: marcaCabana.creme,
    borda: '#EADED0',
    preco: marcaCabana.vermelhoEscuro,
    acao: marcaCabana.vermelho,
    acaoPressionada: marcaCabana.vermelhoEscuro,
    textoAcao: marcaCabana.branco,
    destaque: marcaCabana.dourado,
    cabecalho: marcaCabana.vermelho,
    desabilitado: '#D9D2C9',
    textoDesabilitado: '#6E655D',
    avisoFundo: '#FBE5DA',
    aviso: marcaCabana.laranja,
    sucesso: '#2E7D4F',
    sombra: marcaCabana.preto,
    placeholder: '#F3EADF',
  },
  fontes: {
    // undefined = fonte do sistema (Roboto no Android, SF no iOS), como o site.
    base: undefined,
    // Nome da loja: o site usa Dancing Script; no app entra quando a fonte for carregada (expo-font).
    marca: undefined,
    tamanho: { pequeno: 13, normal: 15, medio: 17, grande: 20, titulo: 24 },
    peso: { normal: '400', medio: '600', forte: '700', pesado: '800' },
  },
  raio: { normal: 14, pequeno: 10, pilula: 999 },
  espaco: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
};

const TemaContext = createContext(temaCabana);

export function TemaProvider({ tema = temaCabana, children }) {
  return createElement(TemaContext.Provider, { value: tema }, children);
}

/** @returns {Tema} */
export const useTema = () => useContext(TemaContext);

/**
 * Estilos que dependem do tema: `const s = useEstilos(criarEstilos)`, com
 * `criarEstilos = (tema) => StyleSheet.create({...})` fora do componente.
 */
export function useEstilos(fabrica) {
  const tema = useTema();
  return useMemo(() => fabrica(tema), [fabrica, tema]);
}
