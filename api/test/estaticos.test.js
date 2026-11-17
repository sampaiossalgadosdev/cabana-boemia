import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { criarApp } from '../src/app.js';
import { HASH_SCRIPT_SPLASH } from '../src/lib/estaticos.js';

/** Build falso: index.html + um asset com hash. */
function criarDist(prefixo, marca) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html><div id="${marca}"></div>`);
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  return dist;
}

const diretiva = (csp, nome) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${nome} `)) ?? '';

describe('site em /, retaguarda em /admin, API em /api', () => {
  let site;
  let admin;
  let servidor;
  let base;

  before(async () => {
    site = criarDist('site-dist-', 'site');
    admin = criarDist('admin-dist-', 'admin');
    servidor = http.createServer(criarApp({ log: false, distSite: site, distRetaguarda: admin }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    for (const d of [site, admin]) fs.rmSync(d, { recursive: true, force: true });
  });

  test('index.html do site em / e em qualquer rota da SPA, sem cache', async () => {
    for (const rota of ['/', '/checkout', '/pedido/12']) {
      const res = await fetch(`${base}${rota}`);
      assert.equal(res.status, 200, rota);
      assert.match(await res.text(), /id="site"/, rota);
      assert.equal(res.headers.get('cache-control'), 'no-cache', rota);
    }
  });

  test('asset do site em cache longo; arquivo que não existe = 404 JSON', async () => {
    const js = await fetch(`${base}/assets/app-abc123.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('cache-control'), /immutable/);
    for (const rota of ['/assets/app-velho.js', '/favicon.ico']) {
      const res = await fetch(`${base}${rota}`);
      assert.equal(res.status, 404, rota);
      assert.equal((await res.json()).erro.codigo, 'NAO_ENCONTRADO', rota);
    }
  });

  test('/admin continua sendo a retaguarda (não o site)', async () => {
    const res = await fetch(`${base}/admin/produtos`);
    assert.match(await res.text(), /id="admin"/);
  });

  test('/api nunca cai no site: rota inexistente = 404 JSON; rotas antigas sem /api não existem', async () => {
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { status: 'ok' });
    const nada = await fetch(`${base}/api/nao-existe`);
    assert.equal(nada.status, 404);
    assert.equal((await nada.json()).erro.codigo, 'NAO_ENCONTRADO');
    // Sem /api, /health é uma "página" do site (a SPA mostra a tela dela), nunca a API.
    const antiga = await fetch(`${base}/health`);
    assert.match(antiga.headers.get('content-type'), /html/);
    const post = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(post.status, 404);
  });

  test('CSP do site libera só o Google Identity Services; a retaguarda não carrega nada de fora', async () => {
    const csp = (await fetch(`${base}/checkout`)).headers.get('content-security-policy');
    assert.equal(diretiva(csp, 'script-src'), `script-src 'self' ${HASH_SCRIPT_SPLASH} https://accounts.google.com/gsi/client`);
    assert.equal(diretiva(csp, 'frame-src'), 'frame-src https://accounts.google.com/gsi/');
    assert.equal(diretiva(csp, 'connect-src'), "connect-src 'self' https://accounts.google.com/gsi/");
    assert.equal(diretiva(csp, 'style-src'), "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style");
    assert.doesNotMatch(diretiva(csp, 'script-src'), /unsafe/);
    assert.equal(diretiva(csp, 'object-src'), "object-src 'none'");
    assert.equal(diretiva(csp, 'default-src'), "default-src 'self'");

    const cspAdmin = (await fetch(`${base}/admin`)).headers.get('content-security-policy');
    assert.doesNotMatch(cspAdmin, /google/);
    assert.equal(diretiva(cspAdmin, 'script-src'), "script-src 'self'");

    // O popup do login Google continua funcionando (COOP).
    assert.equal((await fetch(`${base}/`)).headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  });
});

test('hash da CSP confere com o script inline da splash no site/index.html', () => {
  const indice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site', 'index.html');
  const inline = [...fs.readFileSync(indice, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1, 'o site deve ter exatamente um script inline (o da splash)');
  const hash = `'sha256-${crypto.createHash('sha256').update(inline[0]).digest('base64')}'`;
  assert.equal(hash, HASH_SCRIPT_SPLASH, 'mudou o script inline da splash: atualize HASH_SCRIPT_SPLASH');
});
