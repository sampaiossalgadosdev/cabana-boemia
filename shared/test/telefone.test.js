import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTelefone, formatarTelefone, mascararTelefone } from '../src/telefone.js';

test('normalizarTelefone: aceita formatação, +55 e 0 de longa distância; devolve só números', () => {
  assert.equal(normalizarTelefone('(43) 99999-0000'), '43999990000');
  assert.equal(normalizarTelefone('43 9 9999 0000'), '43999990000');
  assert.equal(normalizarTelefone('+55 (43) 99999-0000'), '43999990000');
  assert.equal(normalizarTelefone('043999990000'), '43999990000');
  assert.equal(normalizarTelefone('11987654321'), '11987654321');
});

test('normalizarTelefone: recusa fixo, celular sem o 9, DDD inexistente e tamanho errado', () => {
  for (const v of ['4335550000', '43899990000', '20999990000', '01999990000', '4399999000', '439999900001', '', null, 43999990000]) {
    assert.equal(normalizarTelefone(v), null, String(v));
  }
});

test('formatarTelefone: 11 dígitos viram (DD) 9XXXX-XXXX', () => {
  assert.equal(formatarTelefone('43999990000'), '(43) 99999-0000');
  assert.equal(formatarTelefone(null), '');
});

test('mascararTelefone: formata enquanto digita e corta em 11 dígitos', () => {
  assert.equal(mascararTelefone(''), '');
  assert.equal(mascararTelefone('4'), '(4');
  assert.equal(mascararTelefone('439'), '(43) 9');
  assert.equal(mascararTelefone('4399999'), '(43) 99999');
  assert.equal(mascararTelefone('43999990'), '(43) 99999-0');
  assert.equal(mascararTelefone('(43) 99999-00001234'), '(43) 99999-0000');
});
