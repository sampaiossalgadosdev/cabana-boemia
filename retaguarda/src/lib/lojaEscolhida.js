/**
 * Loja que o ADMIN abriu na retaguarda (slug), mandada no cabeçalho X-Loja.
 * DONO não usa: a API já sabe a loja dele. Guardada no localStorage (com
 * try/catch) para recarregar a página na mesma loja.
 */
export const CHAVE_LOJA = 'cabana-boemia:retaguarda:loja:v1';

let atual = null;

function armazenamento() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Slug da loja escolhida (ou null = plataforma). */
export const lojaEscolhida = () => atual;

export function escolherLoja(slug) {
  atual = slug || null;
  try {
    if (atual) armazenamento()?.setItem(CHAVE_LOJA, atual);
    else armazenamento()?.removeItem(CHAVE_LOJA);
  } catch {
    // sem armazenamento: vale enquanto a aba estiver aberta
  }
}

/** Ao abrir a página (só para o ADMIN). */
export function lembrarLoja() {
  try {
    atual = armazenamento()?.getItem(CHAVE_LOJA) || null;
  } catch {
    atual = null;
  }
  return atual;
}
