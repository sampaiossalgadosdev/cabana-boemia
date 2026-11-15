import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calcularTurnoAtivo, calcularProximaAbertura } from '../src/services/turno.service.js';
import { localParaUtc, partesLocais } from '../src/lib/fuso.js';

// Horários reais do cardapio-cabana-boemia.json (0 = domingo … 6 = sábado).
const TURNOS = [
  {
    id: 1,
    nome: 'Lanches',
    horarios: [
      { diaSemana: 4, inicio: '19:00', fim: '23:00' }, // quinta
      { diaSemana: 5, inicio: '19:00', fim: '00:00' }, // sexta
      { diaSemana: 6, inicio: '19:00', fim: '00:00' }, // sábado
      { diaSemana: 0, inicio: '18:00', fim: '23:00' }, // domingo
    ],
  },
  { id: 2, nome: 'Almoço', horarios: [] },
];

// Instantes em horário de Brasília (−03:00). Semana de 12/11/2026 (quinta) a 15/11/2026 (domingo).
const local = (iso) => new Date(`${iso}-03:00`);
const nomeAtivo = (agora) => calcularTurnoAtivo(TURNOS, agora)?.nome ?? null;

describe('turnoAtivo (America/Sao_Paulo)', () => {
  test('quinta 18:59 → fechado', () => {
    assert.equal(nomeAtivo(local('2026-11-12T18:59:59')), null);
  });

  test('quinta 19:00 → Lanches', () => {
    assert.equal(nomeAtivo(local('2026-11-12T19:00')), 'Lanches');
  });

  test('quinta 23:00 → fechado (fim é exclusivo)', () => {
    assert.equal(nomeAtivo(local('2026-11-12T23:00')), null);
  });

  test('sexta 23:30 → Lanches, mesmo já sendo sábado em UTC', () => {
    const agora = local('2026-11-13T23:30');
    assert.equal(agora.getUTCDay(), 6);
    assert.equal(nomeAtivo(agora), 'Lanches');
  });

  test('sábado 23:59 → Lanches', () => {
    assert.equal(nomeAtivo(local('2026-11-14T23:59:59')), 'Lanches');
  });

  test('domingo 00:00 vindo de sábado (19:00–00:00) → fechado', () => {
    assert.equal(nomeAtivo(local('2026-11-15T00:00')), null);
  });

  test('domingo 18:00 → Lanches', () => {
    assert.equal(nomeAtivo(local('2026-11-15T18:00')), 'Lanches');
  });

  test('horário que cruza a meia-noite (19:00–02:00) cobre a madrugada seguinte', () => {
    const turnos = [{ id: 9, nome: 'Madrugada', horarios: [{ diaSemana: 6, inicio: '19:00', fim: '02:00' }] }];
    assert.equal(calcularTurnoAtivo(turnos, local('2026-11-15T01:59'))?.nome, 'Madrugada');
    assert.equal(calcularTurnoAtivo(turnos, local('2026-11-15T02:00')), null);
  });
});

describe('proximaAbertura', () => {
  test('quinta 18:59 → quinta 19:00 (22:00 UTC)', () => {
    const p = calcularProximaAbertura(TURNOS, local('2026-11-12T18:59'));
    assert.equal(p.turno.nome, 'Lanches');
    assert.equal(p.em.toISOString(), '2026-11-12T22:00:00.000Z');
    assert.equal(p.inicio, '19:00');
  });

  test('domingo 00:00 → domingo 18:00', () => {
    const p = calcularProximaAbertura(TURNOS, local('2026-11-15T00:00'));
    assert.equal(p.em.toISOString(), '2026-11-15T21:00:00.000Z');
  });

  test('domingo 23:00 → quinta seguinte 19:00 (atravessa o mês)', () => {
    const p = calcularProximaAbertura(TURNOS, local('2026-11-29T23:00'));
    assert.equal(p.em.toISOString(), '2026-12-03T22:00:00.000Z');
    assert.equal(p.diaSemana, 4);
  });

  test('sem horário cadastrado → null', () => {
    assert.equal(calcularProximaAbertura([{ id: 2, nome: 'Almoço', horarios: [] }], new Date()), null);
  });
});

describe('fuso', () => {
  test('localParaUtc e partesLocais são inversos', () => {
    const d = localParaUtc(2026, 11, 14, 23 * 60 + 59);
    assert.equal(d.toISOString(), '2026-11-15T02:59:00.000Z');
    const p = partesLocais(d);
    assert.deepEqual([p.data, p.diaSemana, p.minutos], ['2026-11-14', 6, 23 * 60 + 59]);
  });
});
