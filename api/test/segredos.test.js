import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { problemasNosSegredos } from '../src/lib/tokens.js';
import { raizApi } from './helpers/banco.js';

const VALIDO_A = 'a'.repeat(32);
const VALIDO_B = 'b'.repeat(48);

describe('validação dos segredos JWT', () => {
  test('segredos com 32+ caracteres e diferentes: nenhum problema', () => {
    assert.deepEqual(problemasNosSegredos({ JWT_SECRET: VALIDO_A, JWT_REFRESH_SECRET: VALIDO_B }), []);
  });

  test('ausentes ou vazios são apontados um a um', () => {
    assert.deepEqual(problemasNosSegredos({ JWT_SECRET: '' }), [
      'JWT_SECRET ausente',
      'JWT_REFRESH_SECRET ausente',
    ]);
  });

  test('curto demais (31 caracteres) é recusado', () => {
    assert.deepEqual(problemasNosSegredos({ JWT_SECRET: 'x'.repeat(31), JWT_REFRESH_SECRET: VALIDO_B }), [
      'JWT_SECRET curto demais (31 caracteres; mínimo 32)',
    ]);
  });

  test('os dois iguais é recusado', () => {
    assert.deepEqual(problemasNosSegredos({ JWT_SECRET: VALIDO_A, JWT_REFRESH_SECRET: VALIDO_A }), [
      'JWT_SECRET e JWT_REFRESH_SECRET precisam ser diferentes',
    ]);
  });
});

/** Roda o server.js com o ambiente dado; mata após 10s se não sair sozinho. */
function rodarServidor(envExtra) {
  const env = { ...process.env, PORT: '0', ...envExtra };
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [path.join(raizApi, 'src', 'server.js')], { env });
    let saida = '';
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    const timer = setTimeout(() => filho.kill(), 10_000);
    filho.on('exit', (codigo) => {
      clearTimeout(timer);
      resolve({ codigo, saida });
    });
  });
}

describe('server.js na inicialização', () => {
  test('recusa iniciar com segredos vazios: sai com código 1 e explica o motivo', async () => {
    const { codigo, saida } = await rodarServidor({ JWT_SECRET: '', JWT_REFRESH_SECRET: '' });
    assert.equal(codigo, 1);
    assert.match(saida, /A API não vai iniciar/);
    assert.match(saida, /JWT_SECRET ausente/);
    assert.match(saida, /JWT_REFRESH_SECRET ausente/);
    assert.doesNotMatch(saida, /API ouvindo/);
  });

  test('recusa iniciar com segredo curto', async () => {
    const { codigo, saida } = await rodarServidor({ JWT_REFRESH_SECRET: 'curto' });
    assert.equal(codigo, 1);
    assert.match(saida, /JWT_REFRESH_SECRET curto demais \(5 caracteres; mínimo 32\)/);
  });
});
