/**
 * Conversões entre instantes (UTC) e o horário de parede do restaurante.
 * Tudo passa pelo Intl (tzdata do Node), sem offset fixo no código.
 */
export const FUSO = 'America/Sao_Paulo';

const formatador = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Partes locais (America/Sao_Paulo) de um instante.
 * @param {Date} instante
 * @returns {{ ano: number, mes: number, dia: number, diaSemana: number, minutos: number, data: string }}
 *   `minutos` = minutos desde a meia-noite local; `data` = "YYYY-MM-DD" local.
 */
export function partesLocais(instante) {
  const p = Object.fromEntries(formatador.formatToParts(instante).map((x) => [x.type, x.value]));
  const ano = Number(p.year);
  const mes = Number(p.month);
  const dia = Number(p.day);
  return {
    ano,
    mes,
    dia,
    diaSemana: DIAS[p.weekday],
    minutos: Number(p.hour) * 60 + Number(p.minute),
    data: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Dia local "YYYY-MM-DD" de um instante. */
export function diaLocal(instante) {
  return partesLocais(instante).data;
}

/** Diferença local − UTC, em minutos, no instante dado (−180 em São Paulo hoje). */
function offsetMin(instante) {
  const p = partesLocais(instante);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, 0, p.minutos);
  return (comoUtc - Math.floor(instante.getTime() / 60_000) * 60_000) / 60_000;
}

/**
 * Instante UTC de uma data/hora local. `dia` e `minutos` podem transbordar
 * (dia 32, minutos 1440...) e são normalizados pelo Date.UTC.
 */
export function localParaUtc(ano, mes, dia, minutos) {
  const palpite = Date.UTC(ano, mes - 1, dia, 0, minutos);
  let utc = palpite - offsetMin(new Date(palpite)) * 60_000;
  // Segunda passada cobre o caso de o offset mudar entre o palpite e o resultado.
  utc = palpite - offsetMin(new Date(utc)) * 60_000;
  return new Date(utc);
}
