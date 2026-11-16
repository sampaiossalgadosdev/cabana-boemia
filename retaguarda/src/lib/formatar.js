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

// ───────── Relatório do dia ─────────

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "2026-11-13" → "sexta, 13/11/2026". */
export function formatarDia(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  const semana = DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()].toLowerCase();
  return `${semana}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}

/** "2026-11-30" + 1 → "2026-12-01". */
export function somarDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

const horaMin = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const diaMes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });

/** ISO → "20:30". */
export const formatarHora = (iso) => horaMin.format(new Date(iso));

/** Expediente [inicio, fim) → "sex 13/11 04:00 até sáb 14/11 04:00". */
export function descreverExpediente(inicio, fim) {
  const parte = (iso) => {
    const d = new Date(iso);
    const semana = DIAS_CURTOS[new Date(d.getTime() - 3 * 3_600_000).getUTCDay()];
    return `${semana} ${diaMes.format(d)} ${horaMin.format(d)}`;
  };
  return `${parte(inicio)} até ${parte(fim)}`;
}

/** Largura da barra em % do maior valor (0 se não vendeu; mínimo 1% para aparecer). */
export function larguraBarra(valor, maior) {
  if (!valor || !maior) return 0;
  return Math.max(1, Math.round((valor / maior) * 1000) / 10);
}

/**
 * Diferença do caixa (contado − esperado): faltou (negativa, vermelho),
 * sobrou ou bateu. Caixa ainda aberto: null.
 */
export function descreverDiferenca(diferencaCentavos) {
  if (diferencaCentavos == null) return null;
  if (diferencaCentavos < 0) return { tipo: 'faltou', centavos: -diferencaCentavos };
  if (diferencaCentavos > 0) return { tipo: 'sobrou', centavos: diferencaCentavos };
  return { tipo: 'bateu', centavos: 0 };
}

/** Peso em gramas → "1,250 kg". */
export const formatarPeso = (g) => `${(g / 1000).toFixed(3).replace('.', ',')} kg`;
