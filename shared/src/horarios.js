/**
 * Horários de turno ([inicio, fim) em "HH:MM"; fim <= início cruza a
 * meia-noite, "00:00" = fim do dia). Usado pela API (regra oficial) e pela
 * retaguarda (aviso antes de gravar).
 */

const DIA = 1440;
const SEMANA = 7 * DIA;

export const NOMES_DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Trechos [ini, fim) em minutos da semana (domingo 00:00 = 0); quem passa de sábado volta ao domingo. */
function trechosNaSemana(h) {
  const ini = paraMinutos(h.inicio);
  let fim = paraMinutos(h.fim);
  if (fim <= ini) fim += DIA;
  const a = h.diaSemana * DIA + ini;
  const b = h.diaSemana * DIA + fim;
  return b <= SEMANA ? [[a, b]] : [[a, SEMANA], [0, b - SEMANA]];
}

/**
 * Primeiro par de horários que se cruza (do mesmo turno ou de turnos
 * diferentes), ou null. Só um turno pode estar ativo por vez.
 * @param {{ turno: { id: number, nome: string }, horario: { diaSemana: number, inicio: string, fim: string } }[]} lista
 */
export function acharSobreposicao(lista) {
  const trechos = lista.flatMap((item) => trechosNaSemana(item.horario).map(([a, b]) => ({ a, b, item })));
  for (let i = 0; i < trechos.length; i++) {
    for (let j = i + 1; j < trechos.length; j++) {
      const x = trechos[i];
      const y = trechos[j];
      if (x.item !== y.item && x.a < y.b && y.a < x.b) return [x.item, y.item];
    }
  }
  return null;
}

/** "Almoço (segunda 11:00–14:00)". */
export const descreverItem = ({ turno, horario: h }) => `${turno.nome} (${NOMES_DIAS[h.diaSemana]} ${h.inicio}–${h.fim})`;

/** Mensagem do 422 HORARIO_SOBREPOSTO. */
export const mensagemSobreposicao = ([a, b]) => `Horários se cruzam: ${descreverItem(a)} e ${descreverItem(b)}.`;
