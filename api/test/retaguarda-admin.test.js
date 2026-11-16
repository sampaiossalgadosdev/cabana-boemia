import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarApp } from '../src/app.js';

describe('retaguarda servida em /admin', () => {
  let dist;
  let servidor;
  let base;

  before(async () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'retaguarda-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="raiz"></div>');
    fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
    servidor = http.createServer(criarApp({ log: false, distRetaguarda: dist }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    fs.rmSync(dist, { recursive: true, force: true });
  });

  test('index.html em /admin e em qualquer rota da SPA, sem cache', async () => {
    for (const rota of ['/admin', '/admin/', '/admin/produtos', '/admin/estoque/historico']) {
      const res = await fetch(`${base}${rota}`);
      assert.equal(res.status, 200, rota);
      assert.match(await res.text(), /id="raiz"/, rota);
      assert.equal(res.headers.get('cache-control'), 'no-cache', rota);
    }
  });

  test('arquivos com hash ficam em cache longo; asset que não existe = 404 (não vira o index.html)', async () => {
    const js = await fetch(`${base}/admin/assets/app-abc123.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('cache-control'), /immutable/);
    assert.match(js.headers.get('content-type'), /javascript/);
    const sumiu = await fetch(`${base}/admin/assets/app-velho.js`);
    assert.equal(sumiu.status, 404);
    assert.equal((await sumiu.json()).erro.codigo, 'NAO_ENCONTRADO');
  });

  test('sem build, /admin não existe (404 da API)', async () => {
    const outro = http.createServer(criarApp({ log: false, distRetaguarda: path.join(dist, 'nao-existe') }));
    await new Promise((resolve) => outro.listen(0, resolve));
    const res = await fetch(`http://127.0.0.1:${outro.address().port}/admin`);
    assert.equal(res.status, 404);
    await new Promise((resolve) => outro.close(resolve));
  });

  test('as rotas da API continuam fora de /admin', async () => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});
