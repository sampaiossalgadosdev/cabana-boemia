import { useState } from 'react';
// Logo compartilhada (site, PDV e instalador): importada de shared/assets,
// nunca copiada. O Vite empacota com hash no build.
import logoUrl from '../../../../../shared/assets/logo-cabana-boemia.jpg';

/** Logo do restaurante; se a imagem falhar, o nome em texto. */
export function Logo({ className = '' }) {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return <span className={`logo logo--texto ${className}`}>Cabana Boemia</span>;
  return (
    <img
      className={`logo ${className}`}
      src={logoUrl}
      alt="Cabana Boemia"
      width="811"
      height="344"
      onError={() => setFalhou(true)}
    />
  );
}
