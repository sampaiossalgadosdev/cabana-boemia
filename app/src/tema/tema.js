/**
 * Tema do app: TODA cor, fonte, raio e a logo saem daqui. Componentes nunca
 * escrevem cor solta: leem `useTema()`. No multi-loja, cada loja terá o seu
 * objeto com o mesmo formato (vindo da API ou de um arquivo por loja) e o
 * <TemaProvider tema={...}> troca tudo de uma vez.
 *
 * Base: as cores do CLAUDE.md › Identidade visual (as mesmas de
 * site/src/estilos/tokens.css). Cada loja troca a cor primária e a logo
 * (`temaDaLoja`, dados da API).
 */
import { createContext, createElement, useContext, useMemo } from 'react';
import { BASE } from '../lib/api.js';
import { coresDaLoja, urlDaImagem } from '../logica/lojas.js';

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
    // Etiqueta "Patrocinado" sobre a imagem do anúncio (legível sobre qualquer foto).
    sobreImagemFundo: 'rgba(17,17,17,0.78)',
    sobreImagemTexto: marcaCabana.branco,
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

/**
 * Tema padrão do app (vitrine, abas, login): Delivery do Batiá, com as cores do
 * ícone/splash provisórios (as mesmas da Cabana) e sem logo (mostra o nome).
 */
export const temaPadrao = { ...temaCabana, id: 'delivery-abatia', nome: 'Delivery do Batiá', logo: null };

/**
 * Tema de uma loja (página da loja, produto, sacola e checkout): cor primária
 * e logo vindas da API (`/publico/lojas/:slug/config`); a base (fundo, texto,
 * bordas) continua a do app. Sem cor legível: as cores do padrão.
 */
export function temaDaLoja(loja) {
  if (!loja) return temaPadrao;
  const url = urlDaImagem(loja.logoUrl, BASE);
  return {
    ...temaPadrao,
    id: loja.slug ?? temaPadrao.id,
    nome: loja.nome || temaPadrao.nome,
    logo: url ? { uri: url } : null,
    cores: coresDaLoja(loja, temaPadrao.cores),
  };
}

const TemaContext = createContext(temaPadrao);

export function TemaProvider({ tema = temaPadrao, children }) {
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
