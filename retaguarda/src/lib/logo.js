// Logo compartilhada (site, PDV, retaguarda). Importada de shared/assets para
// o Vite servir no dev e empacotar com hash no build.
import logoUrl from '../../../shared/assets/logo-cabana-boemia.jpg';

export { logoUrl };

/** Usa a logo como favicon. */
export function aplicarFavicon(doc = document) {
  const link = doc.createElement('link');
  link.rel = 'icon';
  link.type = 'image/jpeg';
  link.href = logoUrl;
  doc.head.append(link);
}
