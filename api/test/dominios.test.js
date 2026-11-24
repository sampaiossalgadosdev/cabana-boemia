import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarApp } from '../src/app.js';
import {
  APP_URL_PADRAO,
  HOSTS_TAAKI_PADRAO,
  destinoDoApp,
  lerDestinosDoApp,
  lerHostsTaaki,
  origensPermitidas,
} from '../src/lib/dominios.js';

/** Build falso de uma SPA com os arquivos públicos do site da Cabana. */
function criarDist(prefixo, marca) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.mkdirSync(path.join(dist, 'icones'));
  fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html><div id="${marca}"></div>`);
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {}) // cabana');
  fs.writeFileSync(path.join(dist, 'manifest.webmanifest'), '{"name":"Cabana Boemia"}');
  fs.writeFileSync(path.join(dist, 'offline.html'), '<p>offline cabana</p>');
  fs.writeFileSync(path.join(dist, 'icones', 'icone-192.png'), 'png');
  return dist;
}

/** GET com o cabeçalho Host (o fetch não deixa trocar o Host). */
function pedir(porta, caminho, { host, metodo = 'GET', cabecalhos = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: { Host: host, ...cabecalhos } },
      (res) => {
        const partes = [];
        res.on('data', (p) => partes.push(p));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const HOSTS_CABANA = ['cabana.managerpix.com.br', 'cabana-boemia-production.up.railway.app', 'localhost:3000'];
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36';

describe('separação por host: Taaki x Cabana', () => {
  let site;
  let admin;
  let servidor;
  let porta;

  before(async () => {
    site = criarDist('site-dist-', 'site');
    admin = criarDist('admin-dist-', 'admin');
    servidor = http.createServer(
      criarApp({
        log: false,
        distSite: site,
        distRetaguarda: admin,
        corsOrigins: ['https://cabana.managerpix.com.br'],
        hostsTaaki: lerHostsTaaki(''),
        destinosApp: lerDestinosDoApp({}),
        emailTitular: 'contato@exemplo.com',
      }),
    );
    await new Promise((resolve) => servidor.listen(0, resolve));
    porta = servidor.address().port;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    for (const d of [site, admin]) fs.rmSync(d, { recursive: true, force: true });
  });

  test('domínio da Cabana, do Railway e localhost: o site da Cabana como sempre', async () => {
    for (const host of HOSTS_CABANA) {
      for (const rota of ['/', '/pedidos', '/privacidade', '/termos', '/app', '/parceiro']) {
        const r = await pedir(porta, rota, { host });
        assert.equal(r.status, 200, `${host}${rota}`);
        assert.match(r.corpo, /id="site"/, `${host}${rota}`);
      }
      assert.match((await pedir(porta, '/sw.js', { host })).corpo, /cabana/, host);
      assert.match((await pedir(porta, '/manifest.webmanifest', { host })).corpo, /Cabana Boemia/, host);
      assert.equal((await pedir(porta, '/assets/app-abc123.js', { host })).status, 200, host);
      // O logo da landing não existe no site da Cabana (arquivo inexistente = 404 JSON).
      assert.equal((await pedir(porta, '/taaki/logo.jpg', { host })).status, 404, host);
    }
  });

  test('domínios do Taaki: / é a landing (nunca o site da Cabana)', async () => {
    for (const host of [...HOSTS_TAAKI_PADRAO, 'API.TaakiDelivery.com.br', 'taakidelivery.com.br:443']) {
      const r = await pedir(porta, '/', { host });
      assert.equal(r.status, 200, host);
      assert.match(r.headers['content-type'], /^text\/html/, host);
      assert.doesNotMatch(r.corpo, /id="site"/, host);
      assert.match(r.corpo, /Taaki Delivery/, host);
      assert.match(r.corpo, /Delivery das lojas de Abatiá e região/, host);
      assert.match(r.corpo, /href="\/app"[^>]*><strong>Quero pedir/, host);
      assert.match(r.corpo, /href="\/parceiro"[^>]*><strong>Sou parceiro/, host);
      for (const link of ['/privacidade-app', '/termos-app', '/excluir-conta']) assert.match(r.corpo, new RegExp(`href="${link}"`), host);
      assert.match(r.corpo, /mailto:contato@exemplo\.com/, host);
      assert.doesNotMatch(r.corpo, /<script/i, 'sem script');
      assert.match(r.headers['content-security-policy'], /default-src 'none'/, host);
    }
    // HEAD também.
    assert.equal((await pedir(porta, '/', { host: 'taakidelivery.com.br', metodo: 'HEAD' })).status, 200);
  });

  test('landing sem e-mail configurado: rodapé só com os links', async () => {
    const app = criarApp({ log: false, distSite: site, distRetaguarda: admin, hostsTaaki: ['t.test'], destinosApp: lerDestinosDoApp({}), emailTitular: null });
    const s = http.createServer(app);
    await new Promise((resolve) => s.listen(0, resolve));
    try {
      const r = await pedir(s.address().port, '/', { host: 't.test' });
      assert.equal(r.status, 200);
      assert.doesNotMatch(r.corpo, /mailto:/);
      assert.match(r.corpo, /href="\/excluir-conta"/);
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  test('/app redireciona para o Google Play; /parceiro para a retaguarda', async () => {
    for (const host of HOSTS_TAAKI_PADRAO) {
      const app = await pedir(porta, '/app', { host, cabecalhos: { 'User-Agent': ANDROID } });
      assert.equal(app.status, 302, host);
      assert.equal(app.headers.location, APP_URL_PADRAO);
      assert.equal(app.headers['cache-control'], 'no-store');
      // Sem destino próprio do iPhone, o iPhone vai para o mesmo lugar.
      assert.equal((await pedir(porta, '/app', { host, cabecalhos: { 'User-Agent': IOS } })).headers.location, APP_URL_PADRAO);
      const parceiro = await pedir(porta, '/parceiro', { host });
      assert.equal(parceiro.status, 302, host);
      assert.equal(parceiro.headers.location, '/admin/');
      const retaguarda = await pedir(porta, '/admin/', { host });
      assert.equal(retaguarda.status, 200, host);
      assert.match(retaguarda.corpo, /id="admin"/, 'a retaguarda continua em /admin em todos os hosts');
    }
  });

  test('/app configurável: TAAKI_APP_URL e TAAKI_APP_URL_IOS', async () => {
    const destinosApp = lerDestinosDoApp({ TAAKI_APP_URL: 'https://app.exemplo.com/baixar', TAAKI_APP_URL_IOS: 'https://apps.apple.com/app/id1' });
    const s = http.createServer(criarApp({ log: false, distSite: site, distRetaguarda: admin, hostsTaaki: ['t.test'], destinosApp }));
    await new Promise((resolve) => s.listen(0, resolve));
    try {
      const p = s.address().port;
      assert.equal((await pedir(p, '/app', { host: 't.test', cabecalhos: { 'User-Agent': ANDROID } })).headers.location, 'https://app.exemplo.com/baixar');
      assert.equal((await pedir(p, '/app', { host: 't.test', cabecalhos: { 'User-Agent': IOS } })).headers.location, 'https://apps.apple.com/app/id1');
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  test('nos domínios do Taaki nada do site da Cabana aparece', async () => {
    const host = 'api.taakidelivery.com.br';
    for (const rota of ['/pedidos', '/perfil', '/checkout', '/index.html', '/assets/app-abc123.js', '/manifest.webmanifest', '/offline.html', '/icones/icone-192.png', '/splash/splash.js', '/confirmacao/confirmacao.js']) {
      const r = await pedir(porta, rota, { host });
      assert.equal(r.status, 404, rota);
      assert.match(r.headers['content-type'], /^text\/html/, rota);
      assert.doesNotMatch(r.corpo, /id="site"|Cabana/, rota);
      assert.match(r.corpo, /Página não encontrada/, rota);
    }
    // As páginas legais do site são da Cabana: no Taaki vão para as do app.
    assert.equal((await pedir(porta, '/privacidade', { host })).headers.location, '/privacidade-app');
    assert.equal((await pedir(porta, '/termos', { host })).headers.location, '/termos-app');
    // Service worker antigo da Cabana (se alguém abriu o site por este host): o novo se desfaz.
    const sw = await pedir(porta, '/sw.js', { host });
    assert.equal(sw.status, 200);
    assert.match(sw.headers['content-type'], /javascript/);
    assert.match(sw.corpo, /registration\.unregister\(\)/);
    assert.doesNotMatch(sw.corpo, /cabana'\)|\/\/ cabana/);
    // Logo da landing.
    const logo = await pedir(porta, '/taaki/logo.jpg', { host });
    assert.equal(logo.status, 200);
    assert.equal(logo.headers['content-type'], 'image/jpeg');
  });

  test('API, retaguarda e páginas do app continuam em todos os hosts', async () => {
    for (const host of [...HOSTS_CABANA, ...HOSTS_TAAKI_PADRAO]) {
      const saude = await pedir(porta, '/api/health', { host });
      assert.equal(saude.status, 200, host);
      assert.match(saude.headers['content-type'], /json/, host);
      const inexistente = await pedir(porta, '/api/nao-existe', { host });
      assert.equal(inexistente.status, 404, host);
      assert.equal(JSON.parse(inexistente.corpo).erro.codigo, 'NAO_ENCONTRADO', host);
      for (const rota of ['/privacidade-app', '/termos-app', '/excluir-conta']) {
        const r = await pedir(porta, rota, { host });
        assert.equal(r.status, 200, `${host}${rota}`);
        assert.match(r.corpo, /Taaki Delivery/, `${host}${rota}`);
      }
    }
  });

  test('método que não é GET na raiz do Taaki não vira landing', async () => {
    const r = await pedir(porta, '/', { host: 'taakidelivery.com.br', metodo: 'POST' });
    assert.equal(r.status, 404);
    assert.match(r.headers['content-type'], /json/);
  });

  test('CORS: origens dos domínios do Taaki entram sem tirar as de CORS_ORIGINS', async () => {
    const host = 'api.taakidelivery.com.br';
    for (const origem of ['https://taakidelivery.com.br', 'https://www.taakidelivery.com.br', 'https://api.taakidelivery.com.br', 'https://cabana.managerpix.com.br']) {
      const r = await pedir(porta, '/api/health', { host, cabecalhos: { Origin: origem } });
      assert.equal(r.headers['access-control-allow-origin'], origem, origem);
    }
    const estranha = await pedir(porta, '/api/health', { host, cabecalhos: { Origin: 'https://outro.exemplo.com' } });
    assert.equal(estranha.headers['access-control-allow-origin'], undefined);
    assert.equal((await pedir(porta, '/api/health', { host, cabecalhos: { Origin: 'http://taakidelivery.com.br' } })).headers['access-control-allow-origin'], undefined, 'só https');
  });
});

test('TAAKI_HOSTS: vazio = padrão; limpa esquema, porta, barra, maiúsculas e repetição', () => {
  assert.deepEqual(lerHostsTaaki(undefined), [...HOSTS_TAAKI_PADRAO]);
  assert.deepEqual(lerHostsTaaki(' , '), [...HOSTS_TAAKI_PADRAO]);
  assert.deepEqual(lerHostsTaaki('https://Taaki.com.br/, taaki.com.br:443,www.taaki.com.br'), ['taaki.com.br', 'www.taaki.com.br']);
});

test('destinos de /app: só https; inválido cai no Google Play', () => {
  assert.deepEqual(lerDestinosDoApp({}), { padrao: APP_URL_PADRAO, ios: null });
  assert.deepEqual(lerDestinosDoApp({ TAAKI_APP_URL: 'http://inseguro.com', TAAKI_APP_URL_IOS: 'javascript:alert(1)' }), { padrao: APP_URL_PADRAO, ios: null });
  const d = { padrao: 'https://a.com', ios: 'https://b.com' };
  assert.equal(destinoDoApp(IOS, d), 'https://b.com');
  assert.equal(destinoDoApp('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', d), 'https://b.com');
  assert.equal(destinoDoApp(ANDROID, d), 'https://a.com');
  assert.equal(destinoDoApp(undefined, d), 'https://a.com');
});

test('origens permitidas = CORS_ORIGINS + https dos hosts do Taaki, sem repetir', () => {
  assert.deepEqual(origensPermitidas(['https://a.com', 'https://t.com'], ['t.com', 'www.t.com']), ['https://a.com', 'https://t.com', 'https://www.t.com']);
});
