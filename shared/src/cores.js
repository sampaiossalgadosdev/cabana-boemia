/**
 * Cor da identidade de cada loja (regra única para API, retaguarda, PDV e app;
 * pura e testada).
 *
 * A cor primária da loja aparece em botões, cabeçalho, menu e abas, sempre
 * sobre a base neutra (creme/branco) e com texto por cima. Por isso ela tem que:
 * - deixar o texto legível por cima: o texto é claro (#FFFFFF) ou escuro
 *   (#111111), o que der mais contraste, e precisa de pelo menos 4,5:1
 *   (WCAG AA, texto normal);
 * - aparecer sobre a base branca: pelo menos 3:1 contra o branco (WCAG 1.4.11,
 *   componentes de interface). Cor clara demais (amarelo, pastel) some na tela.
 * Cor que não passa nas duas é recusada (`avaliarCor(...).ok === false`).
 */

export const TEXTO_CLARO = '#FFFFFF';
export const TEXTO_ESCURO = '#111111';
export const BASE_CLARA = '#FFFFFF';
export const CONTRASTE_MINIMO_TEXTO = 4.5;
export const CONTRASTE_MINIMO_BASE = 3;

/** Tema padrão da plataforma (Taaki Delivery): sem loja escolhida ou loja sem cor. */
export const TEMA_PADRAO = Object.freeze({ nome: 'Taaki Delivery', corPrimaria: '#C8102E' });

/** Sugestões da tela "Perfil da loja" (todas passam em `avaliarCor`; testado). */
export const PALETA_SUGESTOES = Object.freeze([
  { nome: 'Vermelho', cor: '#C8102E' },
  { nome: 'Vinho', cor: '#7A1F3D' },
  { nome: 'Laranja queimado', cor: '#B3470F' },
  { nome: 'Marrom', cor: '#6B3E26' },
  { nome: 'Verde', cor: '#1E7B3C' },
  { nome: 'Verde-escuro', cor: '#14532D' },
  { nome: 'Azul-petróleo', cor: '#0E6170' },
  { nome: 'Azul', cor: '#1D4ED8' },
  { nome: 'Azul-marinho', cor: '#1E3A5F' },
  { nome: 'Roxo', cor: '#6D28D9' },
  { nome: 'Rosa', cor: '#BE185D' },
  { nome: 'Grafite', cor: '#374151' },
]);

/** "#c8102e", "C8102E", " #C8102E " → "#C8102E"; outra coisa → null. */
export function normalizarCor(valor) {
  const t = String(valor ?? '').trim().replace(/^#?/, '#');
  return /^#[0-9A-Fa-f]{6}$/.test(t) ? t.toUpperCase() : null;
}

function canais(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminância relativa (WCAG 2.x), 0 (preto) a 1 (branco). */
export function luminancia(hex) {
  const cor = normalizarCor(hex);
  if (!cor) return NaN;
  const [r, g, b] = canais(cor).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste entre duas cores (1 a 21). */
export function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

/** Texto que fica por cima da cor: claro ou escuro, o de maior contraste. */
export function textoSobre(cor) {
  return contraste(cor, TEXTO_CLARO) >= contraste(cor, TEXTO_ESCURO) ? TEXTO_CLARO : TEXTO_ESCURO;
}

/**
 * A cor serve como cor primária da loja?
 * @returns {{ ok: boolean, cor: string | null, texto: string | null, contrasteTexto: number, contrasteBase: number, motivo: string | null }}
 */
export function avaliarCor(valor) {
  const cor = normalizarCor(valor);
  if (!cor) return { ok: false, cor: null, texto: null, contrasteTexto: 0, contrasteBase: 0, motivo: 'Use a cor no formato #RRGGBB' };
  const texto = textoSobre(cor);
  const contrasteTexto = contraste(cor, texto);
  const contrasteBase = contraste(cor, BASE_CLARA);
  let motivo = null;
  if (contrasteBase < CONTRASTE_MINIMO_BASE) motivo = 'Cor clara demais: some sobre o fundo claro das telas. Escolha um tom mais escuro.';
  else if (contrasteTexto < CONTRASTE_MINIMO_TEXTO) motivo = 'Com esta cor o texto dos botões fica difícil de ler. Escolha um tom mais escuro.';
  const arred = (x) => Math.round(x * 100) / 100;
  return { ok: motivo === null, cor, texto, contrasteTexto: arred(contrasteTexto), contrasteBase: arred(contrasteBase), motivo };
}

const hex2 = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** Mistura `cor` com `com` (0 = só a cor, 1 = só `com`). */
export function misturar(cor, com, quanto) {
  const a = canais(normalizarCor(cor));
  const b = canais(normalizarCor(com));
  return `#${a.map((c, i) => hex2(c + (b[i] - c) * quanto)).join('')}`.toUpperCase();
}

/**
 * A cor para TEXTO sobre a base clara (link, aba ativa, título): a própria cor
 * se já dá 4,5:1 contra o branco; senão, escurecida até dar.
 */
export function corParaTextoNaBase(cor) {
  const c = normalizarCor(cor);
  if (!c) return TEXTO_ESCURO;
  for (let q = 0; q <= 1; q += 0.05) {
    const tom = q === 0 ? c : misturar(c, '#000000', q);
    if (contraste(tom, BASE_CLARA) >= CONTRASTE_MINIMO_TEXTO) return tom;
  }
  return TEXTO_ESCURO;
}

/**
 * Variáveis CSS do tema de uma loja (retaguarda e PDV). Cor inválida ou
 * ilegível cai no tema padrão. `--cor-acao-texto` é o texto por cima da cor.
 * @returns {Record<string, string>}
 */
export function variaveisDoTema(corPrimaria) {
  const avaliacao = avaliarCor(corPrimaria);
  const cor = avaliacao.ok ? avaliacao.cor : TEMA_PADRAO.corPrimaria;
  const texto = textoSobre(cor);
  const escura = misturar(cor, '#000000', 0.22);
  return {
    '--cor-primaria': cor,
    '--cor-primaria-escura': escura,
    '--cor-primaria-suave': misturar(cor, '#FFFFFF', 0.88),
    '--cor-primaria-texto': texto,
    '--cor-primaria-na-base': corParaTextoNaBase(cor),
    // Texto sobre a cor escura (menu): o mesmo critério.
    '--cor-primaria-escura-texto': textoSobre(escura),
  };
}
