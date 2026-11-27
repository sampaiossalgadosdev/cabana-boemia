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
import { lerConfigLanding, TEXTO_IPHONE_PADRAO } from '../src/lib/landing.js';

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
        landingTaaki: lerConfigLanding({}),
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
      assert.match(r.corpo, /O delivery de Abatiá, <em>num app só\.<\/em>/, host);
      // Os dois acessos no topo da página (hero).
      assert.match(r.corpo, /class="botao botao--principal" href="#em-breve">Quero pedir/, host);
      // "Sou parceiro" leva à seção da própria página (o /parceiro é o painel, noindex).
      assert.match(r.corpo, /class="botao botao--contorno" href="#parceiros">Sou parceiro/, host);
      assert.doesNotMatch(r.corpo, /href="[^"]*\/parceiro"[^>]*>Sou parceiro/, host);
      for (const link of ['/privacidade-app', '/termos-app', '/excluir-conta']) assert.match(r.corpo, new RegExp(`href="${link}"`), host);
      assert.match(r.corpo, /mailto:contato@exemplo\.com/, host);
      assert.doesNotMatch(r.corpo.replace(/<script type="application\/ld\+json">/g, ''), /<script/i, 'sem script (só o JSON-LD)');
      // Canonical sempre no domínio principal (o primeiro dos hosts), venha por www. ou api.
      assert.match(r.corpo, /<link rel="canonical" href="https:\/\/taakidelivery\.com\.br\/">/, host);
      assert.match(r.headers['content-security-policy'], /default-src 'none'/, host);
    }
    // HEAD também.
    assert.equal((await pedir(porta, '/', { host: 'taakidelivery.com.br', metodo: 'HEAD' })).status, 200);
  });

  test('landing sem e-mail configurado: rodapé só com os links', async () => {
    const app = criarApp({ log: false, distSite: site, distRetaguarda: admin, hostsTaaki: ['t.test'], destinosApp: lerDestinosDoApp({}), emailTitular: null, landingTaaki: lerConfigLanding({}) });
    const s = http.createServer(app);
    await new Promise((resolve) => s.listen(0, resolve));
    try {
      const r = await pedir(s.address().port, '/', { host: 't.test' });
      assert.equal(r.status, 200);
      assert.doesNotMatch(r.corpo, /mailto:/);
      assert.doesNotMatch(r.corpo, /Quero ser parceiro/, 'sem e-mail não há contato de parceiro');
      assert.match(r.corpo, /href="\/excluir-conta"/);
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  test('antes do lançamento /app (destino do QR impresso) mostra "Em breve nas lojas"; /parceiro para a retaguarda', async () => {
    for (const host of HOSTS_TAAKI_PADRAO) {
      for (const rota of ['/app', '/app/', '/app?origem=banner', '/app/?origem=panfleto&x=1']) {
        for (const ua of [ANDROID, IOS]) {
          const app = await pedir(porta, rota, { host, cabecalhos: { 'User-Agent': ua } });
          assert.equal(app.status, 200, `${host}${rota}`);
          assert.match(app.headers['content-type'], /^text\/html/);
          assert.equal(app.headers['cache-control'], 'no-cache');
          assert.match(app.headers['content-security-policy'], /default-src 'none'/);
          assert.match(app.corpo, /<title>Taaki Delivery: baixe o app<\/title>/);
          assert.match(app.corpo, /<h1>Em breve nas lojas<\/h1>/);
          assert.match(app.corpo, /O app do Taaki Delivery está chegando\. Fique de olho!/);
          assert.match(app.corpo, /<img class="logo" src="\/taaki\/logo\.jpg"/);
          assert.match(app.corpo, /#0A1428/);
          assert.match(app.corpo, /#F26B1D/);
          assert.match(app.corpo, /font-family:"Poppins"/);
          assert.match(app.corpo, /<meta name="robots" content="noindex">/);
          assert.doesNotMatch(app.corpo, /<script/i, 'sem script');
          assert.doesNotMatch(app.corpo, /Montserrat/, 'só Poppins');
        }
      }
      const head = await pedir(porta, '/app', { host, metodo: 'HEAD' });
      assert.equal(head.status, 200, host);
      const parceiro = await pedir(porta, '/parceiro', { host });
      assert.equal(parceiro.status, 302, host);
      assert.equal(parceiro.headers.location, '/admin/');
      const retaguarda = await pedir(porta, '/admin/', { host });
      assert.equal(retaguarda.status, 200, host);
      assert.match(retaguarda.corpo, /id="admin"/, 'a retaguarda continua em /admin em todos os hosts');
    }
  });

  test('app lançado: /app vai para o Google Play (o iPhone também, sem TAAKI_APP_URL_IOS)', async () => {
    const s = http.createServer(criarApp({ log: false, distSite: site, distRetaguarda: admin, hostsTaaki: ['t.test'], destinosApp: lerDestinosDoApp({}), landingTaaki: lerConfigLanding({ TAAKI_APP_LANCADO: 'sim' }) }));
    await new Promise((resolve) => s.listen(0, resolve));
    try {
      const p = s.address().port;
      for (const ua of [ANDROID, IOS]) {
        const r = await pedir(p, '/app', { host: 't.test', cabecalhos: { 'User-Agent': ua } });
        assert.equal(r.status, 302);
        assert.equal(r.headers.location, APP_URL_PADRAO);
        assert.equal(r.headers['cache-control'], 'no-store');
      }
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  test('/app configurável (app lançado): TAAKI_APP_URL e TAAKI_APP_URL_IOS', async () => {
    const destinosApp = lerDestinosDoApp({ TAAKI_APP_URL: 'https://app.exemplo.com/baixar', TAAKI_APP_URL_IOS: 'https://apps.apple.com/app/id1' });
    const s = http.createServer(criarApp({ log: false, distSite: site, distRetaguarda: admin, hostsTaaki: ['t.test'], destinosApp, landingTaaki: lerConfigLanding({ TAAKI_APP_LANCADO: 'sim' }) }));
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
      // Topo e rodapé da landing; "Pedir agora" volta para a seção da landing.
      assert.match(r.corpo, /class="topo"/, rota);
      assert.match(r.corpo, /href="\/#em-breve">Pedir agora/, rota);
      assert.match(r.corpo, /href="\/excluir-conta"/, rota);
      assert.match(r.corpo, /noindex/, rota);
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
    // Arquivos da landing.
    for (const [rota, tipo] of [
      ['/taaki/logo.jpg', /^image\/jpeg/],
      ['/taaki/compartilhar.jpg', /^image\/jpeg/],
      ['/taaki/icone-180.png', /^image\/png/],
      ['/taaki/favicon.svg', /^image\/svg\+xml/],
      ['/taaki/montserrat-800.woff2', /^font\/woff2/],
      ['/taaki/poppins-400.woff2', /^font\/woff2/],
      ['/taaki/poppins-600.woff2', /^font\/woff2/],
      ['/taaki/poppins-700.woff2', /^font\/woff2/],
    ]) {
      const r = await pedir(porta, rota, { host });
      assert.equal(r.status, 200, rota);
      assert.match(r.headers['content-type'], tipo, rota);
      assert.match(r.headers['cache-control'], /max-age=86400/, rota);
    }
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
        // Paleta do Taaki, não mais o vermelho e o creme da Cabana.
        assert.match(r.corpo, /#0A1428/, `${host}${rota}`);
        assert.doesNotMatch(r.corpo, /#C8102E|#FBF3E8|#9E0B22/i, `${host}${rota}`);
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

describe('landing do Taaki: modo "Em breve" e conteúdo', () => {
  /** Sobe um servidor com a configuração da landing lida deste ambiente falso. */
  async function landingCom(env, { email = 'contato@exemplo.com' } = {}) {
    const s = http.createServer(
      criarApp({ log: false, hostsTaaki: ['taakidelivery.com.br'], destinosApp: lerDestinosDoApp({}), emailTitular: email, landingTaaki: lerConfigLanding(env) }),
    );
    await new Promise((resolve) => s.listen(0, resolve));
    try {
      return await pedir(s.address().port, '/', { host: 'taakidelivery.com.br' });
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  }

  test('sem TAAKI_APP_LANCADO: "Em breve", os botões levam à seção da fase de testes', async () => {
    for (const valor of [undefined, '', 'não', 'nao', '1', 'true']) {
      const r = await landingCom({ TAAKI_APP_LANCADO: valor });
      assert.equal(r.status, 200, String(valor));
      assert.doesNotMatch(r.corpo, /href="\/app"/, `nenhum link para /app (${valor})`);
      // Hero e chamada final, com o selo.
      assert.equal(r.corpo.match(/href="#em-breve">Quero pedir<span class="selo">Em breve na Google Play e na App Store<\/span>/g)?.length, 2, String(valor));
      assert.match(r.corpo, /class="topo-pedir" href="#em-breve">Pedir agora/);
      assert.match(r.corpo, /<section class="em-breve" id="em-breve"/);
      assert.match(r.corpo, /fase de testes/);
      assert.match(r.corpo, /anunciado no nosso Instagram/);
    }
  });

  test('TAAKI_APP_LANCADO=sim: os botões vão para /app e o "Em breve" some', async () => {
    for (const valor of ['sim', ' SIM ', 'Sim']) {
      const r = await landingCom({ TAAKI_APP_LANCADO: valor });
      assert.equal(r.corpo.match(/class="botao [^"]+" href="\/app">Quero pedir<\/a>/g)?.length, 2, valor);
      assert.match(r.corpo, /class="topo-pedir" href="\/app">Pedir agora/, valor);
      assert.doesNotMatch(r.corpo, /#em-breve|id="em-breve"|Em breve na Google Play|App Store|fase de testes/, valor);
    }
  });

  test('TAAKI_FAQ_IPHONE e TAAKI_INSTAGRAM_URL', async () => {
    const padrao = await landingCom({});
    assert.ok(padrao.corpo.includes(TEXTO_IPHONE_PADRAO));
    assert.doesNotMatch(padrao.corpo, /Seguir no Instagram/, 'sem perfil configurado, sem link');
    const r = await landingCom({ TAAKI_FAQ_IPHONE: 'Já está na <App Store>.', TAAKI_INSTAGRAM_URL: 'https://instagram.com/exemplo' });
    assert.ok(r.corpo.includes('Já está na &lt;App Store&gt;.'), 'texto escapado');
    assert.ok(!r.corpo.includes(TEXTO_IPHONE_PADRAO));
    assert.match(r.corpo, /href="https:\/\/instagram\.com\/exemplo"[^>]*>Seguir no Instagram/);
    assert.doesNotMatch((await landingCom({ TAAKI_INSTAGRAM_URL: 'javascript:alert(1)' })).corpo, /Seguir no Instagram|javascript:/);
  });

  test('estrutura, Open Graph, contato de parceiro, FAQ sem script e ano automático', async () => {
    const r = await landingCom({});
    const c = r.corpo;
    assert.doesNotMatch(c.replace(/<script type="application\/ld\+json">/g, ''), /<script/i);
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
    assert.match(r.headers['content-security-policy'], /font-src 'self'/);
    assert.doesNotMatch(r.headers['content-security-policy'], /script-src/);
    for (const id of ['como-funciona', 'por-que', 'parceiros', 'perguntas']) assert.match(c, new RegExp(`id="${id}"`), id);
    assert.match(c, /<title>Taaki Delivery · O delivery de Abatiá, num app só<\/title>/);
    assert.match(c, /<meta name="description" content="[^"]+">/);
    assert.match(c, /property="og:image" content="https:\/\/taakidelivery\.com\.br\/taaki\/compartilhar\.jpg"/);
    assert.match(c, /property="og:url" content="https:\/\/taakidelivery\.com\.br\/"/);
    assert.match(c, /rel="icon" href="\/taaki\/favicon\.svg"/);
    // Imagens com tamanho declarado (sem pular o layout).
    for (const img of c.match(/<img [^>]+>/g)) assert.match(img, /width="\d+" height="\d+"/, img);
    // FAQ em <details> (5 perguntas), com a exclusão de conta.
    assert.equal(c.match(/<details>/g)?.length, 5);
    assert.match(c, /<summary>Como faço para excluir minha conta\?<\/summary><p>[^<]*<a href="\/excluir-conta">/);
    // Parceiro: painel e contato por e-mail.
    assert.match(c, /href="\/parceiro" rel="nofollow">Acessar painel do parceiro/);
    assert.match(c, /href="mailto:contato@exemplo\.com\?subject=Quero%20ser%20parceiro%20do%20Taaki%20Delivery">/);
    assert.match(c, /Quero ser parceiro<\/a>/);
    assert.match(c, /Bateu a fome\? Peça pelo Taaki\./);
    assert.match(c, /Taaki Delivery · Abatiá-PR/);
    const ano = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date());
    assert.match(c, new RegExp(`© ${ano} Taaki Delivery`));
  });

  test('fontes: só Montserrat e Poppins', async () => {
    const c = (await landingCom({})).corpo;
    const familias = new Set([...c.matchAll(/font-family:"([^"]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...familias].sort(), ['Montserrat', 'Poppins']);
    assert.doesNotMatch(c, /Bricolage|system-ui|Segoe UI|Roboto/);
  });

  test('FAQ: lojas sem promessa e pagamento no app pelo Mercado Pago', async () => {
    const c = (await landingCom({})).corpo;
    assert.match(c, /<summary>Quais lojas estão no Taaki\?<\/summary><p>As lojas parceiras de Abatiá aparecem direto no app\.<\/p>/);
    assert.match(c, /<summary>Como eu pago\?<\/summary><p>O pagamento é feito no próprio app, na hora de finalizar o pedido, de forma segura pelo Mercado Pago\.<\/p>/);
    assert.doesNotMatch(c, /direto com a loja|Pague na entrega|pagamento é feito na entrega|Pagamento na entrega/i);
    assert.doesNotMatch(c, /formas aceitas|Novas lojas/i);
  });

  test('não promete o que o app não tem nem inventa números', async () => {
    for (const env of [{}, { TAAKI_APP_LANCADO: 'sim' }]) {
      const texto = (await landingCom(env)).corpo.replace(/<style>[^]*?<\/style>/, '');
      for (const proibido of [
        /acompanh/i, // o cliente não vê o status do pedido no app (fora da v1)
        /rastre/i,
        /no mapa/i,
        /entregador/i,
        /milhares|centenas/i,
        /avalia[çc]/i,
        /depoimento/i,
        /\d+\s*(lojas|clientes|pedidos|parceiros)/i,
        /comiss[ãa]o|mensalidade/i,
      ]) {
        assert.doesNotMatch(texto, proibido, String(proibido));
      }
    }
  });
});

describe('SEO dos domínios do Taaki', () => {
  let servidor;
  let porta;
  const host = 'api.taakidelivery.com.br'; // acesso por um host que não é o principal
  before(async () => {
    servidor = http.createServer(
      criarApp({
        log: false,
        hostsTaaki: ['taakidelivery.com.br', 'www.taakidelivery.com.br', 'api.taakidelivery.com.br'],
        destinosApp: lerDestinosDoApp({}),
        emailTitular: 'contato@exemplo.com',
        landingTaaki: lerConfigLanding({ TAAKI_INSTAGRAM_URL: 'https://www.instagram.com/taakidelivery?igsh=abc&utm_source=qr' }),
      }),
    );
    await new Promise((resolve) => servidor.listen(0, resolve));
    porta = servidor.address().port;
  });
  after(() => new Promise((resolve) => servidor.close(resolve)));

  test('JSON-LD da home: Organization, WebSite e WebPage válidos, sem FAQ nem avaliação', async () => {
    const c = (await pedir(porta, '/', { host })).corpo;
    const blocos = [...c.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)];
    assert.equal(blocos.length, 1);
    const dados = JSON.parse(blocos[0][1]);
    const porTipo = Object.fromEntries(dados['@graph'].map((n) => [n['@type'], n]));
    assert.deepEqual(Object.keys(porTipo).sort(), ['Organization', 'WebPage', 'WebSite']);
    const org = porTipo.Organization;
    assert.equal(org['@id'], 'https://taakidelivery.com.br/#organization');
    assert.equal(org.logo.url, 'https://taakidelivery.com.br/taaki/logo.jpg');
    assert.equal(org.email, 'contato@exemplo.com');
    assert.deepEqual(org.sameAs, ['https://www.instagram.com/taakidelivery']);
    assert.equal(org.areaServed.name, 'Abatiá');
    assert.equal(porTipo.WebPage.name, c.match(/<title>([^<]+)<\/title>/)[1]);
    assert.doesNotMatch(blocos[0][1], /FAQPage|AggregateRating|Review|telephone|address/);
    // Link do Instagram sem rastreio também na página.
    assert.doesNotMatch(c, /igsh|utm_/);
    assert.match(c, /<meta name="robots" content="index, follow, max-image-preview:large">/);
    for (const nome of ['twitter:title', 'twitter:description', 'twitter:image']) assert.match(c, new RegExp(`name="${nome}" content="[^"]+"`), nome);
    assert.match(c, /<link rel="manifest" href="\/site\.webmanifest">/);
    assert.equal(c.match(/<h1[ >]/g).length, 1);
    assert.match(c, /href="\/parceiro" rel="nofollow">Acessar painel do parceiro/);
  });

  test('robots.txt, sitemap.xml, llms.txt e manifesto', async () => {
    const robots = await pedir(porta, '/robots.txt', { host });
    assert.equal(robots.status, 200);
    assert.match(robots.headers['content-type'], /^text\/plain/);
    assert.match(robots.corpo, /Sitemap: https:\/\/taakidelivery\.com\.br\/sitemap\.xml/);
    assert.doesNotMatch(robots.corpo, /Disallow: \/parceiro/, 'bloqueado, o Google não leria o noindex');

    const mapa = await pedir(porta, '/sitemap.xml', { host });
    assert.equal(mapa.status, 200);
    assert.match(mapa.headers['content-type'], /^application\/xml/);
    const locs = [...mapa.corpo.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(locs, ['https://taakidelivery.com.br/', 'https://taakidelivery.com.br/privacidade-app', 'https://taakidelivery.com.br/termos-app']);
    assert.match(mapa.corpo, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);

    const llms = await pedir(porta, '/llms.txt', { host });
    assert.equal(llms.status, 200);
    assert.match(llms.headers['content-type'], /^text\/plain/);
    assert.match(llms.corpo, /^# Taaki Delivery/);
    assert.match(llms.corpo, /Abatiá-PR/);
    for (const proibido of [/acompanh/i, /rastre/i, /entregador/i, /comiss[ãa]o|mensalidade/i]) assert.doesNotMatch(llms.corpo, proibido);

    const manifesto = await pedir(porta, '/site.webmanifest', { host });
    assert.equal(manifesto.status, 200);
    assert.equal(JSON.parse(manifesto.corpo).theme_color, '#0A1428');
  });

  test('/parceiro com noindex; endereço inexistente = 404 de verdade', async () => {
    const parceiro = await pedir(porta, '/parceiro', { host });
    assert.equal(parceiro.status, 302);
    assert.match(parceiro.headers['x-robots-tag'], /noindex/);
    const nada = await pedir(porta, '/uma-url-que-nao-existe', { host });
    assert.equal(nada.status, 404);
    assert.match(nada.corpo, /<meta name="robots" content="noindex">/);
    assert.match(nada.corpo, /href="\/#parceiros">Sou parceiro/);
  });

  test('páginas legais: description, canonical no domínio principal e link para o início', async () => {
    for (const caminho of ['/privacidade-app', '/termos-app', '/excluir-conta']) {
      const c = (await pedir(porta, caminho, { host: 'cabana.managerpix.com.br' })).corpo;
      assert.match(c, /<html lang="pt-BR">/, caminho);
      const descricao = c.match(/<meta name="description" content="([^"]+)">/)?.[1];
      assert.ok(descricao && descricao.length <= 160, caminho);
      assert.match(c, new RegExp(`<link rel="canonical" href="https://taakidelivery\\.com\\.br${caminho}">`), caminho);
      assert.match(c, /<a href="https:\/\/taakidelivery\.com\.br\/">Início do Taaki Delivery<\/a>/, caminho);
    }
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
