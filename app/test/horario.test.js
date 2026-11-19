import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quandoAbre } from '../src/logica/horario.js';
import { formatarPreco } from '../src/logica/dinheiro.js';

const local = (iso) => new Date(`${iso}-03:00`);

test('quandoAbre: mesmo dia → "hoje às 19:00"', () => {
  assert.equal(quandoAbre('2026-11-12T22:00:00.000Z', local('2026-11-12T10:00')), 'hoje às 19:00');
});

test('quandoAbre: dia seguinte → "amanhã às 18:00"', () => {
  assert.equal(quandoAbre('2026-11-15T21:00:00.000Z', local('2026-11-14T23:30')), 'amanhã às 18:00');
});

test('quandoAbre: mais longe → dia da semana sem "-feira"', () => {
  assert.equal(quandoAbre('2026-11-19T22:00:00.000Z', local('2026-11-15T23:00')), 'quinta às 19:00');
});

test('quandoAbre usa o fuso do restaurante: 23:30 de sábado (já domingo em UTC) → abertura de domingo é "amanhã"', () => {
  const agora = local('2026-11-14T23:30');
  assert.equal(agora.getUTCDate(), 15);
  assert.equal(quandoAbre('2026-11-15T21:00:00.000Z', agora), 'amanhã às 18:00');
});

test('formatarPreco: centavos em reais', () => {
  assert.match(formatarPreco(1600), /^R\$\s16,00$/);
  assert.match(formatarPreco(123456), /^R\$\s1\.234,56$/);
});
