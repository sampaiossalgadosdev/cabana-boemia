/**
 * Fila de pedidos do delivery (site + WhatsApp, ainda abertos hoje).
 * Lógica pura, testada com node:test.
 */
export const CANAIS_FILA = ['SITE', 'WHATSAPP'];
export const STATUS_ABERTOS = ['ABERTO', 'CONFIRMADO'];

export const entraNaFila = (p) => CANAIS_FILA.includes(p.canal) && STATUS_ABERTOS.includes(p.status);

/** Ordem de chegada (criadoEm, depois id): na virada do dia o número reinicia. */
function ordenar(fila) {
  return [...fila].sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)) || a.id - b.id);
}

/** Insere ou substitui um pedido; sai da fila se não estiver mais aberto. */
export function aplicarPedido(fila, pedido) {
  const sem = fila.filter((p) => p.id !== pedido.id);
  return entraNaFila(pedido) ? ordenar([...sem, pedido]) : sem;
}

export function removerPedido(fila, id) {
  return fila.filter((p) => p.id !== id);
}

/** Lista carregada da API (já filtrada lá), na ordem da fila. */
export function filaDaApi(pedidos) {
  return ordenar(pedidos.filter(entraNaFila));
}

/** Alerta sonoro só para pedido novo do site. */
export const tocaAlerta = (pedido) => pedido?.canal === 'SITE';
