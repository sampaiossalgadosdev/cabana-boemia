/**
 * Texto para busca: sem acento, minúsculo, espaços simples nas pontas e no
 * meio. "  João  da Silva " → "joao da silva". Usado para gravar
 * `Cliente.nomeBusca` e para normalizar o termo buscado (sem extensão do banco).
 * A migration `cliente_nome_busca` faz o mesmo em SQL para os já existentes.
 */
export function paraBusca(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
