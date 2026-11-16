/**
 * Agrupamento de itens só para EXIBIÇÃO (tela da comanda e cupom CONTA).
 * No banco continua um ItemPedido por toque (remover e estornar item a item);
 * aqui, itens do mesmo produto, mesmo preço, sem observação e sem peso viram
 * uma linha "4x Refrigerante Lata". Puro, testado com node:test.
 */

/**
 * @param {{ id: number, produtoId: number, nome: string, quantidade: number, pesoGramas?: number | null,
 *   precoUnitarioCentavos: number, totalCentavos: number, observacao?: string | null }[]} itens
 *   itens no formato público da API, na ordem de lançamento
 * @returns {Array<object & { ids: number[] }>} linhas na ordem do primeiro lançamento de cada grupo;
 *   `ids` = itens do banco que formam a linha, do mais antigo para o mais novo
 */
export function agruparItens(itens = []) {
  const linhas = [];
  const grupos = new Map();
  for (const item of itens) {
    const agrupavel = !item.pesoGramas && !item.observacao;
    const chave = agrupavel ? `${item.produtoId}:${item.precoUnitarioCentavos}` : null;
    const linha = chave ? grupos.get(chave) : null;
    if (linha) {
      linha.quantidade += item.quantidade;
      linha.totalCentavos += item.totalCentavos;
      linha.ids.push(item.id);
      continue;
    }
    const nova = { ...item, ids: [item.id] };
    if (chave) grupos.set(chave, nova);
    linhas.push(nova);
  }
  return linhas;
}
