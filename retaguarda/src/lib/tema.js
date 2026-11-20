/**
 * Tema da retaguarda por loja (lógica pura, testada): cor primária da loja nos
 * destaques (menu, botões, abas), base neutra. Sem loja (ADMIN na plataforma)
 * ou cor ilegível: o tema padrão do Delivery Abatiá. A regra de contraste é a
 * do shared (a mesma que a API usa para recusar a cor).
 */
import { TEMA_PADRAO, variaveisDoTema } from '@restaurante/shared/cores';

/**
 * @param {{ nome: string, logoUrl?: string | null, corPrimaria?: string | null } | null} loja
 * @returns {{ nome: string, logoUrl: string | null, variaveis: Record<string, string> }}
 */
export function temaDaLoja(loja) {
  return {
    nome: loja?.nome ?? TEMA_PADRAO.nome,
    logoUrl: loja?.logoUrl ?? null,
    variaveis: variaveisDoTema(loja?.corPrimaria ?? null),
  };
}

/** Favicon sem logo: quadrado na cor primária com a inicial (SVG em data:, liberado pela CSP). */
export function faviconDaInicial(nome, cor, texto) {
  const inicial = (String(nome ?? '').trim()[0] ?? 'D').toUpperCase().replace(/[<&>"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${cor}"/><text x="32" y="44" font-family="Arial,sans-serif" font-size="36" font-weight="700" text-anchor="middle" fill="${texto}">${inicial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Aplica o tema no documento: variáveis CSS, favicon e o título base. */
export function aplicarTema(loja, doc = document) {
  const tema = temaDaLoja(loja);
  for (const [nome, valor] of Object.entries(tema.variaveis)) doc.documentElement.style.setProperty(nome, valor);
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
