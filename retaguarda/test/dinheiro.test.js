import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatarReais, lerReais, centavosParaCampo } from '../src/lib/dinheiro.js';

test('formatarReais', () => {
  assert.equal(formatarReais(1650), 'R$ 16,50');
  assert.equal(formatarReais(0), 'R$ 0,00');
  assert.equal(formatarReais(123456), 'R$ 1.234,56');
});

test('lerReais aceita os jeitos comuns de digitar e recusa lixo', () => {
  const casos = { 16: 1600, '16,5': 1650, '16,50': 1650, '1.234,56': 123456, 'R$ 3,00': 300, '16.50': 1650, '1.234': 123400, '0,05': 5 };
  for (const [texto, esperado] of Object.entries(casos)) assert.equal(lerReais(texto), esperado, texto);
  for (const ruim of ['', '  ', 'abc', '1,234', '-5', '16,505', '1,2,3']) assert.equal(lerReais(ruim), null, ruim);
});

test('centavosParaCampo é o inverso de lerReais', () => {
  for (const c of [0, 5, 1650, 123456]) assert.equal(lerReais(centavosParaCampo(c)), c);
  assert.equal(centavosParaCampo(null), '');
});
