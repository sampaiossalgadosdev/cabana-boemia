/**
 * Carrossel "Patrocinado" do Início (GET /publico/anuncios). Sem React Native:
 * testado no Node. Nada é medido no aparelho (sem impressão nem clique
 * registrados): o mesmo carrossel para todos.
 */
import { urlDaImagem } from './lojas.js';

/** Etiqueta que aparece em todo anúncio, sempre visível. */
export const ETIQUETA_ANUNCIO = 'Patrocinado';

const ehHttps = (url) => typeof url === 'string' && /^https:\/\/\S+$/.test(url);

/**
 * Para onde o toque leva: a página da loja no app ou um link https (aberto no
 * navegador). Destino estranho (link sem https, loja sem slug) = null.
 * @returns {{ tipo: 'loja', caminho: string } | { tipo: 'link', url: string } | null}
 */
export function acaoDoAnuncio(anuncio) {
  const d = anuncio?.destino;
  if (d?.tipo === 'LOJA' && typeof d.slug === 'string' && /^[a-z0-9-]+$/.test(d.slug)) return { tipo: 'loja', caminho: `/loja/${d.slug}` };
  if (d?.tipo === 'LINK' && ehHttps(d.url)) return { tipo: 'link', url: d.url };
  return null;
}

/**
 * Anúncios que dá para mostrar (imagem e destino válidos), com a URL completa
 * da imagem. `base` = base da API (a imagem vem como caminho relativo).
 */
export function anunciosParaMostrar(lista, base) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map((a) => ({ ...a, imagem: urlDaImagem(a?.imagemUrl, base), acao: acaoDoAnuncio(a) }))
    .filter((a) => a.id != null && a.imagem && a.acao);
}

/** Leitor de tela: "Patrocinado: Mercado do Zé. Abre a loja Mercado do Zé." */
export function rotuloDoAnuncio(a) {
  const destino = a.acao?.tipo === 'loja' ? `Abre a loja ${a.destino.nome ?? ''}`.trim() : 'Abre o site do anunciante';
  return `${ETIQUETA_ANUNCIO}: ${a.anunciante}. ${destino}.`;
}
