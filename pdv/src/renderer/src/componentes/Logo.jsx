import { useState } from 'react';
// Logo compartilhada (site, PDV e instalador): importada de shared/assets,
// nunca copiada. O Vite empacota com hash no build.
import logoUrl from '../../../../../shared/assets/logo-cabana-boemia.jpg';
// Recorte só do laço (sem o fundo de papel nem a sombra do canto), PNG transparente.
import logoRecorteUrl from '../../../../../shared/assets/logo-cabana-boemia-recorte.png';

/**
 * Logo do restaurante; se a imagem falhar, o nome em texto.
 * `recorte`: só o laço, sem fundo (painel do delivery).
 */
export function Logo({ className = '', recorte = false }) {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return <span className={`logo logo--texto ${className}`}>Cabana Boemia</span>;
  return (
    <img
      className={`logo ${className}`}
      src={recorte ? logoRecorteUrl : logoUrl}
      alt="Cabana Boemia"
      width={recorte ? 760 : 811}
      height={recorte ? 258 : 344}
      onError={() => setFalhou(true)}
    />
  );
}
