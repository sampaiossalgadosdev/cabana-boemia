import { useEffect, useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { resumoImpressao } from '../lib/impressao.js';
import { PainelImpressora } from './PainelImpressora.jsx';

export function IndicadorImpressora() {
  const [status, setStatus] = useState(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    chamar(pdv.impressao.status()).then(setStatus, () => {});
    return pdv.aoEvento('impressao:status', setStatus);
  }, []);

  const r = resumoImpressao(status);
  return (
    <>
      <button
        type="button"
        className={`conexao impressora impressora--${r.classe}`}
        title={r.dica ? `${r.dica} — clique para configurar` : 'Configurar a impressora'}
        onClick={() => setAberto(true)}
      >
        <span className="conexao__ponto" aria-hidden="true" />
        <span role="status">{r.texto}</span>
      </button>
      {aberto && <PainelImpressora status={status} aoFechar={() => setAberto(false)} />}
    </>
  );
}
