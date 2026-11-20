import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { semBancoDeTeste, resetarBancoDeTeste, raizApi } from './helpers/banco.js';

describe('autenticação e usuários', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let tokenDono;

  const DONO = { nome: 'Dono Teste', email: 'dono@teste.com', senha: 'senha-do-dono' };
  const ATENDENTE = { nome: 'Ana Atendente', email: 'ana@teste.com', senha: 'senha-da-ana' };

  async function api(metodo, rota, { corpo, token } = {}) {
    const headers = {};
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  const login = (email, senha) => api('POST', '/auth/login', { corpo: { email, senha } });

  async function iniciarApp(opcoes) {
    const { criarApp } = await import('../src/app.js');
    const app = criarApp({ log: false, ...opcoes });
    return new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
  }

  before(async () => {
    resetarBancoDeTeste();
    // Import dinâmico: o setup.js já apontou DATABASE_URL para o banco de teste.
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { criarDono } = await import('../src/services/usuario.service.js');
    await criarDono(DONO);

    servidor = await iniciarApp();
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tokenDono = (await login(DONO.email, DONO.senha)).corpo.accessToken;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('login com email e senha corretos devolve tokens e usuário', async () => {
    const r = await login('  DONO@teste.com ', DONO.senha);
    assert.equal(r.status, 200);
    assert.equal(typeof r.corpo.accessToken, 'string');
    assert.equal(typeof r.corpo.refreshToken, 'string');
    assert.deepEqual(
      { ...r.corpo.usuario, id: undefined },
      {
        id: undefined,
        nome: DONO.nome,
        email: DONO.email,
        papel: 'DONO',
        // Identidade da loja (PDV e retaguarda montam o tema por ela).
        loja: { id: 1, slug: 'cabana-boemia', nome: 'Cabana Boemia', logoUrl: null, corPrimaria: '#C8102E', corTexto: '#FFFFFF' },
      },
    );
    assert.equal(r.corpo.usuario.senhaHash, undefined);
  });

  test('access token é JWT com papel e expira em 15 minutos', async () => {
    const { corpo } = await login(DONO.email, DONO.senha);
    const payload = jwt.decode(corpo.accessToken);
    assert.equal(payload.papel, 'DONO');
    assert.equal(payload.exp - payload.iat, 15 * 60);
  });

  test('refresh token é guardado só como hash no banco', async () => {
    const { corpo } = await login(DONO.email, DONO.senha);
    const emClaro = await prisma.refreshToken.count({ where: { hash: corpo.refreshToken } });
    assert.equal(emClaro, 0);
  });

  test('login com senha errada responde 401', async () => {
    const r = await login(DONO.email, 'senha-errada');
    assert.equal(r.status, 401);
    assert.equal(r.corpo.erro.codigo, 'CREDENCIAIS_INVALIDAS');
  });

  test('login com email inexistente responde 401 igual ao de senha errada', async () => {
    const r = await login('ninguem@teste.com', 'qualquer-coisa');
    assert.equal(r.status, 401);
    assert.equal(r.corpo.erro.codigo, 'CREDENCIAIS_INVALIDAS');
  });

  test('login sem corpo válido responde 400', async () => {
    const r = await api('POST', '/auth/login', { corpo: { email: '' } });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'VALIDACAO');
  });

  test('GET /auth/me devolve o usuário logado; sem token ou com token inválido responde 401', async () => {
    const ok = await api('GET', '/auth/me', { token: tokenDono });
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.usuario.email, DONO.email);

    assert.equal((await api('GET', '/auth/me')).status, 401);
    const invalido = await api('GET', '/auth/me', { token: 'abc.def.ghi' });
    assert.equal(invalido.status, 401);
    assert.equal(invalido.corpo.erro.codigo, 'TOKEN_INVALIDO');
  });

  test('refresh rotaciona o token e o antigo deixa de valer', async () => {
    const { corpo: sessao } = await login(DONO.email, DONO.senha);

    const r1 = await api('POST', '/auth/refresh', { corpo: { refreshToken: sessao.refreshToken } });
    assert.equal(r1.status, 200);
    assert.notEqual(r1.corpo.refreshToken, sessao.refreshToken);
    assert.equal((await api('GET', '/auth/me', { token: r1.corpo.accessToken })).status, 200);

    const reuso = await api('POST', '/auth/refresh', { corpo: { refreshToken: sessao.refreshToken } });
    assert.equal(reuso.status, 401);
    assert.equal(reuso.corpo.erro.codigo, 'REFRESH_REUTILIZADO');
  });

  test('reusar refresh já rotacionado revoga também o token novo', async () => {
    const { corpo: sessao } = await login(DONO.email, DONO.senha);
    const novo = await api('POST', '/auth/refresh', { corpo: { refreshToken: sessao.refreshToken } });
    assert.equal(novo.status, 200);

    await api('POST', '/auth/refresh', { corpo: { refreshToken: sessao.refreshToken } }); // reuso
    const depois = await api('POST', '/auth/refresh', { corpo: { refreshToken: novo.corpo.refreshToken } });
    assert.equal(depois.status, 401);
  });

  test('refresh desconhecido responde 401', async () => {
    const r = await api('POST', '/auth/refresh', { corpo: { refreshToken: 'nao-existe' } });
    assert.equal(r.status, 401);
    assert.equal(r.corpo.erro.codigo, 'REFRESH_INVALIDO');
  });

  test('logout revoga o refresh token e é idempotente', async () => {
    const { corpo: sessao } = await login(DONO.email, DONO.senha);
    assert.equal((await api('POST', '/auth/logout', { corpo: { refreshToken: sessao.refreshToken } })).status, 204);
    assert.equal((await api('POST', '/auth/logout', { corpo: { refreshToken: sessao.refreshToken } })).status, 204);
    const r = await api('POST', '/auth/refresh', { corpo: { refreshToken: sessao.refreshToken } });
    assert.equal(r.status, 401);
  });

  test('dono cria atendente; email repetido responde 409 e senha curta 400', async () => {
    const r = await api('POST', '/usuarios', { token: tokenDono, corpo: ATENDENTE });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.usuario.papel, 'ATENDENTE');
    assert.equal(r.corpo.usuario.senhaHash, undefined);

    const repetido = await api('POST', '/usuarios', {
      token: tokenDono,
      corpo: { ...ATENDENTE, email: 'ANA@teste.com' },
    });
    assert.equal(repetido.status, 409);

    const curta = await api('POST', '/usuarios', {
      token: tokenDono,
      corpo: { nome: 'X', email: 'x@teste.com', senha: '123' },
    });
    assert.equal(curta.status, 400);
  });

  test('dono lista usuários sem expor senhaHash', async () => {
    const r = await api('GET', '/usuarios', { token: tokenDono });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.usuarios.map((u) => u.email).sort(), [ATENDENTE.email, DONO.email]);
    assert.ok(r.corpo.usuarios.every((u) => u.senhaHash === undefined));
  });

  test('atendente recebe 403 em rota de dono', async () => {
    const { corpo } = await login(ATENDENTE.email, ATENDENTE.senha);
    const r = await api('GET', '/usuarios', { token: corpo.accessToken });
    assert.equal(r.status, 403);
    assert.equal(r.corpo.erro.codigo, 'SEM_PERMISSAO');
    assert.equal(
      (await api('POST', '/usuarios', { token: corpo.accessToken, corpo: { ...ATENDENTE, email: 'b@teste.com' } })).status,
      403,
    );
  });

  test('usuário desativado não loga e perde a sessão na hora', async () => {
    const ana = await prisma.usuario.findUnique({ where: { email: ATENDENTE.email } });
    const { corpo: sessao } = await login(ATENDENTE.email, ATENDENTE.senha);

    const r = await api('PATCH', `/usuarios/${ana.id}/desativar`, { token: tokenDono });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.usuario.ativo, false);

    const tentativa = await login(ATENDENTE.email, ATENDENTE.senha);
    assert.equal(tentativa.status, 403);
    assert.equal(tentativa.corpo.erro.codigo, 'USUARIO_INATIVO');

    // access token ainda dentro dos 15 min já não serve; refresh foi revogado
    assert.equal((await api('GET', '/auth/me', { token: sessao.accessToken })).status, 401);
    assert.equal((await api('POST', '/auth/refresh', { corpo: { refreshToken: sessao.refreshToken } })).status, 401);
  });

  test('reativar devolve o acesso ao atendente', async () => {
    const ana = await prisma.usuario.findUnique({ where: { email: ATENDENTE.email } });
    const r = await api('PATCH', `/usuarios/${ana.id}/reativar`, { token: tokenDono });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.usuario.ativo, true);
    assert.equal((await login(ATENDENTE.email, ATENDENTE.senha)).status, 200);
  });

  test('trocar senha: a antiga deixa de valer e as sessões são revogadas', async () => {
    const ana = await prisma.usuario.findUnique({ where: { email: ATENDENTE.email } });
    const { corpo: sessao } = await login(ATENDENTE.email, ATENDENTE.senha);

    const r = await api('PATCH', `/usuarios/${ana.id}/senha`, {
      token: tokenDono,
      corpo: { senha: 'nova-senha-da-ana' },
    });
    assert.equal(r.status, 204);

    assert.equal((await login(ATENDENTE.email, ATENDENTE.senha)).status, 401);
    assert.equal((await login(ATENDENTE.email, 'nova-senha-da-ana')).status, 200);
    assert.equal((await api('POST', '/auth/refresh', { corpo: { refreshToken: sessao.refreshToken } })).status, 401);
  });

  test('rotas de usuários não alteram outro DONO e respondem 404 para id inexistente', async () => {
    const dono = await prisma.usuario.findUnique({ where: { email: DONO.email } });
    const r = await api('PATCH', `/usuarios/${dono.id}/desativar`, { token: tokenDono });
    assert.equal(r.status, 403);
    assert.equal(r.corpo.erro.codigo, 'SOMENTE_ATENDENTE');

    assert.equal((await api('PATCH', '/usuarios/999999/desativar', { token: tokenDono })).status, 404);
    assert.equal((await api('PATCH', '/usuarios/abc/desativar', { token: tokenDono })).status, 400);
  });

  test('rate limit bloqueia o login após o limite de tentativas erradas', async () => {
    const s = await iniciarApp({ limiteLogin: 3 });
    const url = `http://127.0.0.1:${s.address().port}/api/auth/login`;
    const tentar = (senha) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: DONO.email, senha }),
      });
    try {
      for (let i = 0; i < 3; i++) assert.equal((await tentar('errada')).status, 401);
      const bloqueado = await tentar('errada');
      assert.equal(bloqueado.status, 429);
      assert.equal((await bloqueado.json()).erro.codigo, 'MUITAS_TENTATIVAS');
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  test('npm run criar-dono cria DONO e recusa email repetido', () => {
    const rodar = (email) =>
      spawnSync(
        process.execPath,
        [path.join(raizApi, 'scripts', 'criar-dono.js'), '--nome', 'Outro Dono', '--email', email, '--senha', 'senha-forte-1'],
        { cwd: raizApi, encoding: 'utf8', env: process.env },
      );

    const ok = rodar('outro.dono@teste.com');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /DONO criado/);

    const repetido = rodar('outro.dono@teste.com');
    assert.equal(repetido.status, 1);
    assert.match(repetido.stderr, /Já existe um usuário com este email/);
  });
});
