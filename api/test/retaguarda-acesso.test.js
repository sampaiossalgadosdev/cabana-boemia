import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

/** Rotas (método + caminho) de um Router do Express, com `:param` trocado por 1. */
function rotasDo(router, prefixo) {
  return router.stack
    .filter((camada) => camada.route)
    .flatMap((camada) =>
      Object.keys(camada.route.methods).map((metodo) => ({
        metodo: metodo.toUpperCase(),
        caminho: `${prefixo}${camada.route.path}`.replace(/:\w+/g, '1').replace(/\/$/, ''),
      })),
    );
}

describe('retaguarda: só o DONO', { skip: semBancoDeTeste }, () => {
  let servidor;
  let base;
  let prisma;
  let tkAtendente;
  let tkDono;
  let rotas;

  async function chamar({ metodo, caminho }, tk) {
    const res = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(tk && { authorization: `Bearer ${tk}` }) },
      body: metodo === 'GET' ? undefined : '{}',
    });
    return res;
  }

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarRetaguardaRoutes } = await import('../src/routes/retaguarda.routes.js');
    const { criarUsuarioRoutes } = await import('../src/routes/usuario.routes.js');
    const { criarAtendente, criarDono } = await import('../src/services/usuario.service.js');

    rotas = [...rotasDo(criarRetaguardaRoutes(), '/retaguarda'), ...rotasDo(criarUsuarioRoutes(), '/usuarios')];
    await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });
    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });

    servidor = http.createServer(criarApp({ log: false }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
    const login = async (email, senha) => {
      const r = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      });
      return (await r.json()).accessToken;
    };
    tkAtendente = await login('ana@teste.com', 'senha-da-ana');
    tkDono = await login('dono@teste.com', 'senha-do-dono');
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('a lista cobre as telas da retaguarda (rotas lidas do router)', () => {
    const chaves = rotas.map((r) => `${r.metodo} ${r.caminho}`);
    for (const esperada of [
      'GET /retaguarda/categorias',
      'POST /retaguarda/produtos',
      'PATCH /retaguarda/produtos/1/disponivel-hoje',
      'POST /retaguarda/cardapio-do-dia/liberar-tudo',
      'PUT /retaguarda/turnos/1/horarios',
      'PATCH /retaguarda/bairros/1',
      'POST /retaguarda/estoque/ajuste',
      'GET /retaguarda/estoque/movimentacoes',
      'PUT /retaguarda/config',
      'POST /usuarios',
      'PATCH /usuarios/1/senha',
    ]) {
      assert.ok(chaves.includes(esperada), `faltou ${esperada}`);
    }
    assert.ok(rotas.length >= 30, `só ${rotas.length} rotas`);
  });

  test('atendente recebe 403 SEM_PERMISSAO em todas as rotas da retaguarda (e de /usuarios)', async () => {
    for (const rota of rotas) {
      const res = await chamar(rota, tkAtendente);
      assert.equal(res.status, 403, `${rota.metodo} ${rota.caminho}`);
      assert.equal((await res.json()).erro.codigo, 'SEM_PERMISSAO', `${rota.metodo} ${rota.caminho}`);
      if (rota.caminho.startsWith('/retaguarda')) assert.equal(res.headers.get('cache-control'), 'no-store');
    }
  });

  test('sem token: 401 em todas', async () => {
    for (const rota of rotas) {
      assert.equal((await chamar(rota, null)).status, 401, `${rota.metodo} ${rota.caminho}`);
    }
  });

  // Só /retaguarda: com corpo vazio, nada ali altera o banco (400). Em /usuarios,
  // PATCH /usuarios/1/desativar desativaria a atendente dos outros testes.
  test('o dono passa da autorização em /retaguarda (nenhuma resposta 401/403)', async () => {
    for (const rota of rotas.filter((r) => r.caminho.startsWith('/retaguarda'))) {
      const res = await chamar(rota, tkDono);
      assert.ok(![401, 403].includes(res.status), `${rota.metodo} ${rota.caminho} → ${res.status}`);
    }
  });

  test('a atendente não consegue mudar nada (banco intacto depois das tentativas)', async () => {
    const antes = await Promise.all([prisma.categoria.count(), prisma.movimentacaoEstoque.count(), prisma.bairro.count()]);
    await chamar({ metodo: 'POST', caminho: '/retaguarda/categorias' }, tkAtendente);
    const res = await fetch(`${base}/retaguarda/categorias`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tkAtendente}` },
      body: JSON.stringify({ nome: 'Invasora' }),
    });
    assert.equal(res.status, 403);
    const depois = await Promise.all([prisma.categoria.count(), prisma.movimentacaoEstoque.count(), prisma.bairro.count()]);
    assert.deepEqual(depois, antes);
  });
});
