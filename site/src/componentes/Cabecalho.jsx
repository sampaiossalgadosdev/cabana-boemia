import { NomeRestaurante } from './NomeRestaurante.jsx';
import { quandoAbre } from '../lib/horario.js';
import { InstalarApp } from './InstalarApp.jsx';

function StatusTurno({ cardapio }) {
  if (!cardapio) return <span className="selo">Carregando…</span>;
  if (cardapio.aberto) {
    return (
      <span className="selo">
        <span className="selo__ponto" aria-hidden="true" />
        Aberto agora
      </span>
    );
  }
  return (
    <span className="selo selo--fechado">
      <span className="selo__ponto" aria-hidden="true" />
      {cardapio.proximaAbertura
        ? `Fechado · abre ${quandoAbre(cardapio.proximaAbertura.em)}`
        : 'Fechado'}
    </span>
  );
}

function TempoEstimado({ minutos }) {
  return <span className="selo">Entrega em ~{minutos} min</span>;
}

/**
 * @param {{ cardapio: any, children?: any }} props resposta do GET /publico/cardapio (ou null
 * carregando); `children` = navegação de telas largas, abaixo do status
 */
export function Cabecalho({ cardapio, children }) {
  return (
    <header className="cabecalho">
      <div className="cabecalho__interno">
        <NomeRestaurante />
        <div className="cabecalho__info" aria-live="polite">
          <StatusTurno cardapio={cardapio} />
          {cardapio?.aberto && <TempoEstimado minutos={cardapio.tempoEstimadoMin} />}
          <InstalarApp />
        </div>
        {children}
      </div>
    </header>
  );
}
