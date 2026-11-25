/**
 * Tema da retaguarda (lógica pura, testada).
 *
 * - Com loja (DONO, ou ADMIN com uma loja aberta): cor primária da loja nos
 *   destaques (menu, botões, abas), base clara da retaguarda (creme). Cor
 *   ilegível cai no TEMA_PADRAO do shared. A regra de contraste é a do shared
 *   (a mesma que a API usa para recusar a cor).
 * - Sem loja (login, ADMIN na plataforma: lojas, bairros, anúncios, exclusões):
 *   o estilo do Taaki Delivery (TEMA_TAAKI): menu azul-marinho, botões laranja
 *   com texto marinho, base neutra e o logo do Taaki. Erro e alerta continuam
 *   vermelhos nos dois casos (--cor-vermelho, fixo).
 */
import { TEMA_PADRAO, variaveisDoTema } from '@restaurante/shared/cores';

/**
 * Paleta do Taaki (a mesma da landing e das páginas legais da API): marinho
 * #0A1428, laranja #F26B1D, laranja claro #FD9502. Texto sobre o laranja é o
 * marinho (6:1; branco daria só 3:1); texto laranja na base clara usa o laranja
 * escurecido #B4470A (5,5:1).
 */
export const TEMA_TAAKI = Object.freeze({
  nome: TEMA_PADRAO.nome,
  variaveis: Object.freeze({
    '--cor-primaria': '#F26B1D',
    '--cor-primaria-texto': '#0A1428',
    '--cor-primaria-escura': '#0A1428',
    '--cor-primaria-escura-texto': '#FFFFFF',
    '--cor-primaria-suave': '#FEEBDD',
    '--cor-primaria-na-base': '#B4470A',
    '--cor-acao': '#F26B1D',
    '--cor-acao-hover': '#FD9502',
    '--cor-menu': '#0A1428',
    '--cor-menu-texto': '#FFFFFF',
    // Base neutra no lugar do creme/dourado da Cabana.
    '--cor-fundo': '#F5F7FA',
    '--cor-creme': '#EEF2F7',
    '--cor-dourado': '#F26B1D',
    '--cor-texto': '#0A1428',
    '--cor-texto-suave': '#4B5568',
    '--cor-borda': '#DCE2EA',
    '--cor-borda-forte': '#C9D1DD',
  }),
});

/** Logo do Taaki (URL do Vite, definida no main.jsx; os testes rodam sem o Vite). */
let logoTaaki = null;
export function definirLogoTaaki(url) {
  logoTaaki = url ?? null;
}

/**
 * @param {{ nome: string, logoUrl?: string | null, corPrimaria?: string | null } | null} loja
 * @returns {{ nome: string, logoUrl: string | null, taaki: boolean, variaveis: Record<string, string> }}
 */
export function temaDaLoja(loja) {
  if (!loja) return { nome: TEMA_TAAKI.nome, logoUrl: logoTaaki, taaki: true, variaveis: { ...TEMA_TAAKI.variaveis } };
  return {
    nome: loja.nome ?? TEMA_PADRAO.nome,
    logoUrl: loja.logoUrl ?? null,
    taaki: false,
    variaveis: variaveisDoTema(loja.corPrimaria ?? null),
  };
}

/** Favicon sem logo: quadrado na cor primária com a inicial (SVG em data:, liberado pela CSP). */
export function faviconDaInicial(nome, cor, texto) {
  const inicial = (String(nome ?? '').trim()[0] ?? 'D').toUpperCase().replace(/[<&>"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${cor}"/><text x="32" y="44" font-family="Arial,sans-serif" font-size="36" font-weight="700" text-anchor="middle" fill="${texto}">${inicial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Variáveis que algum tema pode pôr no documento (para tirar as que o tema novo não usa). */
const TODAS_AS_VARIAVEIS = new Set([...Object.keys(TEMA_TAAKI.variaveis), ...Object.keys(variaveisDoTema(null))]);

/**
 * Aplica o tema no documento: variáveis CSS (as que o tema não define voltam
 * ao tokens.css), `data-tema` no <html> ("taaki" ou "loja", para o CSS que não
 * é só variável), cor da barra do navegador e favicon.
 */
export function aplicarTema(loja, doc = document) {
  const tema = temaDaLoja(loja);
  const raiz = doc.documentElement;
  for (const nome of TODAS_AS_VARIAVEIS) if (!(nome in tema.variaveis)) raiz.style.removeProperty(nome);
  for (const [nome, valor] of Object.entries(tema.variaveis)) raiz.style.setProperty(nome, valor);
  raiz.dataset.tema = tema.taaki ? 'taaki' : 'loja';
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', tema.taaki ? TEMA_TAAKI.variaveis['--cor-menu'] : tema.variaveis['--cor-primaria-escura']);
  let link = doc.querySelector('link[rel="icon"]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.append(link);
  }
  link.removeAttribute('type');
  link.href = tema.logoUrl ?? faviconDaInicial(tema.nome, tema.variaveis['--cor-primaria'], tema.variaveis['--cor-primaria-texto']);
  return tema;
}
