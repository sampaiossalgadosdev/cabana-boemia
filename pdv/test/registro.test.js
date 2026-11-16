import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarRegistro } from '../src/main/registro.js';

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-log-'));
const AGORA = () => new Date(2026, 10, 16, 19, 5, 7, 42);

describe('registro em arquivo (log do agente de impressão)', () => {
  test('cria a pasta e escreve linhas com data local e nível; erro leva o stack', () => {
    const dir = path.join(pasta(), 'logs');
    const log = criarRegistro({ pasta: dir, nome: 'impressao', agora: AGORA, espelho: null });
    log.info('[impressão] API', 'online');
    log.error('[impressão] falha:', new Error('sem papel'));
    const texto = fs.readFileSync(path.join(dir, 'impressao.log'), 'utf8');
    assert.match(texto, /^2026-11-16 19:05:07\.042 INFO  \[impressão\] API online\n/);
    assert.match(texto, /ERROR \[impressão\] falha: Error: sem papel\n\s+at /);
  });

  test('gira por tamanho e guarda só N antigos', () => {
    const dir = pasta();
    const log = criarRegistro({ pasta: dir, nome: 'impressao', maxBytes: 100, arquivos: 2, agora: AGORA, espelho: null });
    for (let i = 1; i <= 12; i++) log.info(`linha ${String(i).padStart(2, '0')} ${'x'.repeat(20)}`);
    const nomes = fs.readdirSync(dir).sort();
    assert.deepEqual(nomes, ['impressao.1.log', 'impressao.2.log', 'impressao.log']);
    for (const n of nomes) assert.ok(fs.statSync(path.join(dir, n)).size <= 100, n);
    // O atual tem a última linha; o .2 é o mais antigo que sobrou (os anteriores foram apagados).
    assert.match(fs.readFileSync(path.join(dir, 'impressao.log'), 'utf8'), /linha 12/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'impressao.2.log'), 'utf8'), /linha 01/);
  });

  test('continua o arquivo existente depois de reabrir o app', () => {
    const dir = pasta();
    criarRegistro({ pasta: dir, nome: 'x', agora: AGORA, espelho: null }).info('primeira');
    criarRegistro({ pasta: dir, nome: 'x', agora: AGORA, espelho: null }).warn('segunda');
    const linhas = fs.readFileSync(path.join(dir, 'x.log'), 'utf8').trim().split('\n');
    assert.equal(linhas.length, 2);
    assert.match(linhas[1], /WARN  segunda/);
  });

  test('pasta impossível de criar não lança (o log nunca derruba o agente)', () => {
    const arquivo = path.join(pasta(), 'um-arquivo');
    fs.writeFileSync(arquivo, '');
    const log = criarRegistro({ pasta: path.join(arquivo, 'logs'), nome: 'x', espelho: null });
    assert.doesNotThrow(() => log.error('nada'));
  });
});
