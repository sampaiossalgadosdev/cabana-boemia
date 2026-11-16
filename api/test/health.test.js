import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { criarApp } from '../src/app.js';

describe('API base', () => {
  let servidor;
  let base;

  before(async () => {
    const app = criarApp({ corsOrigins: ['http://localhost:5173'], log: false });
    await new Promise((resolve) => {
      servidor = app.listen(0, resolve);
    });
    base = `http://127.0.0.1:${servidor.address().port}/api`;
  });

  after(() => new Promise((resolve) => servidor.close(resolve)));

  test('GET /health responde 200 com status ok', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  test('Cross-Origin-Opener-Policy é same-origin-allow-popups (popup do login Google)', async () => {
    for (const [rota, status] of [
      ['/health', 200],
      ['/nao-existe', 404],
      ['/cliente/me', 401],
    ]) {
      const res = await fetch(`${base}${rota}`);
      assert.equal(res.status, status, rota);
      assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups', rota);
    }
  });

  test('rota inexistente responde 404 em JSON', async () => {
    const res = await fetch(`${base}/nao-existe`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).erro.codigo, 'NAO_ENCONTRADO');
  });

  test('JSON malformado responde 400 pelo middleware de erro', async () => {
    const res = await fetch(`${base}/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ invalido',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).erro.codigo, 'JSON_INVALIDO');
  });

  test('CORS libera origem configurada e bloqueia as demais', async () => {
    const liberada = await fetch(`${base}/health`, {
      headers: { origin: 'http://localhost:5173' },
    });
    assert.equal(liberada.headers.get('access-control-allow-origin'), 'http://localhost:5173');

    const bloqueada = await fetch(`${base}/health`, { headers: { origin: 'http://outro.example' } });
    assert.equal(bloqueada.headers.get('access-control-allow-origin'), null);
  });
});
