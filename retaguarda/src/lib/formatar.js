/** Formatação e regras pequenas das telas (puras, testadas). */

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** ISO (UTC) → "15/11/26 20:30" no horário de Brasília. */
export const formatarDataHora = (iso) => dataHora.format(new Date(iso)).replace(',', '');

/** "5543999990000" → "(43) 99999-0000"; fixo "554335551234" → "(43) 3555-1234". */
export function formatarWhatsapp(numero) {
  const d = String(numero ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return numero ?? '';
}

/** Delta com sinal: 5 → "+5", -3 → "−3". */
export const comSinal = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export const NOMES_MOVIMENTACAO = { VENDA: 'Venda', ESTORNO: 'Estorno', ENTRADA: 'Entrada', AJUSTE: 'Ajuste' };

/** "fim antes do início" cruza a meia-noite; "00:00" é o fim do dia. */
export function descreverHorario({ inicio, fim }) {
  if (fim === '00:00') return `${inicio} até meia-noite`;
  if (fim < inicio) return `${inicio} até ${fim} do dia seguinte`;
  return `${inicio} às ${fim}`;
}

/**
 * Horários por dia → lista para a API, ordenada (dia, início). Linhas sem
 * início ou fim são erro do formulário (devolve `erro`).
 * @param {{ diaSemana: number, inicio: string, fim: string }[]} linhas
 */
export function horariosParaApi(linhas) {
  for (const l of linhas) {
    if (!l.inicio || !l.fim) return { erro: `${DIAS_SEMANA[l.diaSemana]}: preencha início e fim.` };
    if (l.inicio === l.fim) return { erro: `${DIAS_SEMANA[l.diaSemana]}: início e fim iguais.` };
  }
  const horarios = linhas
    .map(({ diaSemana, inicio, fim }) => ({ diaSemana, inicio, fim }))
    .sort((a, b) => a.diaSemana - b.diaSemana || a.inicio.localeCompare(b.inicio));
  return { horarios };
}

/** Erros de validação da API (`detalhes: [{ campo, mensagem }]`) → { campo: mensagem }. */
export function errosPorCampo(err) {
  if (err?.codigo !== 'VALIDACAO' || !Array.isArray(err.detalhes)) return {};
  const mapa = {};
  for (const d of err.detalhes) mapa[d.campo.split('.')[0] || '_'] ??= d.mensagem;
  return mapa;
}

/** Sem acento, minúsculo: para filtrar listas. */
export const paraBusca = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Nova ordem depois de mover o item `id` para cima (-1) ou para baixo (+1):
 * devolve só os que mudam, renumerados de 10 em 10.
 * @param {{ id: number, ordem: number }[]} lista já ordenada
 */
export function moverNaOrdem(lista, id, direcao) {
  const i = lista.findIndex((x) => x.id === id);
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= lista.length) return [];
  const nova = [...lista];
  [nova[i], nova[j]] = [nova[j], nova[i]];
  return nova
    .map((x, k) => ({ id: x.id, ordem: (k + 1) * 10, antes: x.ordem }))
    .filter((x) => x.ordem !== x.antes)
    .map(({ id: idItem, ordem }) => ({ id: idItem, ordem }));
}
