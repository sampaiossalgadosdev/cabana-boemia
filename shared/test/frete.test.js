import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freteGratisDaConfig, ganhouFreteGratis, taxaDeEntrega, progressoFreteGratis } from '../src/frete.js';

const LIGADO = { minimoCentavos: 6900 };

test('freteGratisDaConfig: só vale ligado e com mínimo positivo', () => {
  assert.deepEqual(freteGratisDaConfig({ freteGratisAtivo: true, freteGratisMinimoCentavos: 6900 }), LIGADO);
  assert.equal(freteGratisDaConfig({ freteGratisAtivo: false, freteGratisMinimoCentavos: 6900 }), null);
  assert.equal(freteGratisDaConfig({ freteGratisAtivo: true, freteGratisMinimoCentavos: null }), null);
  assert.equal(freteGratisDaConfig({ freteGratisAtivo: true, freteGratisMinimoCentavos: 0 }), null);
  assert.equal(freteGratisDaConfig(null), null);
});

test('taxaDeEntrega: zera a partir do mínimo (inclusive), senão a do bairro', () => {
  assert.equal(taxaDeEntrega(500, 6899, LIGADO), 500);
  assert.equal(taxaDeEntrega(500, 6900, LIGADO), 0);
  assert.equal(taxaDeEntrega(500, 10000, LIGADO), 0);
  assert.equal(taxaDeEntrega(500, 10000, null), 500);
  assert.equal(ganhouFreteGratis(6900, LIGADO), true);
  assert.equal(ganhouFreteGratis(6900, null), false);
});

test('progressoFreteGratis: quanto falta e a porcentagem (subtotal / mínimo)', () => {
  assert.deepEqual(progressoFreteGratis(3900, LIGADO), { atingido: false, faltaCentavos: 3000, percentual: 56 });
  assert.deepEqual(progressoFreteGratis(0, LIGADO), { atingido: false, faltaCentavos: 6900, percentual: 0 });
  assert.deepEqual(progressoFreteGratis(6899, LIGADO), { atingido: false, faltaCentavos: 1, percentual: 99 });
  assert.deepEqual(progressoFreteGratis(6900, LIGADO), { atingido: true, faltaCentavos: 0, percentual: 100 });
  assert.deepEqual(progressoFreteGratis(9000, LIGADO), { atingido: true, faltaCentavos: 0, percentual: 100 });
  assert.equal(progressoFreteGratis(3900, null), null);
});
