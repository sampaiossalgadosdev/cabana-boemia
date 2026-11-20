import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

/**
 * Um cliente do site nunca vê nem altera dados de outro: toda rota /cliente
 * usa só o id do token (req.cliente.id), nunca um id de query, params ou corpo.
 */
describe('cliente do site: isolamento entre clientes (histórico, perfil, endereços)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let tokenEquipe;
  const a = {};
  const b = {};

  async function api(metodo, rota, { corpo, token } = {}) {
    const headers = {};
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { gerarTokenCliente } = await import('../src/lib/tokens.js');
    const { criarPedido } = await import('../src/services/pedido.service.js');
    const { criarApp } = await import('../src/app.js');
    const { criarDono } = await import('../src/services/usuario.service.js');

    const centro = await prisma.bairro.create({ data: { lojaId: 1, nome: 'Centro', taxaCentavos: 500 } });
    const salame = await prisma.produto.findUnique({ where: { lojaId_nome: { lojaId: 1, nome: 'Salame' } } });
    await prisma.produto.update({ where: { id: salame.id }, data: { ativo: true } });

    for (const [c, nome, telefone] of [[a, 'Ana', '43999990001'], [b, 'Bruno', '43999990002']]) {
      c.cliente = await prisma.cliente.create({ data: { googleId: `iso-${nome}`, nome, email: `${nome}@ex.com`, telefone } });
      c.endereco = await prisma.endereco.create({
        data: { clienteId: c.cliente.id, rua: `Rua ${nome}`, numero: '1', bairroId: centro.id, principal: true },
      });
      c.token = gerarTokenCliente(c.cliente);
      c.pedidos = [];
      for (let i = 0; i < 2; i += 1) {
        const { pedido } = await criarPedido({
          lojaId: 1,
          canal: 'WHATSAPP',
          itens: [{ produtoId: salame.id, quantidade: 1 }],
          cliente: { id: c.cliente.id, nome, telefone },
          endereco: { texto: `Rua ${nome}, 1`, bairroId: centro.id },
          pagamento: { forma: 'PIX' },
        });
        c.pedidos.push(pedido.id);
      }
    }

    servidor = http.createServer(criarApp({ log: false }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    await criarDono({ nome: 'Dono', email: 'dono-iso@teste.com', senha: 'senha-do-dono' });
    tokenEquipe = (await api('POST', '/auth/login', { corpo: { email: 'dono-iso@teste.com', senha: 'senha-do-dono' } })).corpo.accessToken;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  const ids = (r) => r.corpo.pedidos.map((p) => p.id).sort();

  test('histórico: cada um vê só os seus; id de outro na query, no corpo ou no caminho não muda nada', async () => {
    assert.deepEqual(ids(await api('GET', '/cliente/pedidos', { token: a.token })), [...a.pedidos].sort());
    assert.deepEqual(ids(await api('GET', '/cliente/pedidos', { token: b.token })), [...b.pedidos].sort());

    const bId = b.cliente.id;
    for (const q of [`clienteId=${bId}`, `cliente=${bId}`, `id=${bId}`, `sub=${bId}`, `clienteId[]=${bId}`]) {
      const r = await api('GET', `/cliente/pedidos?${q}`, { token: a.token });
      assert.equal(r.status, 200, q);
      assert.deepEqual(ids(r), [...a.pedidos].sort(), q);
    }
    // Paginar a partir de um id de pedido do B continua filtrando pelo A.
    const pag = await api('GET', `/cliente/pedidos?antesDeId=${Math.max(...b.pedidos) + 1}`, { token: a.token });
    assert.deepEqual(ids(pag), [...a.pedidos].sort());
    // Não existe rota por id (nem de cliente, nem de pedido).
    assert.equal((await api('GET', `/cliente/pedidos/${b.pedidos[0]}`, { token: a.token })).status, 404);
    assert.equal((await api('GET', `/cliente/${bId}/pedidos`, { token: a.token })).status, 404);

    const ultimo = await api('GET', `/cliente/pedidos/ultimo?clienteId=${bId}`, { token: a.token });
    assert.ok(a.pedidos.includes(ultimo.corpo.pedido.id));
  });

  test('sem token, token inválido ou token da equipe = 401', async () => {
    for (const rota of ['/cliente/pedidos', '/cliente/pedidos/ultimo', '/cliente/me', '/cliente/enderecos']) {
      assert.equal((await api('GET', rota)).status, 401, rota);
      assert.equal((await api('GET', rota, { token: 'a.b.c' })).status, 401, rota);
      assert.equal((await api('GET', rota, { token: tokenEquipe })).status, 401, rota);
    }
  });

  test('perfil: GET/PUT /cliente/me só mexem no dono do token, mesmo com id de outro no corpo ou na query', async () => {
    const me = await api('GET', `/cliente/me?id=${b.cliente.id}`, { token: a.token });
    assert.equal(me.corpo.cliente.id, a.cliente.id);

    const r = await api('PUT', `/cliente/me?id=${b.cliente.id}`, {
      token: a.token,
      corpo: { id: b.cliente.id, clienteId: b.cliente.id, nome: 'Ana Maria', telefone: '43999990001' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.cliente.id, a.cliente.id);
    assert.equal((await prisma.cliente.findUnique({ where: { id: a.cliente.id } })).nome, 'Ana Maria');
    assert.equal((await prisma.cliente.findUnique({ where: { id: b.cliente.id } })).nome, 'Bruno');
  });

  test('endereços: listar só os seus; editar ou remover o de outro = 404 sem mudar nada; criar com clienteId de outro cria para si', async () => {
    const lista = await api('GET', `/cliente/enderecos?clienteId=${b.cliente.id}`, { token: a.token });
    assert.deepEqual(lista.corpo.enderecos.map((e) => e.id), [a.endereco.id]);

    const corpo = { rua: 'Invadida', numero: '9', bairroId: b.endereco.bairroId };
    const put = await api('PUT', `/cliente/enderecos/${b.endereco.id}`, { token: a.token, corpo });
    assert.equal(put.status, 404);
    const del = await api('DELETE', `/cliente/enderecos/${b.endereco.id}`, { token: a.token });
    assert.equal(del.status, 404);
    const doB = await prisma.endereco.findUnique({ where: { id: b.endereco.id } });
    assert.equal(doB.rua, 'Rua Bruno');
    assert.equal(doB.clienteId, b.cliente.id);

    const novo = await api('POST', '/cliente/enderecos', { token: a.token, corpo: { ...corpo, rua: 'Rua Nova', clienteId: b.cliente.id } });
    assert.equal(novo.status, 201);
    assert.equal((await prisma.endereco.findUnique({ where: { id: novo.corpo.endereco.id } })).clienteId, a.cliente.id);
    assert.equal(await prisma.endereco.count({ where: { clienteId: b.cliente.id } }), 1);
  });

  test('pedido do site com o endereço de outro cliente = 422 ENDERECO_INVALIDO (nada criado)', async () => {
    const salame = await prisma.produto.findUnique({ where: { lojaId_nome: { lojaId: 1, nome: 'Salame' } } });
    const antes = await prisma.pedido.count();
    const r = await api('POST', '/cliente/pedidos', {
      token: a.token,
      corpo: { itens: [{ produtoId: salame.id, quantidade: 1 }], enderecoId: b.endereco.id, formaPagamento: 'PIX', totalEsperadoCentavos: 2500 },
    });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.erro.codigo, 'ENDERECO_INVALIDO');
    assert.equal(await prisma.pedido.count(), antes);
  });
});
