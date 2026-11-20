/** Logo enviada pela retaguarda (a API confere de novo pelos bytes). */
export const MAX_LOGO_BYTES = 500 * 1024;
export const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp'];

/** Problema do arquivo escolhido, ou null. */
export function problemaDoArquivo(arquivo) {
  if (!TIPOS_LOGO.includes(arquivo.type)) return 'Use uma imagem PNG, JPEG ou WebP.';
  if (arquivo.size > MAX_LOGO_BYTES) return 'A logo pode ter no máximo 500 KB.';
  return null;
}
