import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAXA_KM_PADRAO, taxaPorKm } from '../src/taxaKm.js';

test('padrão: R$ 1,00 + R$ 0,90 por km de ida e volta', () => {
  assert.deepEqual(TAXA_KM_PADRAO, { baseCentavos: 100, porKmCentavos: 90 });
  // 2 km de ida = 4 km ida e volta = 100 + 360.
  assert.equal(taxaPorKm(2000), 460);
  // 3,2 km de ida = 6,4 km = 100 + 576.
  assert.equal(taxaPorKm(3200), 676);
});

test('distância zero = só a base; sem distância = null', () => {
  assert.equal(taxaPorKm(0), 100);
  assert.equal(taxaPorKm(null), null);
  assert.equal(taxaPorKm(undefined), null);
});

test('arredondamento ao centavo, meio para cima, sem erro de ponto flutuante', () => {
  // 90 × 2 × m / 1000 = 0,18 centavo por metro.
  assert.equal(taxaPorKm(1), 100); // 0,18 → 0
  assert.equal(taxaPorKm(2), 100); // 0,36 → 0
  assert.equal(taxaPorKm(3), 101); // 0,54 → 1
  assert.equal(taxaPorKm(25), 105); // 4,5 → 5 (meio para cima)
  // Meio exato com outra regra: 0,1 centavo por metro.
  assert.equal(taxaPorKm(5, { baseCentavos: 0, porKmCentavos: 50 }), 1); // 0,5 → 1
  assert.equal(taxaPorKm(4, { baseCentavos: 0, porKmCentavos: 50 }), 0); // 0,4 → 0
  assert.equal(taxaPorKm(15, { baseCentavos: 0, porKmCentavos: 50 }), 2); // 1,5 → 2
});

test('distância muito longa continua exata (inteiros)', () => {
  assert.equal(taxaPorKm(1_000_000), 180_100); // 1.000 km de ida
  assert.equal(taxaPorKm(123_457), 100 + 22_222); // 22.222,26 → 22.222
});

test('valores configuráveis e entradas inválidas', () => {
  assert.equal(taxaPorKm(1500, { baseCentavos: 300, porKmCentavos: 150 }), 300 + 450);
  assert.equal(taxaPorKm(1500, { baseCentavos: 0, porKmCentavos: 0 }), 0);
  assert.throws(() => taxaPorKm(-1), RangeError);
  assert.throws(() => taxaPorKm(10.5), RangeError);
  assert.throws(() => taxaPorKm(100, { baseCentavos: -1, porKmCentavos: 90 }), RangeError);
  assert.throws(() => taxaPorKm(100, { baseCentavos: 100, porKmCentavos: 0.5 }), RangeError);
  assert.throws(() => taxaPorKm(100, null), RangeError);
});
