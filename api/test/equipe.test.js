import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as conectarSocket } from 'socket.io-client';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SABADO_20H = local('2026-11-14T20:00'); // turno Lanches aberto
const SABADO_23H30 = local('2026-11-14T23:30'); // mesmo dia local (UTC já é domingo)
const DOMINGO_10H = local('2026-11-15T10:00');

describe('rotas da equipe (PDV) e socket', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = SABADO_20H;
  let criarPedido;
  let gerarTokenCliente;
  let tokenDono;
  let tokenAna;
  let centro;
  const p = {};
  const pedidos = {};

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
    return { status: res.status, headers: res.headers, corpo: texto ? JSON.parse(texto) : null };
  }

  const login = async (email, senha) => (await api('POST', '/auth/login', { corpo: { email, senha } })).corpo.accessToken;

  async function conectar(auth) {
    const socket = conectarSocket(base, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
    return socket;
  }

  const zap = (nome, agoraPedido = SABADO_20H, pagamento = { forma: 'PIX' }) =>
    criarPedido({
      canal: 'WHATSAPP',
      itens: [{ produtoId: p['Coca-Cola 1L'].id, quantidade: 1 }],
      cliente: { nome, telefone: '43988887777' },
      endereco: { texto: 'Rua A, 10', bairroId: centro.id },
      pagamento,
      agora: agoraPedido,
    });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    ({ criarPedido } = await import('../src/services/pedido.service.js'));
    ({ gerarTokenCliente } = await import('../src/lib/tokens.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarTempoReal } = await import('../src/lib/tempoReal.js');
    const { criarDono, criarAtendente } = await import('../src/services/usuario.service.js');

    for (const prod of await prisma.produto.findMany()) p[prod.nome] = prod;
    await prisma.produto.updateMany({ data: { disponivelHoje: true, ativo: true } });
    await prisma.produto.updateMany({ where: { controlaEstoque: true }, data: { estoque: 50 } });
    await prisma.insumo.updateMany({ data: { estoque: 50 } });
    centro = await prisma.bairro.create({ data: { nome: 'Centro', taxaCentavos: 500 } });
    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });
    const anaCaixa = await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });
    // Finalizar exige caixa aberto (as regras do caixa estão em caixa.test.js).
    await prisma.caixa.create({ data: { abertoPorId: anaCaixa.id, valorInicialCentavos: 0 } });

    servidor = http.createServer(criarApp({ log: false, relogio: () => agora }));
    criarTempoReal(servidor);
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
    tokenDono = await login('dono@teste.com', 'senha-do-dono');
    tokenAna = await login('ana@teste.com', 'senha-da-ana');

    // Sábado: 1 do site, 2 do WhatsApp, 1 do salão; domingo: 1 do WhatsApp.
    const cliente = await prisma.cliente.create({ data: { googleId: 'g-1', nome: 'Maria', telefone: '43999990000' } });
    pedidos.site = (
      await criarPedido({
        canal: 'SITE',
        itens: [{ produtoId: p['Coca-Cola 1L'].id, quantidade: 1 }],
        cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone },
        endereco: { texto: 'Rua B, 20', bairroId: centro.id },
        pagamento: { forma: 'PIX' },
        totalEsperadoCentavos: p['Coca-Cola 1L'].precoCentavos + 500,
        agora: SABADO_20H,
      })
    ).pedido;
    pedidos.zap1 = (await zap('João', SABADO_20H, { forma: 'DINHEIRO', trocoParaCentavos: 10000 })).pedido;
    pedidos.zap2 = (await zap('Pedro', SABADO_23H30)).pedido;
    pedidos.salao = (
      await criarPedido({
        canal: 'SALAO',
        itens: [{ produtoId: p['Coca-Cola 1L'].id, quantidade: 1 }],
        mesaRotulo: 'Mesa 3',
        agora: SABADO_20H,
      })
    ).pedido;
    pedidos.domingo = (await zap('Luiz', DOMINGO_10H)).pedido;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  // ───────── Socket ─────────

  test('socket sem token é recusado', async () => {
    await assert.rejects(conectar({}), { message: 'NAO_AUTENTICADO' });
    await assert.rejects(conectar({ token: '' }), { message: 'NAO_AUTENTICADO' });
    await assert.rejects(conectar({ token: 'lixo' }), { message: 'NAO_AUTENTICADO' });
  });

  test('socket com token de cliente do site é recusado', async () => {
    const cliente = await prisma.cliente.findFirst();
    await assert.rejects(conectar({ token: gerarTokenCliente(cliente) }), { message: 'NAO_AUTENTICADO' });
  });

  test('socket da atendente recebe pedido:novo', async () => {
    const socket = await conectar({ token: tokenAna });
    try {
      const chegou = new Promise((resolve) => socket.once('pedido:novo', resolve));
      const { pedido } = await zap('Socket');
      const recebido = await chegou;
      assert.equal(recebido.id, pedido.id);
      assert.equal(recebido.canal, 'WHATSAPP');
      await prisma.pedido.update({ where: { id: pedido.id }, data: { status: 'CANCELADO' } });
    } finally {
      socket.close();
    }
  });

  // ───────── Acesso ─────────

  test('rotas /equipe exigem token da equipe', async () => {
    assert.equal((await api('GET', '/equipe/pedidos')).status, 401);
    const cliente = await prisma.cliente.findFirst();
    assert.equal((await api('GET', '/equipe/pedidos', { token: gerarTokenCliente(cliente) })).status, 401);
    const r = await api('GET', '/equipe/pedidos', { token: tokenAna });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  // ───────── Listagem ─────────

  test('GET /equipe/pedidos?dataRef=hoje&canal=SITE,WHATSAPP: abertos do dia local, por número', async () => {
    agora = SABADO_23H30;
    const r = await api('GET', '/equipe/pedidos?dataRef=hoje&canal=SITE,WHATSAPP', { token: tokenAna });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.dataRef, '2026-11-14');
    assert.deepEqual(
      r.corpo.pedidos.map((x) => x.id),
      [pedidos.site.id, pedidos.zap1.id, pedidos.zap2.id],
    );
    assert.ok(r.corpo.pedidos[0].itens.length > 0);

    const salao = await api('GET', '/equipe/pedidos?canal=salao', { token: tokenAna });
    assert.deepEqual(salao.corpo.pedidos.map((x) => x.id), [pedidos.salao.id]);

    agora = DOMINGO_10H;
    const domingo = await api('GET', '/equipe/pedidos?dataRef=hoje', { token: tokenAna });
    assert.deepEqual(domingo.corpo.pedidos.map((x) => x.id), [pedidos.domingo.id]);

    const data = await api('GET', '/equipe/pedidos?dataRef=2026-11-14&canal=WHATSAPP', { token: tokenAna });
    assert.deepEqual(data.corpo.pedidos.map((x) => x.id), [pedidos.zap1.id, pedidos.zap2.id]);
  });

  test('GET /equipe/pedidos valida dataRef e canal', async () => {
    assert.equal((await api('GET', '/equipe/pedidos?dataRef=ontem', { token: tokenAna })).status, 400);
    const r = await api('GET', '/equipe/pedidos?canal=SITE,IFOOD', { token: tokenAna });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'VALIDACAO');
  });

  // ───────── Finalizar ─────────

  test('finalizar sem forma de pagamento = 400', async () => {
    for (const corpo of [{}, { formaPagamento: '' }, { formaPagamento: 'FIADO' }, undefined]) {
      const r = await api('PATCH', `/equipe/pedidos/${pedidos.zap2.id}/finalizar`, { token: tokenAna, corpo });
      assert.equal(r.status, 400, JSON.stringify(corpo));
      assert.equal(r.corpo.erro.codigo, 'VALIDACAO');
    }
    const p2 = await prisma.pedido.findUnique({ where: { id: pedidos.zap2.id } });
    assert.equal(p2.status, 'CONFIRMADO');
  });

  test('finalizar: sobrescreve a forma, apaga o troco fora do dinheiro, avisa a equipe e sai da fila', async () => {
    agora = SABADO_23H30;
    const socket = await conectar({ token: tokenDono });
    try {
      const aviso = new Promise((resolve) => socket.once('pedido:atualizado', resolve));
      const r = await api('PATCH', `/equipe/pedidos/${pedidos.zap1.id}/finalizar`, {
        token: tokenAna,
        corpo: { formaPagamento: 'DEBITO' },
      });
      assert.equal(r.status, 200, JSON.stringify(r.corpo));
      assert.equal(r.corpo.pedido.status, 'FINALIZADO');
      assert.equal(r.corpo.pedido.formaPagamento, 'DEBITO');
      assert.equal(r.corpo.pedido.trocoParaCentavos, null);
      const recebido = await aviso;
      assert.equal(recebido.id, pedidos.zap1.id);
      assert.equal(recebido.status, 'FINALIZADO');
    } finally {
      socket.close();
    }

    const banco = await prisma.pedido.findUnique({ where: { id: pedidos.zap1.id } });
    assert.deepEqual(banco.finalizadoEm, SABADO_23H30);

    const fila = await api('GET', '/equipe/pedidos?dataRef=hoje&canal=SITE,WHATSAPP', { token: tokenAna });
    assert.ok(!fila.corpo.pedidos.some((x) => x.id === pedidos.zap1.id));
    const todos = await api('GET', '/equipe/pedidos?dataRef=hoje&status=todos', { token: tokenAna });
    assert.ok(todos.corpo.pedidos.some((x) => x.id === pedidos.zap1.id));
  });

  test('finalizar duas vezes = 409; pedido inexistente = 404', async () => {
    const r1 = await api('PATCH', `/equipe/pedidos/${pedidos.site.id}/finalizar`, {
      token: tokenAna,
      corpo: { formaPagamento: 'PIX' },
    });
    assert.equal(r1.status, 200);
    const r2 = await api('PATCH', `/equipe/pedidos/${pedidos.site.id}/finalizar`, {
      token: tokenDono,
      corpo: { formaPagamento: 'PIX' },
    });
    assert.equal(r2.status, 409);
    assert.equal(r2.corpo.erro.codigo, 'PEDIDO_ENCERRADO');

    const r3 = await api('PATCH', '/equipe/pedidos/999999/finalizar', { token: tokenAna, corpo: { formaPagamento: 'PIX' } });
    assert.equal(r3.status, 404);
  });

  test('finalizar em dinheiro mantém o troco informado', async () => {
    const { pedido } = await zap('Troco', SABADO_20H, { forma: 'DINHEIRO', trocoParaCentavos: 5000 });
    const r = await api('PATCH', `/equipe/pedidos/${pedido.id}/finalizar`, {
      token: tokenAna,
      corpo: { formaPagamento: 'DINHEIRO' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.pedido.trocoParaCentavos, 5000);
  });

  // ───────── Tempo estimado ─────────

  test('PUT /equipe/config/tempo-estimado grava o manual de hoje; vazio volta ao padrão', async () => {
    agora = SABADO_20H;
    const antes = await api('GET', '/equipe/config/tempo-estimado', { token: tokenAna });
    assert.equal(antes.status, 200);
    const padrao = antes.corpo.padraoMin;
    assert.deepEqual(antes.corpo, { padraoMin: padrao, manualMin: null, vigenteMin: padrao });

    const r = await api('PUT', '/equipe/config/tempo-estimado', { token: tokenAna, corpo: { minutos: 70 } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo, { padraoMin: padrao, manualMin: 70, vigenteMin: 70 });
    const config = await prisma.configuracao.findUnique({ where: { id: 1 } });
    assert.equal(config.tempoEstimadoManualMin, 70);
    assert.deepEqual(config.tempoManualDefinidoEm, SABADO_20H);

    // Site vê o manual hoje.
    assert.equal((await api('GET', '/publico/cardapio')).corpo.tempoEstimadoMin, 70);

    // No dia seguinte vale o padrão.
    agora = DOMINGO_10H;
    const amanha = await api('GET', '/equipe/config/tempo-estimado', { token: tokenAna });
    assert.deepEqual(amanha.corpo, { padraoMin: padrao, manualMin: null, vigenteMin: padrao });

    agora = SABADO_20H;
    for (const corpo of [{ minutos: null }, { minutos: '' }, {}]) {
      await api('PUT', '/equipe/config/tempo-estimado', { token: tokenAna, corpo: { minutos: 55 } });
      const v = await api('PUT', '/equipe/config/tempo-estimado', { token: tokenAna, corpo });
      assert.equal(v.status, 200);
      assert.deepEqual(v.corpo, { padraoMin: padrao, manualMin: null, vigenteMin: padrao });
    }
    const limpo = await prisma.configuracao.findUnique({ where: { id: 1 } });
    assert.equal(limpo.tempoEstimadoManualMin, null);
    assert.equal(limpo.tempoManualDefinidoEm, null);
  });

  test('tempo estimado aceita só inteiros de 1 a 240', async () => {
    for (const minutos of [0, 241, 12.5, '30', -1]) {
      const r = await api('PUT', '/equipe/config/tempo-estimado', { token: tokenAna, corpo: { minutos } });
      assert.equal(r.status, 400, String(minutos));
    }
    for (const minutos of [1, 240]) {
      assert.equal((await api('PUT', '/equipe/config/tempo-estimado', { token: tokenAna, corpo: { minutos } })).status, 200);
    }
  });
});
