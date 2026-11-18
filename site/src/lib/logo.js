// Logo compartilhada (site, PDV e ícone do instalador). Importada aqui para o
// Vite servir no dev e empacotar com hash no build, a partir de shared/assets.
import logoUrl from '../../../shared/assets/logo-cabana-boemia.jpg';

export { logoUrl };

/**
 * Usa a logo como favicon. O ícone da tela inicial (apple-touch-icon e os do
 * manifest) é quadrado e vem de /icones/ (site/scripts/gerar-icones.mjs).
 */
export function aplicarFavicon(doc = document) {
  const link = doc.createElement('link');
  link.rel = 'icon';
  link.href = logoUrl;
  link.type = 'image/jpeg';
  doc.head.append(link);
}
