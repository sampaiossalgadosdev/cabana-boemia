/**
 * Salão: comandas abertas, busca pelo nome, tempo aberta e teclado de peso.
 * Lógica pura (testada com node:test). Os valores aqui são só para mostrar:
 * o preço e o total oficiais saem da API.
 */

/** Peso máximo aceito pela API (gramas). */
export const PESO_MAX_GRAMAS = 5000;
const DIGITOS_PESO = String(PESO_MAX_GRAMAS).length;

/** "João  da Silva" → "joao da silva" (sem acento, minúsculo, espaços simples). */
export const normalizarBusca = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Comandas cujo nome (ou mesa) contém a busca, ignorando acento e maiúsculas.
 * Busca vazia devolve todas.
 */
export function filtrarComandas(comandas, busca) {
  const termo = normalizarBusca(busca);
  if (!termo) return comandas;
  return comandas.filter(
    (c) => normalizarBusca(c.nomeCliente).includes(termo) || normalizarBusca(c.mesaRotulo).includes(termo),
  );
}

/** Insere/atualiza a comanda vinda da API ou do socket; sai se não estiver mais aberta. */
export function aplicarComanda(lista, comanda) {
  if (comanda?.canal !== 'SALAO') return lista;
  const sem = lista.filter((c) => c.id !== comanda.id);
  if (comanda.status !== 'ABERTO') return sem;
  return [...sem, comanda].sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)) || a.id - b.id);
}

/** Há quanto tempo a comanda está aberta: "agora", "12 min", "1 h 05". */
export function tempoAberta(criadoEm, agora = new Date()) {
  const min = Math.max(0, Math.floor((agora.getTime() - new Date(criadoEm).getTime()) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** Itens lançados na comanda (unidades; prato por kg conta 1). */
export const contarItens = (comanda) => (comanda?.itens ?? []).reduce((s, i) => s + (i.pesoGramas ? 1 : i.quantidade), 0);

/**
 * Teclado numérico do peso: devolve o novo texto (só dígitos, sem zero à
 * esquerda, no máximo PESO_MAX_GRAMAS). Tecla inválida não muda nada.
 * @param {string} atual
 * @param {string} tecla '0'–'9' | 'apagar' | 'limpar'
 */
export function teclarPeso(atual, tecla) {
  const texto = String(atual ?? '');
  if (tecla === 'limpar') return '';
  if (tecla === 'apagar') return texto.slice(0, -1);
  if (!/^\d$/.test(tecla)) return texto;
  if (texto === '' && tecla === '0') return texto;
  const novo = texto + tecla;
  if (novo.length > DIGITOS_PESO || Number(novo) > PESO_MAX_GRAMAS) return texto;
  return novo;
}

/** Texto do teclado → gramas (Int) ou null se vazio/zero. */
export function lerGramas(texto) {
  const n = Number.parseInt(String(texto ?? ''), 10);
  return Number.isInteger(n) && n > 0 && n <= PESO_MAX_GRAMAS ? n : null;
}

/** Mesma conta da API: round(preço do quilo × gramas / 1000). */
export const valorPorPeso = (precoKgCentavos, gramas) => Math.round((precoKgCentavos * gramas) / 1000);

/**
 * O × de uma linha agrupada ("4× Refrigerante Lata") remove UMA unidade: o
 * ItemPedido mais recente da linha (cada toque é um item no banco).
 * @param {{ ids: number[] }} linha saída de agruparItens
 */
export const idParaRemover = (linha) => linha.ids.at(-1);
