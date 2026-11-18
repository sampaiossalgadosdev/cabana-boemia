import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gravarEmOrdem, ordenarTurnos, prepararGravacao } from '../src/lib/turnos.js';

const h = (diaSemana, inicio, fim) => ({ diaSemana, inicio, fim });
const ALMOCO = { id: 2, nome: 'Almoço', ativo: true, horarios: [h(1, '11:00', '14:00')] };
const LANCHES = { id: 1, nome: 'Lanches', ativo: true, horarios: [h(1, '19:00', '23:00')] };
const TURNOS = [LANCHES, ALMOCO];

test('ordenarTurnos: Almoço antes de Lanches, sem mexer na lista original', () => {
  assert.deepEqual(ordenarTurnos(TURNOS).map((t) => t.nome), ['Almoço', 'Lanches']);
  assert.equal(TURNOS[0].nome, 'Lanches');
});

test('prepararGravacao: só grava o turno que mudou (linhas iguais em outra ordem não contam)', () => {
  assert.deepEqual(prepararGravacao(TURNOS, { 1: LANCHES.horarios, 2: ALMOCO.horarios }), { gravar: [] });
  const r = prepararGravacao(TURNOS, {
    1: [h(5, '19:00', '00:00'), { ...h(1, '19:00', '23:00'), chave: 9 }],
    2: ALMOCO.horarios,
  });
  assert.deepEqual(r, { gravar: [{ turno: LANCHES, horarios: [h(1, '19:00', '23:00'), h(5, '19:00', '00:00')] }] });
});

test('prepararGravacao: linha incompleta diz o turno', () => {
  const r = prepararGravacao(TURNOS, { 1: LANCHES.horarios, 2: [h(3, '11:00', '')] });
  assert.equal(r.erro, 'Almoço, quarta: preencha início e fim.');
});

test('prepararGravacao: cruzamento entre turnos usa o que está na tela', () => {
  const r = prepararGravacao(TURNOS, { 1: [h(1, '13:00', '23:00')], 2: ALMOCO.horarios });
  assert.match(r.erro, /^Horários se cruzam: Lanches \(segunda 13:00–23:00\) e Almoço \(segunda 11:00–14:00\)\.$/);
  // Troca: Almoço vai para a noite e Lanches para o meio-dia; juntos não se cruzam.
  const troca = prepararGravacao(TURNOS, { 1: [h(1, '11:00', '14:00')], 2: [h(1, '19:00', '23:00')] });
  assert.equal(troca.gravar.length, 2);
});

test('prepararGravacao: turno ativo pode cruzar um inativo (como na API); o inativo não cruza o ativo nem a si mesmo', () => {
  const inativo = { ...ALMOCO, ativo: false, horarios: [h(1, '19:00', '22:00')] };
  const turnos = [LANCHES, inativo];
  assert.equal(prepararGravacao(turnos, { 1: [h(1, '18:00', '23:00')], 2: inativo.horarios }).gravar.length, 1);
  assert.match(prepararGravacao(turnos, { 1: LANCHES.horarios, 2: [h(1, '18:00', '22:00')] }).erro, /se cruzam/);
  assert.match(prepararGravacao(turnos, { 1: LANCHES.horarios, 2: [h(2, '11:00', '14:00'), h(2, '13:00', '15:00')] }).erro, /se cruzam/);
});

test('gravarEmOrdem: quem leva HORARIO_SOBREPOSTO fica para depois', async () => {
  const banco = new Set(['lanches-meio-dia']);
  const chamadas = [];
  const definir = async (id) => {
    chamadas.push(id);
    if (id === 2 && banco.has('lanches-meio-dia')) throw Object.assign(new Error('cruza'), { codigo: 'HORARIO_SOBREPOSTO' });
    if (id === 1) banco.delete('lanches-meio-dia');
  };
  const r = await gravarEmOrdem([{ turno: { id: 2 } }, { turno: { id: 1 } }], definir);
  assert.deepEqual(r, { gravados: [1, 2], erro: null });
  assert.deepEqual(chamadas, [2, 1, 2]);
});

test('gravarEmOrdem: para quando ninguém avança ou com outro erro', async () => {
  const sobreposto = Object.assign(new Error('cruza'), { codigo: 'HORARIO_SOBREPOSTO' });
  let r = await gravarEmOrdem([{ turno: { id: 1 } }], async () => {
    throw sobreposto;
  });
  assert.deepEqual(r, { gravados: [], erro: sobreposto });
  const rede = new Error('Sem conexão');
  r = await gravarEmOrdem([{ turno: { id: 1 } }, { turno: { id: 2 } }], async (id) => {
    if (id === 2) throw rede;
  });
  assert.deepEqual(r, { gravados: [1], erro: rede });
});
