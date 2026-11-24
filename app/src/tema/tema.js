/**
 * Tema do app: TODA cor, fonte, raio e a logo saem daqui. Componentes nunca
 * escrevem cor solta: leem `useTema()`. No multi-loja, cada loja terá o seu
 * objeto com o mesmo formato (vindo da API ou de um arquivo por loja) e o
 * <TemaProvider tema={...}> troca tudo de uma vez.
 *
 * Base: a paleta do Taaki Delivery (do logo): azul-marinho, laranja, laranja
 * claro, branco e o destaque vermelho (pouco: só erro e alerta). Cada loja
 * troca a cor primária e a logo (`temaDaLoja`, dados da API); fundo, texto,
 * bordas e erro continuam os do Taaki.
 */
import { createContext, createElement, useContext, useMemo } from 'react';
import { BASE } from '../lib/api.js';
import { coresDaLoja, urlDaImagem } from '../logica/lojas.js';
import { coresTaaki, marcaTaaki } from './paleta.js';

export { marcaTaaki };

/** Logo do Taaki (círculo; o JPEG tem os cantos pretos: mostrar sempre recortado em círculo). */
export const LOGO_TAAKI = require('../../../shared/assets/logo-taaki-320.jpg');

/**
 * Tema padrão do app (vitrine, abas, login, aceite, nome, Sobre): Taaki
 * Delivery. `logo: null` = o cabeçalho de loja mostra o nome (a logo do Taaki
 * entra pelo componente MarcaTaaki, não pelo tema).
 * @typedef {typeof temaPadrao} Tema
 */
export const temaPadrao = {
  id: 'delivery-abatia',
  nome: 'Taaki Delivery',
  logo: null,
  marca: marcaTaaki,
  cores: coresTaaki,
  fontes: {
    // undefined = fonte do sistema (Roboto no Android, SF no iOS), como o site.
    base: undefined,
    // Nome da loja: entra quando a fonte da marca for carregada (expo-font).
    marca: undefined,
    tamanho: { pequeno: 13, normal: 15, medio: 17, grande: 20, titulo: 24 },
    peso: { normal: '400', medio: '600', forte: '700', pesado: '800' },
  },
  raio: { normal: 14, pequeno: 10, pilula: 999 },
  espaco: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
};

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
