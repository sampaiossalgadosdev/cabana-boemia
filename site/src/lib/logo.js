// Logo compartilhada (site, PDV e ícone do instalador). Importada aqui para o
// Vite servir no dev e empacotar com hash no build, a partir de shared/assets.
import logoUrl from '../../../shared/assets/logo-cabana-boemia.jpg';

export { logoUrl };

/** Usa a logo como favicon e ícone da tela inicial (iOS). */
export function aplicarFavicon(doc = document) {
  for (const rel of ['icon', 'apple-touch-icon']) {
    const link = doc.createElement('link');
    link.rel = rel;
    link.href = logoUrl;
    if (rel === 'icon') link.type = 'image/jpeg';
    doc.head.append(link);
  }
}
