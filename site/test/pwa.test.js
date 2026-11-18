import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { gerarIcones, ICONES, CREME } from '../scripts/gerar-icones.mjs';
import { MODELO, montarSw, swDoBuild } from '../pwa/plugin-sw.js';
import {
  CHAVE_INSTALACAO,
  ehSafariDoIos,
  estaComoApp,
  gravarEscolha,
  lerEscolha,
  oQueMostrar,
} from '../src/lib/instalacao.js';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporario = (prefixo) => fs.mkdtempSync(path.join(os.tmpdir(), prefixo));

describe('manifest.webmanifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(site, 'public', 'manifest.webmanifest'), 'utf8'));

  test('campos obrigatórios e cores da marca', () => {
    assert.equal(manifest.name, 'Cabana Boemia');
    assert.equal(manifest.short_name, 'Cabana');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.lang, 'pt-BR');
    assert.equal(manifest.theme_color, '#9E0B22'); // vermelho escuro (o mesmo theme-color do index.html)
    assert.equal(manifest.background_color, '#FBF3E8'); // creme
  });

  test('ícones 192, 512 e maskable 512, todos gerados pelo script', () => {
    const porTamanho = (tam, proposito) =>
      manifest.icons.find((i) => i.sizes === tam && (i.purpose ?? 'any') === proposito);
    assert.ok(porTamanho('192x192', 'any'));
    assert.ok(porTamanho('512x512', 'any'));
    assert.ok(porTamanho('512x512', 'maskable'));
    const gerados = new Set(ICONES.map((i) => `/icones/${i.arquivo}`));
    for (const icone of manifest.icons) {
      assert.ok(gerados.has(icone.src), icone.src);
      assert.equal(icone.type, 'image/png');
      const lado = Number(icone.sizes.split('x')[0]);
      assert.equal(ICONES.find((i) => `/icones/${i.arquivo}` === icone.src).lado, lado, icone.src);
    }
  });

  test('index.html aponta para o manifest e o apple-touch-icon gerado', () => {
    const indice = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
    assert.match(indice, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
    assert.match(indice, /<link rel="apple-touch-icon" href="\/icones\/apple-touch-icon\.png" \/>/);
  });
});

describe('ícones gerados da logo', () => {
  const destino = temporario('icones-');
  gerarIcones({ destino });
  const ler = (arquivo) => PNG.sync.read(fs.readFileSync(path.join(destino, arquivo)));

  test('tamanhos certos, quadrados e sem transparência', () => {
    const esperado = {
      'icone-192.png': 192,
      'icone-512.png': 512,
      'icone-maskable-512.png': 512,
      'apple-touch-icon.png': 180,
    };
    assert.deepEqual(Object.fromEntries(ICONES.map((i) => [i.arquivo, i.lado])), esperado);
    for (const [arquivo, lado] of Object.entries(esperado)) {
      const png = ler(arquivo);
      assert.equal(png.width, lado, arquivo);
      assert.equal(png.height, lado, arquivo);
      // colorType 2 = RGB sem alfa (o iOS pinta de preto o que for transparente)
      const bruto = fs.readFileSync(path.join(destino, arquivo));
      assert.equal(bruto[25], 2, `${arquivo}: deveria ser RGB sem alfa`);
    }
  });

  test('fundo creme sólido, logo centralizada', () => {
    for (const { arquivo, lado } of ICONES) {
      const png = ler(arquivo);
      const pixel = (x, y) => [...png.data.subarray((y * lado + x) * 4, (y * lado + x) * 4 + 3)];
      for (const [x, y] of [[0, 0], [lado - 1, 0], [0, lado - 1], [lado - 1, lado - 1]]) {
        assert.deepEqual(pixel(x, y), CREME, `${arquivo} canto ${x},${y}`);
      }
      assert.notDeepEqual(pixel(lado / 2, lado / 2), CREME, `${arquivo}: centro deveria ter a logo`);
    }
  });

  test('maskable: a logo inteira cabe na zona segura (círculo de 80% do lado)', () => {
    const png = ler('icone-maskable-512.png');
    const raio = 0.4 * 512;
    let fora = 0;
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const p = (y * 512 + x) * 4;
        const creme = png.data[p] === CREME[0] && png.data[p + 1] === CREME[1] && png.data[p + 2] === CREME[2];
        if (!creme && Math.hypot(x + 0.5 - 256, y + 0.5 - 256) > raio) fora++;
      }
    }
    assert.equal(fora, 0);
  });
});

/** Roda o sw.js num contexto falso e devolve o que interessa. */
function carregarSw({ rede = 'ok', arquivos = ['/assets/app-1.js', '/offline.html'] } = {}) {
  const ouvintes = {};
  const guardados = new Map([['/offline.html', { offline: true }]]);
  const buscas = [];
  const contexto = {
    URL,
    Promise,
    console,
    Response: { error: () => ({ erro: true }) },
    self: {
      location: { origin: 'https://cabana.managerpix.com.br' },
      addEventListener: (tipo, fn) => (ouvintes[tipo] = fn),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    fetch: async (req) => {
      buscas.push(typeof req === 'string' ? req : req.url);
      if (rede === 'fora') throw new TypeError('Failed to fetch');
      return { ok: true, type: 'basic', clone: () => ({}), rede: true };
    },
    caches: {
      match: async (req) => guardados.get(typeof req === 'string' ? req : new URL(req.url).pathname),
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
    },
  };
  const codigo = montarSw(fs.readFileSync(MODELO, 'utf8'), { versao: 'teste', arquivos });
  vm.runInNewContext(codigo, contexto);
  /** Dispara um fetch; devolve a promessa passada ao respondWith, ou null se não interceptou. */
  const disparar = (url, { method = 'GET', mode = 'cors' } = {}) => {
    let resposta = null;
    ouvintes.fetch({ request: { url, method, mode }, respondWith: (p) => (resposta = p) });
    return resposta;
  };
  return { disparar, buscas };
}

describe('service worker', () => {
  const ORIGEM = 'https://cabana.managerpix.com.br';

  test('nunca intercepta /api, /admin, /socket.io, POST nem outros domínios', () => {
    const { disparar } = carregarSw();
    const ignorados = [
      [`${ORIGEM}/api/publico/cardapio`],
      [`${ORIGEM}/api/publico/cardapio`, { mode: 'navigate' }],
      [`${ORIGEM}/api/cliente/pedidos`, { method: 'POST' }],
      [`${ORIGEM}/api`],
      [`${ORIGEM}/api/socket.io/?EIO=4&transport=polling`],
      [`${ORIGEM}/admin`, { mode: 'navigate' }],
      [`${ORIGEM}/admin/assets/x.js`],
      [`${ORIGEM}/socket.io/?EIO=4`],
      [`${ORIGEM}/`, { method: 'POST', mode: 'navigate' }],
      ['https://accounts.google.com/gsi/client'],
      ['https://images.unsplash.com/foto.jpg'],
      [`${ORIGEM}/manifest.webmanifest`],
      [`${ORIGEM}/sw.js`],
    ];
    for (const [url, opcoes] of ignorados) {
      assert.equal(disparar(url, opcoes), null, `${url} ${JSON.stringify(opcoes ?? {})}`);
    }
  });

  test('páginas vêm da rede (nunca do cache) e, sem rede, mostram o offline.html', async () => {
    const online = carregarSw();
    for (const rota of ['/', '/pedidos', '/perfil', '/privacidade']) {
      const resposta = await online.disparar(`${ORIGEM}${rota}`, { mode: 'navigate' });
      assert.equal(resposta.rede, true, rota);
    }
    const fora = carregarSw({ rede: 'fora' });
    assert.deepEqual(await fora.disparar(`${ORIGEM}/pedidos`, { mode: 'navigate' }), { offline: true });
  });

  test('estáticos do build: cache primeiro, rede se faltar', async () => {
    const sw = carregarSw();
    assert.deepEqual(await sw.disparar(`${ORIGEM}/offline.html`), { offline: true });
    assert.equal(sw.buscas.length, 0);
    const resposta = await sw.disparar(`${ORIGEM}/assets/novo-9.js`);
    assert.equal(resposta.rede, true);
    for (const rota of ['/icones/icone-192.png', '/splash/splash.css', '/confirmacao/confirmacao.js']) {
      assert.notEqual(sw.disparar(`${ORIGEM}${rota}`), null, rota);
    }
  });

  test('build: pré-carrega só estáticos, e a versão muda quando o site muda', () => {
    const dist = temporario('dist-sw-');
    const gravar = (rel, conteudo) => {
      fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
      fs.writeFileSync(path.join(dist, rel), conteudo);
    };
    gravar('index.html', '<html>');
    gravar('manifest.webmanifest', '{}');
    gravar('offline.html', '<html>offline');
    gravar('assets/index-abc.js', 'js');
    gravar('assets/index-abc.js.map', 'map');
    gravar('assets/fonte-1.woff2', 'fonte');
    gravar('icones/icone-192.png', 'png');
    gravar('splash/splash.css', 'css');
    gravar('confirmacao/confirmacao.js', 'js');
    gravar('sw.js', 'antigo');

    const lista = (sw) => JSON.parse(sw.match(/const ARQUIVOS = (\[.*\]);/)[1]);
    const versao = (sw) => sw.match(/const VERSAO = "(\w+)";/)[1];
    const primeiro = swDoBuild(dist);
    assert.deepEqual(lista(primeiro), [
      '/assets/fonte-1.woff2',
      '/assets/index-abc.js',
      '/confirmacao/confirmacao.js',
      '/icones/icone-192.png',
      '/offline.html',
      '/splash/splash.css',
    ]);
    assert.equal(swDoBuild(dist), primeiro, 'mesmo build = mesmo sw.js');
    gravar('index.html', '<html>nova versão');
    assert.notEqual(versao(swDoBuild(dist)), versao(primeiro));
    gravar('splash/splash.css', 'css novo');
    assert.notEqual(versao(swDoBuild(dist)), versao(primeiro));
  });
});

describe('convite para instalar', () => {
  const IPHONE_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  const IPHONE_CHROME =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

  test('Safari do iPhone/iPad sim; Chrome do iPhone, Android e Mac não', () => {
    assert.equal(ehSafariDoIos({ userAgent: IPHONE_SAFARI, platform: 'iPhone' }), true);
    assert.equal(ehSafariDoIos({ userAgent: IPAD, platform: 'MacIntel', maxTouchPoints: 5 }), true);
    assert.equal(ehSafariDoIos({ userAgent: IPAD, platform: 'MacIntel', maxTouchPoints: 0 }), false);
    assert.equal(ehSafariDoIos({ userAgent: IPHONE_CHROME, platform: 'iPhone' }), false);
    assert.equal(ehSafariDoIos({ userAgent: ANDROID, platform: 'Linux armv8l' }), false);
    assert.equal(ehSafariDoIos(), false);
  });

  test('aberto como app (Android ou iOS) é detectado; erro = não é app', () => {
    const win = (standalone, mm) => ({ navigator: { standalone }, matchMedia: () => ({ matches: mm }) });
    assert.equal(estaComoApp(win(undefined, true)), true);
    assert.equal(estaComoApp(win(true, false)), true);
    assert.equal(estaComoApp(win(false, false)), false);
    assert.equal(estaComoApp({ navigator: {}, matchMedia: () => { throw new Error('x'); } }), false);
  });

  test('o que mostrar', () => {
    const base = { comoApp: false, safariIos: false, podeInstalar: false, escolha: {} };
    assert.equal(oQueMostrar(base), null);
    assert.equal(oQueMostrar({ ...base, podeInstalar: true }), 'botao');
    assert.equal(oQueMostrar({ ...base, podeInstalar: true, escolha: { android: 'dispensado' } }), null);
    assert.equal(oQueMostrar({ ...base, podeInstalar: true, escolha: { android: 'instalado' } }), null);
    assert.equal(oQueMostrar({ ...base, safariIos: true }), 'dica-ios');
    assert.equal(oQueMostrar({ ...base, safariIos: true, escolha: { ios: 'fechado' } }), null);
    // Já como app: nada, nem botão nem dica.
    assert.equal(oQueMostrar({ ...base, comoApp: true, podeInstalar: true, safariIos: true }), null);
  });

  test('escolha lembrada no localStorage; storage quebrado ou corrompido não derruba', () => {
    const dados = new Map();
    const storage = { getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => dados.set(k, v) };
    assert.deepEqual(lerEscolha(storage), {});
    assert.equal(gravarEscolha({ ios: 'fechado' }, storage), true);
    gravarEscolha({ android: 'dispensado' }, storage);
    assert.deepEqual(lerEscolha(storage), { ios: 'fechado', android: 'dispensado' });

    dados.set(CHAVE_INSTALACAO, '{quebrado');
    assert.deepEqual(lerEscolha(storage), {});
    dados.set(CHAVE_INSTALACAO, '[1]');
    assert.deepEqual(lerEscolha(storage), {});

    const quebrado = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('cheio'); } };
    assert.deepEqual(lerEscolha(quebrado), {});
    assert.equal(gravarEscolha({ ios: 'fechado' }, quebrado), false);
  });
});
