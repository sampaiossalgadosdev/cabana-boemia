import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatarDataHora,
  formatarWhatsapp,
  comSinal,
  descreverHorario,
  horariosParaApi,
  errosPorCampo,
  paraBusca,
  moverNaOrdem,
} from '../src/lib/formatar.js';

test('formatarDataHora mostra o horário de Brasília', () => {
  assert.equal(formatarDataHora('2026-11-15T23:30:00Z'), '15/11/26 20:30');
});

test('formatarWhatsapp', () => {
  assert.equal(formatarWhatsapp('5543999990000'), '(43) 99999-0000');
  assert.equal(formatarWhatsapp('554335551234'), '(43) 3555-1234');
  assert.equal(formatarWhatsapp(''), '');
});

test('comSinal', () => {
  assert.equal(comSinal(5), '+5');
  assert.equal(comSinal(-3), '−3');
  assert.equal(comSinal(0), '0');
});

test('descreverHorario: meia-noite e virada do dia', () => {
  assert.equal(descreverHorario({ inicio: '11:00', fim: '14:00' }), '11:00 às 14:00');
  assert.equal(descreverHorario({ inicio: '19:00', fim: '00:00' }), '19:00 até meia-noite');
  assert.equal(descreverHorario({ inicio: '22:00', fim: '02:00' }), '22:00 até 02:00 do dia seguinte');
});

test('horariosParaApi ordena e recusa linha incompleta ou com início = fim', () => {
  assert.deepEqual(
    horariosParaApi([
      { diaSemana: 5, inicio: '19:00', fim: '00:00', chave: 'a' },
      { diaSemana: 1, inicio: '11:00', fim: '14:00', chave: 'b' },
    ]),
    {
      horarios: [
        { diaSemana: 1, inicio: '11:00', fim: '14:00' },
        { diaSemana: 5, inicio: '19:00', fim: '00:00' },
      ],
    },
  );
  assert.match(horariosParaApi([{ diaSemana: 2, inicio: '', fim: '14:00' }]).erro, /Terça/);
  assert.match(horariosParaApi([{ diaSemana: 0, inicio: '10:00', fim: '10:00' }]).erro, /iguais/);
});

test('errosPorCampo: só VALIDACAO, primeiro erro de cada campo', () => {
  const err = {
    codigo: 'VALIDACAO',
    detalhes: [
      { campo: 'nome', mensagem: 'Informe o nome' },
      { campo: 'insumos.0.quantidade', mensagem: 'Q' },
      { campo: 'nome', mensagem: 'outro' },
    ],
  };
  assert.deepEqual(errosPorCampo(err), { nome: 'Informe o nome', insumos: 'Q' });
  assert.deepEqual(errosPorCampo({ codigo: 'NOME_EM_USO' }), {});
});

test('paraBusca tira acento e caixa', () => {
  assert.equal(paraBusca('  Açaí GRANDE '), 'acai grande');
});

test('moverNaOrdem: troca vizinhos, renumera de 10 em 10 e devolve só o que mudou', () => {
  const lista = [
    { id: 1, ordem: 10 },
    { id: 2, ordem: 20 },
    { id: 3, ordem: 30 },
  ];
  assert.deepEqual(moverNaOrdem(lista, 3, -1), [
    { id: 3, ordem: 20 },
    { id: 2, ordem: 30 },
  ]);
  assert.deepEqual(moverNaOrdem(lista, 1, -1), []);
  assert.deepEqual(moverNaOrdem(lista, 3, +1), []);
  // Ordens repetidas (seed com 0) viram distintas.
  assert.deepEqual(
    moverNaOrdem(
      [
        { id: 1, ordem: 0 },
        { id: 2, ordem: 0 },
      ],
      2,
      -1,
    ),
    [
      { id: 2, ordem: 10 },
      { id: 1, ordem: 20 },
    ],
  );
});
