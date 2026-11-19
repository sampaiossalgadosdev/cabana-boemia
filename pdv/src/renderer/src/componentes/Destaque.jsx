import { destacarTrecho } from '../lib/painel.js';

/** Texto com o trecho buscado em negrito (autocompletes de cliente e produto). */
export function Destaque({ texto, busca }) {
  return destacarTrecho(texto, busca).map((parte, i) =>
    parte.destaque ? <strong key={i}>{parte.texto}</strong> : <span key={i}>{parte.texto}</span>,
  );
}
