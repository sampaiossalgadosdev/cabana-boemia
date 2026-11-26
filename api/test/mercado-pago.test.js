import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { semBancoDeTeste, resetarBancoDeTeste, raizApi } from './helpers/banco.js';
import { criarClienteMercadoPago, ErroMercadoPago, URL_AUTORIZACAO } from '../src/lib/mercadoPago.js';
import { criarState, lerState, origemPermitida, urlDeRetorno, VALIDADE_STATE_MS } from '../src/lib/estadoOauth.js';
import { decifrar } from '../src/lib/cifra.js';
import { urlParaLog } from '../src/app.js';

const REDIRECT = 'https://api.taakidelivery.com.br/api/mercadopago/oauth/retorno';
const CHAVE_HEX = 'cd'.repeat(32);
const SEGREDO_STATE = 'state-secreto-de-teste-com-mais-de-32-caracteres';
const CONFIG = { clientId: 'APP_ID_123', clientSecret: 'segredo-do-app', redirectUri: REDIRECT };

/** Mercado Pago falso: grava as chamadas e responde conforme o grant_type. */
function mercadoPagoFalso() {
  const chamadas = [];
  const respostas = { authorization_code: null, refresh_token: null };
  async function fetch(url, opcoes) {
    const corpo = JSON.parse(opcoes.body);
    chamadas.push({ url, corpo });
    const r = respostas[corpo.grant_type];
    if (r instanceof Error) throw r;
    const { status = 200, dados } = typeof r === 'function' ? r(corpo) : r;
    return new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json' } });
  }
  return { fetch, chamadas, respostas };
}

const tokenMp = (n, { userId = 111, expiraSeg = 15_552_000 } = {}) => ({
  dados: {
    access_token: `APP_USR-access-${n}`,
    refresh_token: `TG-refresh-${n}`,
    public_key: `APP_USR-public-${n}`,
    user_id: userId,
    expires_in: expiraSeg,
    token_type: 'bearer',
  },
});

describe('módulo do Mercado Pago (único ponto de saída)', () => {
  test('nenhum outro arquivo de src/ fala com mercadopago.com', () => {
    const achados = [];
    const varrer = (dir) => {
      for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, nome.name);
        if (nome.isDirectory()) varrer(p);
        else if (nome.name.endsWith('.js') && /mercadopago\.com/i.test(fs.readFileSync(p, 'utf8'))) achados.push(path.relative(raizApi, p));
      }
    };
    varrer(path.join(raizApi, 'src'));
    assert.deepEqual(achados.map((a) => a.replaceAll('\\', '/')), ['src/lib/mercadoPago.js']);
  });

  test('URL de autorização com client_id, response_type, platform_id, redirect_uri e state', () => {
    const url = new URL(criarClienteMercadoPago({ config: CONFIG, fetch: async () => {} }).montarUrlAutorizacao('abc.def'));
    assert.equal(`${url.origin}${url.pathname}`, URL_AUTORIZACAO);
    assert.equal(url.searchParams.get('client_id'), 'APP_ID_123');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('platform_id'), 'mp');
    assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
    assert.equal(url.searchParams.get('state'), 'abc.def');
  });

  test('troca do code e renovação: corpo certo e resposta normalizada', async () => {
    const mp = mercadoPagoFalso();
    mp.respostas.authorization_code = tokenMp(1);
    mp.respostas.refresh_token = tokenMp(2);
    const cliente = criarClienteMercadoPago({ config: CONFIG, fetch: mp.fetch });
    const agora = new Date('2026-11-26T12:00:00Z');
    const t = await cliente.trocarCodePorToken('TG-code', agora);
    assert.deepEqual(t, {
      accessToken: 'APP_USR-access-1',
      refreshToken: 'TG-refresh-1',
      publicKey: 'APP_USR-public-1',
      mpUserId: '111',
      expiraEm: new Date(agora.getTime() + 15_552_000_000),
    });
    assert.equal(mp.chamadas[0].url, 'https://api.mercadopago.com/oauth/token');
    assert.deepEqual(mp.chamadas[0].corpo, {
      client_id: 'APP_ID_123',
      client_secret: 'segredo-do-app',
      grant_type: 'authorization_code',
      code: 'TG-code',
      redirect_uri: REDIRECT,
    });
    const r = await cliente.renovarToken('TG-refresh-1', agora);
    assert.equal(r.refreshToken, 'TG-refresh-2');
    assert.deepEqual(mp.chamadas[1].corpo, {
      client_id: 'APP_ID_123',
      client_secret: 'segredo-do-app',
      grant_type: 'refresh_token',
      refresh_token: 'TG-refresh-1',
    });
  });

  test('recusa e falha de rede viram ErroMercadoPago sem token, code nem segredo na mensagem', async () => {
    const mp = mercadoPagoFalso();
    mp.respostas.authorization_code = { status: 400, dados: { error: 'invalid_grant', message: 'code TG-code inválido' } };
    const cliente = criarClienteMercadoPago({ config: CONFIG, fetch: mp.fetch });
    await assert.rejects(cliente.trocarCodePorToken('TG-code'), (err) => {
      assert.ok(err instanceof ErroMercadoPago);
      assert.equal(err.status, 400);
      assert.equal(err.codigo, 'invalid_grant');
      assert.ok(!/TG-code|segredo/.test(err.message));
      return true;
    });
    mp.respostas.refresh_token = new TypeError('fetch failed');
    await assert.rejects(cliente.renovarToken('x'), { name: 'ErroMercadoPago', codigo: 'REDE' });
    mp.respostas.refresh_token = { dados: { message: 'sem token' } };
    await assert.rejects(cliente.renovarToken('x'), { codigo: 'RESPOSTA_INVALIDA' });
  });
});

describe('state do OAuth e retorno', () => {
  const agora = new Date('2026-11-26T12:00:00Z');
  const dados = { lojaId: 2, usuarioId: 7, origem: 'https://taakidelivery.com.br' };

  test('válido: devolve loja, usuário e origem', () => {
    assert.deepEqual(lerState(criarState(dados, SEGREDO_STATE, agora), SEGREDO_STATE, agora), { ok: true, ...dados });
  });

  test('adulterado, com outro segredo ou malformado: STATE_INVALIDO e sem origem', () => {
    const s = criarState(dados, SEGREDO_STATE, agora);
    const [p, a] = s.split('.');
    const outroPayload = Buffer.from(JSON.stringify({ l: 1, u: 7, o: null, e: agora.getTime() + 1e6, n: 'x' })).toString('base64url');
    for (const ruim of [`${outroPayload}.${a}`, `${p}.${a.slice(0, -2)}xx`, 'lixo', '', null, `${s}.extra`]) {
      assert.deepEqual(lerState(ruim, SEGREDO_STATE, agora), { ok: false, motivo: 'STATE_INVALIDO', origem: null });
    }
    assert.equal(lerState(s, 'outro-segredo-com-mais-de-trinta-e-dois-caracteres', agora).motivo, 'STATE_INVALIDO');
  });

  test('vencido depois de 10 minutos: STATE_EXPIRADO (com a origem, a assinatura confere)', () => {
    const s = criarState(dados, SEGREDO_STATE, agora);
    assert.equal(lerState(s, SEGREDO_STATE, new Date(agora.getTime() + VALIDADE_STATE_MS)).ok, true);
    assert.deepEqual(lerState(s, SEGREDO_STATE, new Date(agora.getTime() + VALIDADE_STATE_MS + 1)), {
      ok: false,
      motivo: 'STATE_EXPIRADO',
      origem: 'https://taakidelivery.com.br',
    });
  });

  test('origem: só taakidelivery.com.br (e localhost fora de produção); o resto volta ao padrão', () => {
    assert.equal(origemPermitida('https://taakidelivery.com.br'), 'https://taakidelivery.com.br');
    assert.equal(origemPermitida('https://taakidelivery.com.br/parceiro', { producao: true }), 'https://taakidelivery.com.br');
    for (const ruim of [
      'https://cabana.managerpix.com.br',
      'https://api.taakidelivery.com.br',
      'https://taakidelivery.com.br.malicioso.com',
      'http://taakidelivery.com.br',
      'https://evil.com',
      'javascript:alert(1)',
      '',
      null,
    ]) {
      assert.equal(origemPermitida(ruim, { producao: true }), null, String(ruim));
    }
    assert.equal(origemPermitida('http://localhost:5174'), 'http://localhost:5174');
    assert.equal(origemPermitida('http://localhost:5174', { producao: true }), null);
    assert.equal(
      urlDeRetorno('https://taakidelivery.com.br', { mp: 'conectada' }, { producao: true }),
      'https://taakidelivery.com.br/admin/pagamento-online?mp=conectada',
    );
    assert.equal(
      urlDeRetorno('https://evil.com', { mp: 'erro', motivo: 'X' }, { producao: true }),
      'https://taakidelivery.com.br/parceiro?mp=erro&motivo=X',
    );
  });

  test('o log de acesso nunca leva a query do retorno (code e state)', () => {
    assert.equal(urlParaLog('/api/mercadopago/oauth/retorno?code=TG-1&state=a.b'), '/api/mercadopago/oauth/retorno');
    assert.equal(urlParaLog('/api/publico/cardapio?x=1'), '/api/publico/cardapio?x=1');
  });
});

describe('conexão da loja com o Mercado Pago (API)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let servico;
  let mp;
  let outra;
  const avisos = [];
  const tk = {};
  const env = {
    MP_CLIENT_ID: 'APP_ID_123',
    MP_CLIENT_SECRET: 'segredo-do-app',
    MP_REDIRECT_URI: REDIRECT,
    TOKEN_ENCRYPTION_KEY: CHAVE_HEX,
    MP_STATE_SECRET: SEGREDO_STATE,
    PAGAMENTO_ONLINE_ATIVO: '',
    NODE_ENV: 'production',
  };

  async function api(metodo, rota, { corpo, token, loja } = {}) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      redirect: 'manual',
      headers: {
        ...(token && { authorization: `Bearer ${token}` }),
        ...(loja && { 'x-loja': loja }),
        ...(corpo !== undefined && { 'content-type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, local: res.headers.get('location'), corpo: texto && texto.startsWith('{') ? JSON.parse(texto) : null };
  }

  const login = async (email, senha) => (await api('POST', '/auth/login', { corpo: { email, senha } })).corpo.accessToken;

  /** Conecta a loja (como o dono faria): pede a URL, "autoriza" e volta com o code. */
  async function conectar(token, { loja, code = 'TG-code' } = {}) {
    const r = await api('POST', '/retaguarda/pagamento-online/conectar', { token, loja, corpo: { origem: 'https://taakidelivery.com.br' } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const state = new URL(r.corpo.url).searchParams.get('state');
    return api('GET', `/mercadopago/oauth/retorno?code=${code}&state=${encodeURIComponent(state)}`);
  }

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarServicoConexaoMp } = await import('../src/services/conexaoMp.service.js');
    const usuarios = await import('../src/services/usuario.service.js');
    outra = await prisma.loja.create({ data: { slug: 'lanchonete-teste', nome: 'Lanchonete Teste' } });
    await usuarios.criarDono({ nome: 'Dono Cabana', email: 'dono@cabana.test', senha: 'senha-do-dono' });
    await usuarios.criarDono({ nome: 'Dono Outra', email: 'dono@outra.test', senha: 'senha-do-dono', lojaId: outra.id });
    await usuarios.criarAtendente({ nome: 'Ana', email: 'ana@cabana.test', senha: 'senha-da-ana' });
    await usuarios.criarDono({ nome: 'Plataforma', email: 'admin@teste.test', senha: 'senha-do-admin' });
    await usuarios.promoverAAdmin('admin@teste.test');

    mp = mercadoPagoFalso();
    const cliente = criarClienteMercadoPago({ config: CONFIG, fetch: mp.fetch });
    servico = criarServicoConexaoMp({ mercadoPago: cliente, env, log: { warn: (m) => avisos.push(m) } });
    servidor = http.createServer(criarApp({ log: false, conexaoMp: servico }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tk.cabana = await login('dono@cabana.test', 'senha-do-dono');
    tk.outra = await login('dono@outra.test', 'senha-do-dono');
    tk.ana = await login('ana@cabana.test', 'senha-da-ana');
    tk.admin = await login('admin@teste.test', 'senha-do-admin');
  });

  beforeEach(async () => {
    env.PAGAMENTO_ONLINE_ATIVO = '';
    mp.respostas.authorization_code = tokenMp(1);
    mp.respostas.refresh_token = tokenMp(2);
    avisos.length = 0;
    await prisma.alertaPlataforma.deleteMany();
    await prisma.conexaoMercadoPago.deleteMany();
    await prisma.loja.updateMany({ data: { pagamentoOnlineAtivo: false } });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('sem conexão: NAO_CONECTADA; atendente, DONO de outra loja e ADMIN sem loja são barrados', async () => {
    const r = await api('GET', '/retaguarda/pagamento-online', { token: tk.cabana });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, {
      situacao: 'NAO_CONECTADA',
      conta: null,
      conectadaEm: null,
      expiraEm: null,
      pagamentoOnlineAtivo: false,
      flagGlobal: false,
      configurado: true,
      pendentes: 0,
    });
    assert.equal((await api('POST', '/retaguarda/pagamento-online/conectar', { token: tk.ana, corpo: {} })).status, 403);
    const outraLoja = await api('POST', '/retaguarda/pagamento-online/conectar', { token: tk.outra, loja: 'cabana-boemia', corpo: {} });
    assert.equal(outraLoja.status, 403);
    assert.equal(outraLoja.corpo.erro.codigo, 'LOJA_PROIBIDA');
    assert.equal((await api('POST', '/retaguarda/pagamento-online/conectar', { token: tk.admin, corpo: {} })).corpo.erro.codigo, 'LOJA_OBRIGATORIA');
  });

  test('conectar e voltar: tokens gravados cifrados, volta para a tela com mp=conectada', async () => {
    const r = await conectar(tk.cabana);
    assert.equal(r.status, 302);
    assert.equal(r.local, 'https://taakidelivery.com.br/admin/pagamento-online?mp=conectada');
    assert.equal(mp.chamadas.at(-1).corpo.code, 'TG-code');

    const c = await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: 1 } });
    assert.equal(c.status, 'CONECTADA');
    assert.equal(c.mpUserId, '111');
    assert.equal(c.publicKey, 'APP_USR-public-1');
    for (const [campo, aberto] of [['accessTokenCifrado', 'APP_USR-access-1'], ['refreshTokenCifrado', 'TG-refresh-1']]) {
      assert.ok(!c[campo].includes(aberto), `${campo} gravado em texto`);
      assert.match(c[campo], /^v1\./);
      assert.equal(decifrar(c[campo], Buffer.from(CHAVE_HEX, 'hex')), aberto);
    }
    const s = (await api('GET', '/retaguarda/pagamento-online', { token: tk.cabana })).corpo;
    assert.equal(s.situacao, 'CONECTADA');
    assert.equal(s.conta, '111');
    assert.ok(s.expiraEm);
    assert.ok(!JSON.stringify(s).includes('APP_USR'));
  });

  test('ADMIN conecta a loja escolhida pelo X-Loja', async () => {
    const r = await conectar(tk.admin, { loja: 'lanchonete-teste' });
    assert.equal(r.local, 'https://taakidelivery.com.br/admin/pagamento-online?mp=conectada');
    assert.equal((await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: outra.id } })).status, 'CONECTADA');
  });

  test('origem fora da lista (ex.: o domínio antigo) volta para o padrão da retaguarda', async () => {
    const r = await api('POST', '/retaguarda/pagamento-online/conectar', { token: tk.cabana, corpo: { origem: 'https://cabana.managerpix.com.br' } });
    const state = new URL(r.corpo.url).searchParams.get('state');
    const volta = await api('GET', `/mercadopago/oauth/retorno?code=TG-code&state=${encodeURIComponent(state)}`);
    assert.equal(volta.local, 'https://taakidelivery.com.br/parceiro?mp=conectada');
  });

  test('state adulterado ou ausente: não troca o code e volta com o erro', async () => {
    const r = await api('POST', '/retaguarda/pagamento-online/conectar', { token: tk.cabana, corpo: { origem: 'https://taakidelivery.com.br' } });
    const state = new URL(r.corpo.url).searchParams.get('state');
    const antes = mp.chamadas.length;
    const adulterado = await api('GET', `/mercadopago/oauth/retorno?code=TG-code&state=${encodeURIComponent(state.slice(0, -3) + 'abc')}`);
    assert.equal(adulterado.local, 'https://taakidelivery.com.br/parceiro?mp=erro&motivo=STATE_INVALIDO');
    assert.equal((await api('GET', '/mercadopago/oauth/retorno?code=TG-code')).local, 'https://taakidelivery.com.br/parceiro?mp=erro&motivo=STATE_INVALIDO');
    assert.equal(mp.chamadas.length, antes);
    assert.equal(await prisma.conexaoMercadoPago.count(), 0);
  });

  test('state vencido (mais de 10 minutos) e autorização negada no Mercado Pago', async () => {
    const vencido = criarState({ lojaId: 1, usuarioId: 1, origem: 'https://taakidelivery.com.br' }, SEGREDO_STATE, new Date(Date.now() - 11 * 60 * 1000));
    assert.equal(
      (await api('GET', `/mercadopago/oauth/retorno?code=TG-code&state=${encodeURIComponent(vencido)}`)).local,
      'https://taakidelivery.com.br/admin/pagamento-online?mp=erro&motivo=STATE_EXPIRADO',
    );
    const valido = criarState({ lojaId: 1, usuarioId: 1, origem: 'https://taakidelivery.com.br' }, SEGREDO_STATE);
    assert.equal(
      (await api('GET', `/mercadopago/oauth/retorno?error=access_denied&state=${encodeURIComponent(valido)}`)).local,
      'https://taakidelivery.com.br/admin/pagamento-online?mp=erro&motivo=AUTORIZACAO_NEGADA',
    );
  });

  test('state feito para um DONO de outra loja não conecta esta loja', async () => {
    const donoOutra = await prisma.usuario.findUnique({ where: { email: 'dono@outra.test' } });
    const state = criarState({ lojaId: 1, usuarioId: donoOutra.id, origem: 'https://taakidelivery.com.br' }, SEGREDO_STATE);
    const r = await api('GET', `/mercadopago/oauth/retorno?code=TG-code&state=${encodeURIComponent(state)}`);
    assert.match(r.local, /motivo=SEM_PERMISSAO/);
    assert.equal(await prisma.conexaoMercadoPago.count(), 0);
  });

  test('troca do code recusada: erro na volta e no log só o status e o código', async () => {
    mp.respostas.authorization_code = { status: 400, dados: { error: 'invalid_grant' } };
    const r = await conectar(tk.cabana, { code: 'TG-segredo-do-code' });
    assert.match(r.local, /mp=erro&motivo=TROCA_FALHOU/);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /loja 1: troca do code falhou \(status 400, invalid_grant\)/);
    assert.ok(!avisos.join(' ').includes('TG-segredo-do-code'));
  });

  test('mesma conta Mercado Pago em duas lojas: recusada; depois de desconectar, pode', async () => {
    assert.match((await conectar(tk.cabana)).local, /mp=conectada/);
    assert.match((await conectar(tk.outra)).local, /mp=erro&motivo=CONTA_EM_OUTRA_LOJA/);
    assert.equal(await prisma.conexaoMercadoPago.count({ where: { lojaId: outra.id } }), 0);

    // Expirada também segura a conta.
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { status: 'EXPIRADA' } });
    assert.match((await conectar(tk.outra)).local, /CONTA_EM_OUTRA_LOJA/);

    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { status: 'CONECTADA' } });
    assert.equal((await api('POST', '/retaguarda/pagamento-online/desconectar', { token: tk.cabana, corpo: { confirmar: true } })).status, 200);
    assert.match((await conectar(tk.outra)).local, /mp=conectada/);
  });

  test('desconectar: primeiro o aviso com os pendentes; confirmado apaga os tokens e desliga a loja', async () => {
    await conectar(tk.cabana);
    env.PAGAMENTO_ONLINE_ATIVO = 'sim';
    assert.equal((await api('PUT', '/retaguarda/pagamento-online/ativo', { token: tk.cabana, corpo: { ativo: true } })).status, 200);
    const pedido = await prisma.pedido.create({
      data: { lojaId: 1, dataRef: new Date('2026-11-26T00:00:00Z'), canal: 'SITE', nomeCliente: 'X', status: 'AGUARDANDO_PAGAMENTO' },
    });
    await prisma.pagamento.create({
      data: { pedidoId: pedido.id, metodo: 'PIX', valorTotalCentavos: 1000, idempotencyKey: 'k-desconectar', expiraEm: new Date() },
    });

    const aviso = await api('POST', '/retaguarda/pagamento-online/desconectar', { token: tk.cabana, corpo: {} });
    assert.deepEqual(aviso.corpo, { desconectada: false, pendentes: 1 });
    assert.equal((await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: 1 } })).status, 'CONECTADA');

    const r = await api('POST', '/retaguarda/pagamento-online/desconectar', { token: tk.cabana, corpo: { confirmar: true } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.desconectada, true);
    assert.equal(r.corpo.situacao, 'NAO_CONECTADA');
    assert.equal(r.corpo.pagamentoOnlineAtivo, false);
    const c = await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: 1 } });
    assert.equal(c.status, 'DESCONECTADA');
    assert.equal(c.accessTokenCifrado, null);
    assert.equal(c.refreshTokenCifrado, null);
    assert.equal((await api('POST', '/retaguarda/pagamento-online/desconectar', { token: tk.cabana, corpo: { confirmar: true } })).corpo.erro.codigo, 'MP_NAO_CONECTADO');
    await prisma.pagamento.deleteMany();
    await prisma.pedido.delete({ where: { id: pedido.id } });
  });

  test('interruptor: travado com a flag global desligada ou sem conexão; desligar sempre pode', async () => {
    const ligar = () => api('PUT', '/retaguarda/pagamento-online/ativo', { token: tk.cabana, corpo: { ativo: true } });
    env.PAGAMENTO_ONLINE_ATIVO = 'sim';
    assert.equal((await ligar()).corpo.erro.codigo, 'MP_NAO_CONECTADO');
    await conectar(tk.cabana);
    env.PAGAMENTO_ONLINE_ATIVO = '';
    assert.equal((await ligar()).corpo.erro.codigo, 'PAGAMENTO_ONLINE_DESLIGADO');
    env.PAGAMENTO_ONLINE_ATIVO = 'sim';
    const ok = await ligar();
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.pagamentoOnlineAtivo, true);
    const desligar = await api('PUT', '/retaguarda/pagamento-online/ativo', { token: tk.cabana, corpo: { ativo: false } });
    assert.equal(desligar.corpo.pagamentoOnlineAtivo, false);
  });

  test('conectar sem a configuração do servidor: 503 com mensagem clara (a flag desligada não impede)', async () => {
    const chave = env.TOKEN_ENCRYPTION_KEY;
    env.TOKEN_ENCRYPTION_KEY = '';
    const r = await api('POST', '/retaguarda/pagamento-online/conectar', { token: tk.cabana, corpo: {} });
    env.TOKEN_ENCRYPTION_KEY = chave;
    assert.equal(r.status, 503);
    assert.equal(r.corpo.erro.codigo, 'PAGAMENTO_ONLINE_NAO_CONFIGURADO');
  });

  test('renovação diária: renova quem vence em menos de 30 dias e grava o refresh NOVO', async () => {
    await conectar(tk.cabana);
    const agora = new Date();
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { expiraEm: new Date(agora.getTime() + 10 * 86_400_000) } });
    mp.respostas.authorization_code = tokenMp(9, { userId: 222 });
    assert.match((await conectar(tk.outra)).local, /mp=conectada/); // vence em 180 dias: não renova

    assert.deepEqual(await servico.renovarVencendo(agora), { renovadas: 1, falharam: 0 });
    const ultima = mp.chamadas.at(-1).corpo;
    assert.equal(ultima.grant_type, 'refresh_token');
    assert.equal(ultima.refresh_token, 'TG-refresh-1');
    const c = await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: 1 } });
    const k = Buffer.from(CHAVE_HEX, 'hex');
    assert.equal(decifrar(c.refreshTokenCifrado, k), 'TG-refresh-2');
    assert.equal(decifrar(c.accessTokenCifrado, k), 'APP_USR-access-2');
    assert.ok(c.expiraEm > new Date(agora.getTime() + 100 * 86_400_000));
  });

  test('renovação que falha: EXPIRADA, pagamento online desligado e alerta para o ADMIN', async () => {
    await conectar(tk.cabana);
    env.PAGAMENTO_ONLINE_ATIVO = 'sim';
    await api('PUT', '/retaguarda/pagamento-online/ativo', { token: tk.cabana, corpo: { ativo: true } });
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { expiraEm: new Date(Date.now() + 86_400_000) } });
    mp.respostas.refresh_token = { status: 400, dados: { error: 'invalid_grant' } };

    assert.deepEqual(await servico.renovarVencendo(new Date()), { renovadas: 0, falharam: 1 });
    assert.equal((await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: 1 } })).status, 'EXPIRADA');
    assert.equal((await prisma.loja.findUnique({ where: { id: 1 } })).pagamentoOnlineAtivo, false);
    assert.ok(!avisos.join(' ').includes('TG-refresh'));

    const lista = await api('GET', '/plataforma/alertas', { token: tk.admin });
    assert.equal(lista.status, 200);
    assert.equal(lista.corpo.abertos.length, 1);
    const alerta = lista.corpo.abertos[0];
    assert.equal(alerta.tipo, 'RENOVACAO_MP_FALHOU');
    assert.equal(alerta.loja.slug, 'cabana-boemia');
    assert.match(alerta.mensagem, /400 invalid_grant/);
    assert.deepEqual((await api('GET', '/plataforma/alertas/contagem', { token: tk.admin })).corpo, { abertos: 1 });
    assert.equal((await api('GET', '/plataforma/alertas', { token: tk.cabana })).status, 403);

    assert.equal((await api('PATCH', `/plataforma/alertas/${alerta.id}/resolvido`, { token: tk.admin })).status, 204);
    assert.equal((await api('PATCH', `/plataforma/alertas/${alerta.id}/resolvido`, { token: tk.admin })).status, 404);
    const depois = (await api('GET', '/plataforma/alertas', { token: tk.admin })).corpo;
    assert.equal(depois.abertos.length, 0);
    assert.equal(depois.resolvidos[0].resolvidoPor, 'Plataforma');
    assert.deepEqual((await api('GET', '/plataforma/alertas/contagem', { token: tk.admin })).corpo, { abertos: 0 });

    const s = (await api('GET', '/retaguarda/pagamento-online', { token: tk.cabana })).corpo;
    assert.equal(s.situacao, 'EXPIRADA');
  });
});
