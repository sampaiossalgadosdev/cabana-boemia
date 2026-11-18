import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acharSobreposicao, mensagemSobreposicao } from '../src/horarios.js';

const item = (id, nome, diaSemana, inicio, fim) => ({ turno: { id, nome }, horario: { diaSemana, inicio, fim } });

test('acharSobreposicao: encosta não cruza; virada de sábado para domingo cruza', () => {
  assert.equal(acharSobreposicao([item(1, 'Almoço', 1, '11:00', '14:00'), item(2, 'Lanches', 1, '14:00', '23:00')]), null);
  const a = item(2, 'Lanches', 6, '19:00', '02:00');
  const b = item(1, 'Almoço', 0, '01:00', '03:00');
  assert.deepEqual(acharSobreposicao([a, b]), [a, b]);
});

test('mensagemSobreposicao', () => {
  const par = [item(2, 'Lanches', 1, '13:00', '23:00'), item(1, 'Almoço', 1, '11:00', '14:00')];
  assert.equal(mensagemSobreposicao(par), 'Horários se cruzam: Lanches (segunda 13:00–23:00) e Almoço (segunda 11:00–14:00).');
});
