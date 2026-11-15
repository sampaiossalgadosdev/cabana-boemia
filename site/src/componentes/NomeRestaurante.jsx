import { useState } from 'react';
import { logoUrl } from '../lib/logo.js';

/**
 * Nome do restaurante: a logo; se a imagem falhar, o nome em Dancing Script
 * (único lugar com fonte cursiva).
 */
export function NomeRestaurante() {
  const [falhou, setFalhou] = useState(false);
  return (
    <h1 className="nome-restaurante">
      {falhou ? (
        'Cabana Boemia'
      ) : (
        <img
          className="nome-restaurante__logo"
          src={logoUrl}
          alt="Cabana Boemia"
          width="811"
          height="344"
          onError={() => setFalhou(true)}
        />
      )}
    </h1>
  );
}
