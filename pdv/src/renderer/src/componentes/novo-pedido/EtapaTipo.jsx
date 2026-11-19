import { useEffect, useRef, useState } from 'react';
import ilustracaoUrl from '../../assets/ilustracao-entrega.svg';

/** Duração do efeito do botão antes de trocar de tela. */
const EFEITO_MS = 260;

/** Etapa 1: delivery (entrega agora) ou encomenda (data/horário agendado). */
export function EtapaTipo({ tipo, aoEscolher }) {
  const [escolhendo, setEscolhendo] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function escolher(valor) {
    if (escolhendo) return; // clique duplo não troca duas vezes
    setEscolhendo(valor);
    timer.current = setTimeout(() => aoEscolher(valor), EFEITO_MS);
  }

  const marcado = escolhendo ?? tipo;
  return (
    <div className="etapa-tipo">
      <h2 className="etapa__titulo">Pedido</h2>
      <p className="etapa__texto">
        Primeiramente, informe se este pedido é um delivery (entrega agora) ou uma encomenda (entrega em
        data/horário agendado).
      </p>
      <img className="etapa-tipo__ilustracao" src={ilustracaoUrl} alt="" width="320" height="200" />
      <div className="etapa-tipo__opcoes" role="radiogroup" aria-label="Tipo do pedido">
        {[
          ['delivery', 'DELIVERY'],
          ['encomenda', 'ENCOMENDA'],
        ].map(([valor, rotulo], i) => (
          <button key={valor} type="button" role="radio" aria-checked={marcado === valor}
            className={`opcao-tipo ${marcado === valor ? 'opcao-tipo--marcada' : ''} ${escolhendo === valor ? 'opcao-tipo--escolhendo' : ''}`}
            autoFocus={i === 0 && !tipo}
            onClick={() => escolher(valor)}>
            {rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
