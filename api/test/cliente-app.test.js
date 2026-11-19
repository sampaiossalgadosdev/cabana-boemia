import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';
import { audiencesGoogle, criarVerificadorGoogle } from '../src/lib/google.js';
import {
  audiencesApple,
  criarVerificadorApple,
  criarRevogadorApple,
  credenciaisApple,
  clientSecretApple,
  hashNonce,
  EMISSOR_APPLE,
} from '../src/lib/apple.js';
import { validarSolicitacao } from '../src/routes/exclusao.routes.js';
import { contatoHtml, paginaPrivacidade, paginaTermos, VIGENCIA } from '../src/routes/legal.routes.js';

/**
 * App Delivery Abatiá: login nativo (Google com várias audiences, Apple),
 * refresh token do cliente, rate limit de /cliente/auth/*, exclusão de conta
 * e a página pública /excluir-conta. Google e Apple são simulados com chaves
 * RSA geradas aqui (assinatura, emissor, audience e validade conferidos de
 * verdade, sem rede). O fluxo do site (sem refresh) continua coberto em
 * cliente.test.js.
 */
const WEB = 'cliente-teste.apps.googleusercontent.com'; // GOOGLE_CLIENT_ID do test/setup.js
const ANDROID = 'android-teste.apps.googleusercontent.com';
const BUNDLE = 'br.com.deliveryabatia.app';
const KID_G = 'kid-google';
const KID_A = 'kid-apple';
const chaveGoogle = generateKeyPairSync('rsa', { modulusLength: 2048 });
const chaveApple = generateKeyPairSync('rsa', { modulusLength: 2048 });
const chaveIntrusa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (k) => k.publicKey.export({ type: 'spki', format: 'pem' });
const jwkApple = { ...chaveApple.publicKey.export({ format: 'jwk' }), kid: KID_A, alg: 'RS256', use: 'sig' };

let seq = 0;
const novoSub = (p) => `${p}-${++seq}-${randomUUID().slice(0, 8)}`;

function tokenGoogle(campos = {}, { chave = chaveGoogle } = {}) {
  return jwt.sign(
    { iss: 'https://accounts.google.com', aud: ANDROID, sub: novoSub('g'), email: 'ana@gmail.com', email_verified: true, name: 'Ana', ...campos },
    chave.privateKey,
    { algorithm: 'RS256', keyid: KID_G, expiresIn: '1h' },
  );
}

const NONCE = 'nonce-bruto-com-mais-de-16-caracteres';
function tokenApple(campos = {}, { chave = chaveApple, kid = KID_A, expiresIn = '1h' } = {}) {
  return jwt.sign(
    { iss: EMISSOR_APPLE, aud: BUNDLE, sub: novoSub('apple'), email: 'x1@privaterelay.appleid.com', email_verified: 'true', nonce: hashNonce(NONCE), ...campos },
    chave.privateKey,
    { algorithm: 'RS256', keyid: kid, expiresIn },
  );
}

// ───────────── Sem banco: regras puras ─────────────

test('audiencesGoogle: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_IDS, sem repetição nem vazios', () => {
  assert.deepEqual(audiencesGoogle({ GOOGLE_CLIENT_ID: 'web' }), ['web']);
  assert.deepEqual(audiencesGoogle({ GOOGLE_CLIENT_ID: 'web', GOOGLE_CLIENT_IDS: ' android , ios,,web ' }), ['web', 'android', 'ios']);
  assert.deepEqual(audiencesGoogle({ GOOGLE_CLIENT_IDS: 'android' }), ['android']);
  assert.deepEqual(audiencesGoogle({}), []);
});

test('verificador do Google aceita qualquer audience da lista e recusa as outras', async () => {
  const verificar = criarVerificadorGoogle({ clientIds: [WEB, ANDROID], obterCertificados: async () => ({ [KID_G]: pem(chaveGoogle) }) });
  assert.equal((await verificar(tokenGoogle({ aud: WEB, sub: 's1' }))).googleId, 's1');
  assert.equal((await verificar(tokenGoogle({ aud: ANDROID, sub: 's2' }))).googleId, 's2');
  await assert.rejects(verificar(tokenGoogle({ aud: 'outro.apps.googleusercontent.com' })), { status: 401, codigo: 'TOKEN_GOOGLE_INVALIDO' });
  await assert.rejects(verificar(tokenGoogle({}, { chave: chaveIntrusa })), { status: 401 });
  // compatível: `clientId` vazio explícito continua 503 (nunca verifica sem audience)
  const semId = criarVerificadorGoogle({ clientId: '', obterCertificados: async () => ({}) });
  await assert.rejects(semId(tokenGoogle()), { status: 503, codigo: 'GOOGLE_NAO_CONFIGURADO' });
});

test('audiencesApple: padrão é o bundle do app; APPLE_BUNDLE_IDS sobrescreve', () => {
  assert.deepEqual(audiencesApple({}), [BUNDLE]);
  assert.deepEqual(audiencesApple({ APPLE_BUNDLE_IDS: 'a.b.c, d.e.f' }), ['a.b.c', 'd.e.f']);
});

describe('verificador da Apple', () => {
  let buscas = 0;
  const verificar = criarVerificadorApple({
    audiences: [BUNDLE],
    obterChaves: async () => {
      buscas += 1;
      return { keys: [jwkApple] };
    },
  });

  test('token válido devolve appleId e e-mail verificado; chaves ficam em cache', async () => {
    const r = await verificar(tokenApple({ sub: 'apple-1' }), { nonce: NONCE });
    assert.deepEqual(r, { appleId: 'apple-1', email: 'x1@privaterelay.appleid.com' });
    await verificar(tokenApple(), { nonce: NONCE });
    assert.equal(buscas, 1);
  });

  test('recusa: outro bundle, outro emissor, vencido, assinatura falsa, kid desconhecido, nonce errado ou ausente', async () => {
    const recusa = (tok, nonce = NONCE) => assert.rejects(verificar(tok, { nonce }), { status: 401, codigo: 'TOKEN_APPLE_INVALIDO' });
    await recusa(tokenApple({ aud: 'com.outro.app' }));
    await recusa(tokenApple({ iss: 'https://evil.example.com' }));
    await recusa(tokenApple({}, { expiresIn: -10 }));
    await recusa(tokenApple({}, { chave: chaveIntrusa }));
    await recusa(tokenApple({}, { kid: 'kid-que-nao-existe' }));
    await recusa(tokenApple(), 'nonce-errado-com-mais-de-16-chars');
    await assert.rejects(verificar(tokenApple(), {}), { status: 401, codigo: 'TOKEN_APPLE_INVALIDO' }, 'sem nonce');
    await recusa('nao-e-um-jwt');
  });

  test('e-mail não verificado não é devolvido', async () => {
    const r = await verificar(tokenApple({ email_verified: 'false' }), { nonce: NONCE });
    assert.equal(r.email, null);
  });

  test('Apple fora do ar ao buscar as chaves: 503', async () => {
    const fora = criarVerificadorApple({ audiences: [BUNDLE], obterChaves: async () => { throw new Error('rede'); } });
    await assert.rejects(fora(tokenApple(), { nonce: NONCE }), { status: 503, codigo: 'APPLE_INDISPONIVEL' });
  });
});

describe('revogação na Apple (exclusão de conta)', () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credenciais = {
    teamId: 'TEAM123456',
    keyId: 'KEY1234567',
    privateKey: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    clientId: BUNDLE,
  };

  test('credenciais só com as três variáveis; a chave aceita \\n escapado', () => {
    assert.equal(credenciaisApple({ APPLE_TEAM_ID: 'T' }), null);
    const c = credenciaisApple({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: 'linha1\\nlinha2' });
    assert.deepEqual(c, { teamId: 'T', keyId: 'K', privateKey: 'linha1\nlinha2', clientId: BUNDLE });
  });

  test('client_secret é um ES256 com iss = team, sub = bundle, aud = Apple', () => {
    const s = clientSecretApple(credenciais);
    const p = jwt.verify(s, ec.publicKey.export({ type: 'spki', format: 'pem' }), { algorithms: ['ES256'] });
    assert.equal(p.iss, 'TEAM123456');
    assert.equal(p.sub, BUNDLE);
    assert.equal(p.aud, EMISSOR_APPLE);
    assert.equal(jwt.decode(s, { complete: true }).header.kid, 'KEY1234567');
  });

  test('troca o código por um refresh token e revoga; sem credenciais ou sem código não chama a Apple', async () => {
    const chamadas = [];
    const fetchFalso = async (url, { body }) => {
      chamadas.push({ url, corpo: Object.fromEntries(new URLSearchParams(body)) });
      if (url.endsWith('/auth/token')) return { ok: true, json: async () => ({ refresh_token: 'rt-apple' }) };
      return { ok: true, json: async () => ({}) };
    };
    const revogar = criarRevogadorApple({ credenciais, fetch: fetchFalso });
    assert.deepEqual(await revogar('codigo-1'), { revogado: true });
    assert.equal(chamadas[0].corpo.grant_type, 'authorization_code');
    assert.equal(chamadas[0].corpo.code, 'codigo-1');
    assert.equal(chamadas[1].corpo.token, 'rt-apple');
    assert.equal(chamadas[1].corpo.token_type_hint, 'refresh_token');

    assert.deepEqual(await criarRevogadorApple({ credenciais: null, fetch: fetchFalso })('c'), { revogado: false, motivo: 'APPLE_NAO_CONFIGURADO' });
    assert.deepEqual(await revogar(undefined), { revogado: false, motivo: 'SEM_CODIGO' });
    assert.equal(chamadas.length, 2);
  });

  test('código recusado ou Apple fora do ar: não lança, devolve o motivo', async () => {
    const recusa = criarRevogadorApple({ credenciais, fetch: async () => ({ ok: false, json: async () => ({ error: 'invalid_grant' }) }) });
    assert.deepEqual(await recusa('c'), { revogado: false, motivo: 'CODIGO_RECUSADO' });
    const fora = criarRevogadorApple({ credenciais, fetch: async () => { throw new Error('rede'); } });
    assert.deepEqual(await fora('c'), { revogado: false, motivo: 'APPLE_INDISPONIVEL' });
  });
});

test('formulário de exclusão: exige e-mail ou celular válido; normaliza', () => {
  assert.equal(validarSolicitacao({}).dados, null);
  assert.ok(validarSolicitacao({}).erros.geral);
  assert.ok(validarSolicitacao({ email: 'sem-arroba' }).erros.email);
  assert.ok(validarSolicitacao({ telefone: '123' }).erros.telefone);
  assert.deepEqual(validarSolicitacao({ nome: ' Ana ', email: ' Ana@Gmail.com ', telefone: '(43) 99999-0000' }).dados, {
    nome: 'Ana',
    email: 'ana@gmail.com',
    telefone: '43999990000',
    mensagem: null,
  });
});

test('páginas legais do app: em nome da plataforma, com todos os tópicos e a vigência', () => {
  const p = paginaPrivacidade('5543999990000');
  for (const trecho of [
    'controlador',
    'Delivery Abatiá',
    'nome e e-mail',
    'Telefone',
    'Endereços de entrega',
    'Histórico de pedidos',
    'Registros de acesso',
    'Para que usamos',
    'somente para preparar e entregar aquele pedido',
    'Railway',
    'Por quanto tempo guardamos',
    'art. 18',
    'ANPD',
    'Perfil › Excluir minha conta',
    'href="/excluir-conta"',
    'Contato',
    `Vigente desde ${VIGENCIA}`,
  ]) {
    assert.ok(p.includes(trecho), `privacidade sem: ${trecho}`);
  }
  const t = paginaTermos('');
  for (const trecho of ['Termos de uso', 'Cada loja é responsável', 'na entrega, direto à loja', 'Cancelamento', 'Código de Defesa do Consumidor', 'href="/privacidade-app"', `Vigente desde ${VIGENCIA}`]) {
    assert.ok(t.includes(trecho), `termos sem: ${trecho}`);
  }
  for (const html of [p, t]) {
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /Cabana Boemia/, 'em nome da plataforma, não da loja');
  }
});

test('contato das páginas legais: WhatsApp formatado quando existe; sempre o formulário', () => {
  assert.match(contatoHtml('5543999990000'), /href="https:\/\/wa\.me\/5543999990000">\(43\) 99999-0000</);
  assert.doesNotMatch(contatoHtml(''), /wa\.me/);
  assert.match(contatoHtml(''), /href="\/excluir-conta"/);
  assert.doesNotMatch(contatoHtml('<script>'), /<script/);
});

// ───────────── Com banco: rotas ─────────────

describe('app: login, sessão longa, exclusão de conta e /excluir-conta', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let raiz;
  let base;
  let centro;
  let produto;
  let tokenDono;
  const revogacoes = [];

  async function req(metodo, rota, { corpo, token, url, form } = {}) {
    const headers = {};
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    } else if (corpo !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(corpo);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${url ?? base}${rota}`, { method: metodo, headers, body, redirect: 'manual' });
    const texto = await res.text();
    let dados = texto;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      // HTML
    }
    return { status: res.status, headers: res.headers, corpo: dados };
  }

  const entrarGoogle = (campos, extra = { refresh: true }) =>
    req('POST', '/cliente/auth/google', { corpo: { credential: tokenGoogle(campos), ...extra } });
  const entrarApple = (campos, extra = {}) =>
    req('POST', '/cliente/auth/apple', { corpo: { identityToken: tokenApple(campos), nonce: NONCE, refresh: true, ...extra } });

  const HORA = 60 * 60 * 1000;
  /** Pedido do cliente; `horasAtras` = há quanto tempo foi criado (padrão: 4 h, fora da janela de 3 h). */
  async function pedidoDe(clienteId, status = 'FINALIZADO', horasAtras = 4) {
    seq += 1;
    return prisma.pedido.create({
      data: {
        numeroDia: seq,
        dataRef: new Date('2026-11-19T00:00:00Z'),
        canal: 'SITE',
        status,
        criadoEm: new Date(Date.now() - horasAtras * HORA),
        clienteId,
        nomeCliente: 'Ana Souza',
        telefone: '43999990000',
        enderecoTexto: 'Rua A, 10',
        bairroNome: 'Centro',
        subtotalCentavos: 3200,
        taxaEntregaCentavos: 500,
        totalCentavos: 3700,
        formaPagamento: 'PIX',
        itens: {
          create: [{ produtoId: produto.id, nomeSnapshot: 'X-Bacon', precoUnitarioCentavos: 1600, quantidade: 2, totalCentavos: 3200, observacao: 'sem cebola' }],
        },
      },
    });
  }

  const ouvir = (app) => new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarDono } = await import('../src/services/usuario.service.js');
    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });
    centro = await prisma.bairro.create({ data: { nome: 'Centro', taxaCentavos: 500 } });
    const cat = await prisma.categoria.create({ data: { nome: 'Lanches' } });
    produto = await prisma.produto.create({ data: { nome: 'X-Bacon', categoriaId: cat.id, precoCentavos: 1600 } });

    servidor = await ouvir(
      criarApp({
        log: false,
        limiteAuthCliente: 1000,
        limiteSolicitacoes: 3,
        verificarIdTokenGoogle: criarVerificadorGoogle({ clientIds: [WEB, ANDROID], obterCertificados: async () => ({ [KID_G]: pem(chaveGoogle) }) }),
        verificarIdentityTokenApple: criarVerificadorApple({ audiences: [BUNDLE], obterChaves: async () => ({ keys: [jwkApple] }) }),
        revogarApple: async (codigo) => {
          revogacoes.push(codigo);
          return { revogado: true };
        },
      }),
    );
    raiz = `http://127.0.0.1:${servidor.address().port}`;
    base = `${raiz}/api`;
    tokenDono = (await req('POST', '/auth/login', { corpo: { email: 'dono@teste.com', senha: 'senha-do-dono' } })).corpo.accessToken;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  // ───── Google ─────

  test('site (sem "refresh"): resposta igual à de antes, sem refreshToken e nada gravado', async () => {
    const r = await entrarGoogle({ aud: WEB }, {});
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.corpo).sort(), ['cliente', 'token']);
    assert.equal(await prisma.refreshTokenCliente.count({ where: { clienteId: r.corpo.cliente.id } }), 0);
  });

  test('app (refresh: true, audience do Android): recebe refreshToken; no banco só o hash', async () => {
    const r = await entrarGoogle({});
    assert.equal(r.status, 200);
    assert.equal(typeof r.corpo.refreshToken, 'string');
    const salvos = await prisma.refreshTokenCliente.findMany({ where: { clienteId: r.corpo.cliente.id } });
    assert.equal(salvos.length, 1);
    assert.notEqual(salvos[0].hash, r.corpo.refreshToken);
    const dias = (salvos[0].expiraEm - salvos[0].criadoEm) / 86_400_000;
    assert.ok(dias > 59.9 && dias < 60.1, `~60 dias (${dias})`);
  });

  // ───── Refresh ─────

  test('renovar gira o refresh: o novo vale, o antigo reapresentado derruba todas as sessões', async () => {
    const { refreshToken: r1, cliente } = (await entrarGoogle({})).corpo;
    const a = await req('POST', '/cliente/auth/renovar', { corpo: { refreshToken: r1 } });
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('cache-control'), 'no-store');
    assert.equal(jwt.decode(a.corpo.token).sub, String(cliente.id));
    assert.notEqual(a.corpo.refreshToken, r1);
    assert.equal((await req('GET', '/cliente/me', { token: a.corpo.token })).status, 200);

    const reuso = await req('POST', '/cliente/auth/renovar', { corpo: { refreshToken: r1 } });
    assert.equal(reuso.status, 401);
    assert.equal(reuso.corpo.erro.codigo, 'REFRESH_REUTILIZADO');
    const r2 = await req('POST', '/cliente/auth/renovar', { corpo: { refreshToken: a.corpo.refreshToken } });
    assert.equal(r2.status, 401, 'o refresh novo também caiu (possível roubo)');
  });

  test('renovar: desconhecido ou vencido = 401 REFRESH_INVALIDO; corpo inválido = 400', async () => {
    const x = await req('POST', '/cliente/auth/renovar', { corpo: { refreshToken: 'x'.repeat(43) } });
    assert.equal(x.status, 401);
    assert.equal(x.corpo.erro.codigo, 'REFRESH_INVALIDO');
    const { refreshToken, cliente } = (await entrarGoogle({})).corpo;
    await prisma.refreshTokenCliente.updateMany({ where: { clienteId: cliente.id }, data: { expiraEm: new Date(Date.now() - 1000) } });
    assert.equal((await req('POST', '/cliente/auth/renovar', { corpo: { refreshToken } })).corpo.erro.codigo, 'REFRESH_INVALIDO');
    assert.equal((await req('POST', '/cliente/auth/renovar', { corpo: {} })).status, 400);
  });

  test('duas renovações simultâneas com o mesmo refresh: só uma vence', async () => {
    const { refreshToken } = (await entrarGoogle({})).corpo;
    const [a, b] = await Promise.all([
      req('POST', '/cliente/auth/renovar', { corpo: { refreshToken } }),
      req('POST', '/cliente/auth/renovar', { corpo: { refreshToken } }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 401]);
  });

  test('sair revoga o refresh (idempotente)', async () => {
    const { refreshToken } = (await entrarGoogle({})).corpo;
    assert.equal((await req('POST', '/cliente/auth/sair', { corpo: { refreshToken } })).status, 204);
    assert.equal((await req('POST', '/cliente/auth/sair', { corpo: { refreshToken } })).status, 204);
    assert.equal((await req('POST', '/cliente/auth/renovar', { corpo: { refreshToken } })).status, 401);
  });

  // ───── Apple ─────

  test('Apple: cria o cliente com o nome mandado pelo app; o segundo login não troca o nome', async () => {
    const sub = novoSub('apple');
    const r = await entrarApple({ sub }, { nome: 'Bruno Lima' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.cliente.nome, 'Bruno Lima');
    assert.equal(r.corpo.cliente.email, 'x1@privaterelay.appleid.com');
    assert.equal(typeof r.corpo.refreshToken, 'string');
    assert.equal((await prisma.cliente.findUnique({ where: { appleId: sub } })).id, r.corpo.cliente.id);

    const de_novo = await entrarApple({ sub }, { nome: 'Outro Nome' });
    assert.equal(de_novo.corpo.cliente.id, r.corpo.cliente.id);
    assert.equal(de_novo.corpo.cliente.nome, 'Bruno Lima');
  });

  test('Apple sem nome: usa o começo do e-mail; token de outro app ou nonce errado = 401', async () => {
    const r = await entrarApple({ email: 'carla@icloud.com', email_verified: true });
    assert.equal(r.corpo.cliente.nome, 'carla');
    assert.equal((await entrarApple({ aud: 'com.outro.app' })).status, 401);
    assert.equal((await entrarApple({}, { nonce: 'x'.repeat(20) })).status, 401);
    assert.equal((await req('POST', '/cliente/auth/apple', { corpo: { identityToken: tokenApple() } })).status, 400, 'nonce obrigatório');
  });

  // ───── Rate limit ─────

  test('rate limit de /cliente/auth/*: só falhas contam; estourou = 429', async () => {
    const { criarApp } = await import('../src/app.js');
    const s = await ouvir(
      criarApp({
        log: false,
        limiteAuthCliente: 3,
        verificarIdTokenGoogle: criarVerificadorGoogle({ clientIds: [ANDROID], obterCertificados: async () => ({ [KID_G]: pem(chaveGoogle) }) }),
      }),
    );
    const url = `http://127.0.0.1:${s.address().port}/api`;
    try {
      for (let i = 0; i < 5; i++) {
        assert.equal((await req('POST', '/cliente/auth/google', { url, corpo: { credential: tokenGoogle() } })).status, 200);
      }
      for (let i = 0; i < 3; i++) {
        assert.equal((await req('POST', '/cliente/auth/renovar', { url, corpo: { refreshToken: 'y'.repeat(43) } })).status, 401);
      }
      const bloqueado = await req('POST', '/cliente/auth/google', { url, corpo: { credential: tokenGoogle() } });
      assert.equal(bloqueado.status, 429);
      assert.equal(bloqueado.corpo.erro.codigo, 'MUITAS_TENTATIVAS');
      // As outras rotas do cliente não entram no limite.
      assert.notEqual((await req('GET', '/cliente/me', { url })).status, 429);
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  // ───── Exclusão de conta ─────

  test('excluir com pedido de menos de 3 h (não cancelado, qualquer status): 409 PEDIDO_EM_ANDAMENTO e nada muda', async () => {
    const { token, cliente } = (await entrarGoogle({})).corpo;
    const p = await pedidoDe(cliente.id, 'CONFIRMADO', 0);
    const r = await req('DELETE', '/cliente/me', { token });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'PEDIDO_EM_ANDAMENTO');
    assert.ok(await prisma.cliente.findUnique({ where: { id: cliente.id } }));
    assert.equal((await prisma.pedido.findUnique({ where: { id: p.id } })).nomeCliente, 'Ana Souza');
  });

  test('janela de 3 h: finalizado recente bloqueia; cancelado recente não; aberto antigo (PDV nunca finalizou) não', async () => {
    const bloqueia = (await entrarGoogle({})).corpo;
    await pedidoDe(bloqueia.cliente.id, 'FINALIZADO', 2.9);
    const r1 = await req('DELETE', '/cliente/me', { token: bloqueia.token });
    assert.equal(r1.status, 409);
    assert.equal(r1.corpo.erro.codigo, 'PEDIDO_EM_ANDAMENTO');
    assert.match(r1.corpo.erro.mensagem, /3 horas/);

    const cancelado = (await entrarGoogle({})).corpo;
    await pedidoDe(cancelado.cliente.id, 'CANCELADO', 0);
    assert.equal((await req('DELETE', '/cliente/me', { token: cancelado.token })).status, 200);

    // Pedido que o PDV deixou em aberto (CONFIRMADO/ABERTO) há mais de 3 h: o cliente não fica preso.
    const preso = (await entrarGoogle({})).corpo;
    const antigo = await pedidoDe(preso.cliente.id, 'CONFIRMADO', 3.1);
    const r3 = await req('DELETE', '/cliente/me', { token: preso.token });
    assert.equal(r3.status, 200);
    assert.equal(r3.corpo.pedidosAnonimizados, 1);
    const p = await prisma.pedido.findUnique({ where: { id: antigo.id } });
    assert.equal(p.status, 'CONFIRMADO', 'o status do pedido não muda');
    assert.equal(p.nomeCliente, 'Cliente excluído');
  });

  test('excluir: apaga cliente, endereços e refresh; pedidos ficam com valores e itens, sem dados pessoais', async () => {
    const { token, refreshToken, cliente } = (await entrarGoogle({})).corpo;
    await req('PUT', '/cliente/me', { token, corpo: { nome: 'Ana Souza', telefone: '43999990000' } });
    const e = await req('POST', '/cliente/enderecos', { token, corpo: { rua: 'Rua A', numero: '10', bairroId: centro.id } });
    assert.equal(e.status, 201);
    const p1 = await pedidoDe(cliente.id, 'FINALIZADO');
    const p2 = await pedidoDe(cliente.id, 'CANCELADO');
    const outro = (await entrarGoogle({})).corpo;
    const pOutro = await pedidoDe(outro.cliente.id, 'FINALIZADO');

    const r = await req('DELETE', '/cliente/me', { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, { excluido: true, pedidosAnonimizados: 2, appleRevogado: null });

    assert.equal(await prisma.cliente.findUnique({ where: { id: cliente.id } }), null);
    assert.equal(await prisma.endereco.count({ where: { clienteId: cliente.id } }), 0);
    assert.equal(await prisma.refreshTokenCliente.count({ where: { clienteId: cliente.id } }), 0);
    for (const id of [p1.id, p2.id]) {
      const p = await prisma.pedido.findUnique({ where: { id }, include: { itens: true } });
      assert.equal(p.clienteId, null);
      assert.equal(p.nomeCliente, 'Cliente excluído');
      assert.equal(p.telefone, null);
      assert.equal(p.enderecoTexto, null);
      assert.equal(p.bairroNome, null);
      assert.equal(p.totalCentavos, 3700, 'valores ficam (registro fiscal)');
      assert.equal(p.itens.length, 1);
      assert.equal(p.itens[0].nomeSnapshot, 'X-Bacon');
    }
    assert.equal((await prisma.pedido.findUnique({ where: { id: pOutro.id } })).nomeCliente, 'Ana Souza', 'outro cliente intocado');

    assert.equal((await req('GET', '/cliente/me', { token })).status, 401, 'o token antigo morre');
    assert.equal((await req('POST', '/cliente/auth/renovar', { corpo: { refreshToken } })).status, 401);
    assert.equal((await req('DELETE', '/cliente/me', { token })).status, 401);
  });

  test('excluir conta da Apple: repassa o authorization code para revogar na Apple', async () => {
    const { token } = (await entrarApple({})).corpo;
    const r = await req('DELETE', '/cliente/me', { token, corpo: { appleAuthorizationCode: 'codigo-apple-123' } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.appleRevogado, true);
    assert.deepEqual(revogacoes, ['codigo-apple-123']);
  });

  test('entrar de novo depois de excluir cria uma conta nova, vazia', async () => {
    const sub = novoSub('g');
    const a = (await entrarGoogle({ sub })).corpo;
    await req('DELETE', '/cliente/me', { token: a.token });
    const b = (await entrarGoogle({ sub })).corpo;
    assert.notEqual(b.cliente.id, a.cliente.id);
    assert.equal(b.cliente.precisaTelefone, true);
  });

  // ───── Página /excluir-conta ─────

  test('GET /privacidade-app e /termos-app: HTML da API (fora do site), CSP sem script, indexáveis, WhatsApp da configuração', async () => {
    await prisma.configuracao.upsert({ where: { id: 1 }, create: { id: 1, whatsappNumero: '5543988887777' }, update: { whatsappNumero: '5543988887777' } });
    for (const caminho of ['/privacidade-app', '/termos-app']) {
      const r = await req('GET', caminho, { url: raiz });
      assert.equal(r.status, 200, caminho);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
      assert.equal(r.headers.get('x-robots-tag'), null, 'páginas legais podem ser indexadas');
      assert.doesNotMatch(r.corpo, /<script/);
      assert.match(r.corpo, /wa\.me\/5543988887777/);
    }
    assert.match((await req('GET', '/privacidade-app', { url: raiz })).corpo, /Política de privacidade/);
    assert.match((await req('GET', '/termos-app', { url: raiz })).corpo, /Termos de uso/);
  });

  test('GET /excluir-conta: HTML próprio da API, sem cache, CSP sem script', async () => {
    const r = await req('GET', '/excluir-conta', { url: raiz });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(r.corpo, /Perfil › Excluir minha conta/);
    assert.match(r.corpo, /3 horas/);
    assert.match(r.corpo, /href="\/privacidade-app"/);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex');
    assert.match(r.corpo, /<form method="post"/);
    assert.doesNotMatch(r.corpo, /<script/);
  });

  test('POST /excluir-conta: inválido = 400 com o erro; válido grava e redireciona; isca não grava', async () => {
    const ruim = await req('POST', '/excluir-conta', { url: raiz, form: { nome: '<b>x</b>' } });
    assert.equal(ruim.status, 400);
    assert.match(ruim.corpo, /Informe o e-mail da conta ou o celular/);
    assert.match(ruim.corpo, /&lt;b&gt;x&lt;\/b&gt;/, 'valor devolvido escapado');

    const ok = await req('POST', '/excluir-conta', { url: raiz, form: { nome: 'Ana', email: 'Ana@Gmail.com', mensagem: 'apaguem' } });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/excluir-conta?enviado=1');
    const salvas = await prisma.solicitacaoExclusao.findMany();
    assert.equal(salvas.length, 1);
    assert.equal(salvas[0].email, 'ana@gmail.com');

    const isca = await req('POST', '/excluir-conta', { url: raiz, form: { email: 'robo@x.com', site: 'http://spam' } });
    assert.equal(isca.status, 303);
    assert.equal(await prisma.solicitacaoExclusao.count(), 1);

    assert.match((await req('GET', '/excluir-conta?enviado=1', { url: raiz })).corpo, /Pedido recebido/);
  });

  test('POST /excluir-conta: limite de envios por hora (429)', async () => {
    const r = await req('POST', '/excluir-conta', { url: raiz, form: { email: 'z@z.com' } });
    assert.equal(r.status, 429, 'quarto envio do mesmo IP nesta hora (limite 3 no teste)');
  });

  test('retaguarda: dono lista as solicitações e marca como atendida; atendente/anônimo não', async () => {
    const lista = await req('GET', '/retaguarda/solicitacoes-exclusao', { token: tokenDono });
    assert.equal(lista.status, 200);
    assert.equal(lista.corpo.pendentes.length, 1);
    const id = lista.corpo.pendentes[0].id;
    assert.equal((await req('PATCH', `/retaguarda/solicitacoes-exclusao/${id}/atendida`, { token: tokenDono })).status, 204);
    assert.equal((await req('PATCH', `/retaguarda/solicitacoes-exclusao/${id}/atendida`, { token: tokenDono })).status, 404);
    const depois = (await req('GET', '/retaguarda/solicitacoes-exclusao', { token: tokenDono })).corpo;
    assert.equal(depois.pendentes.length, 0);
    assert.equal(depois.atendidas.length, 1);
    assert.equal((await req('GET', '/retaguarda/solicitacoes-exclusao')).status, 401);
  });
});
