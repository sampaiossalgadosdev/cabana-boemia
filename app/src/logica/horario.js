/** Datas sempre exibidas no fuso do restaurante, qualquer que seja o do aparelho. */
const FUSO = 'America/Sao_Paulo';

const partesData = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const hora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const diaSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long' });

/** Dias de calendário (no fuso do restaurante) entre dois instantes. */
function diasEntre(de, ate) {
  const meiaNoite = (d) => {
    const [a, m, dia] = partesData.format(d).split('-').map(Number);
    return Date.UTC(a, m - 1, dia);
  };
  return Math.round((meiaNoite(ate) - meiaNoite(de)) / 86_400_000);
}

/**
 * "hoje às 19:00" | "amanhã às 19:00" | "quinta às 19:00".
 * @param {string | Date} em instante da abertura (ISO vindo da API)
 * @param {Date} [agora]
 */
export function quandoAbre(em, agora = new Date()) {
  const instante = new Date(em);
  const h = hora.format(instante);
  const dias = diasEntre(agora, instante);
  if (dias <= 0) return `hoje às ${h}`;
  if (dias === 1) return `amanhã às ${h}`;
  return `${diaSemana.format(instante).replace('-feira', '')} às ${h}`;
}
