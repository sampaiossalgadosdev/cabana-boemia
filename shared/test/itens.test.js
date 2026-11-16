import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { agruparItens } from '../src/itens.js';

const item = (id, produtoId, extra = {}) => ({
  id,
  produtoId,
  nome: `Produto ${produtoId}`,
  quantidade: 1,
  pesoGramas: null,
  precoUnitarioCentavos: 500,
  totalCentavos: 500,
  observacao: null,
  ...extra,
});

describe('agruparItens (exibição da comanda e da conta)', () => {
  test('mesmo produto, mesmo preço, sem observação e sem peso viram uma linha somada', () => {
    const linhas = agruparItens([item(1, 22), item(2, 7), item(3, 22), item(4, 22, { quantidade: 2, totalCentavos: 1000 })]);
    assert.deepEqual(
      linhas.map((l) => [l.produtoId, l.quantidade, l.totalCentavos, l.ids]),
      [
        [22, 4, 2000, [1, 3, 4]],
        [7, 1, 500, [2]],
      ],
      'na ordem do primeiro lançamento; ids do mais antigo para o mais novo',
    );
  });

  test('observação, peso ou preço diferente não agrupam', () => {
    const linhas = agruparItens([
      item(1, 22),
      item(2, 22, { observacao: 'sem gelo' }),
      item(3, 22, { observacao: 'sem gelo' }),
      item(4, 22, { precoUnitarioCentavos: 600, totalCentavos: 600 }),
      item(5, 30, { pesoGramas: 487, precoUnitarioCentavos: 5990, totalCentavos: 2917 }),
      item(6, 30, { pesoGramas: 487, precoUnitarioCentavos: 5990, totalCentavos: 2917 }),
    ]);
    assert.deepEqual(linhas.map((l) => l.ids), [[1], [2], [3], [4], [5], [6]]);
  });

  test('não altera a lista recebida; vazia ou ausente devolve []', () => {
    const itens = [item(1, 22), item(2, 22)];
    agruparItens(itens);
    assert.equal(itens[0].quantidade, 1);
    assert.deepEqual(agruparItens([]), []);
    assert.deepEqual(agruparItens(), []);
  });
});
