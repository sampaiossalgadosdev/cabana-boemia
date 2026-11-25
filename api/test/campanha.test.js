import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';

const SABADO_20H = new Date('2026-11-14T20:00-03:00');

/**
 * Frete grátis da primeira compra (decisões 4 e 16 e as da Etapa 2): um por telefone
 * verificado, reservado na criação, usado na aprovação/finalização e liberado se o
 * pedido expirar ou for cancelado. A ligação com a criação do pedido é da etapa 4:
 * aqui a reserva é feita pelo service, como a criação fará.
 */
describe('campanha de frete grátis da primeira compra', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let token;
  let campanha;
  let cliente;
  let produto;

  async function api(metodo, rota, corpo) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { authorization: `Bearer ${token}`, ...(corpo !== undefined && { 'content-type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  /** Pedido de delivery de verdade (mesmo criarPedido), para finalizar e cancelar pela API. */
  async function lancar() {
    const r = await api('POST', '/equipe/pedidos', {
      clienteId: cliente.id,
      enderecoId: cliente.enderecos[0].id,
      itens: [{ produtoId: produto.id, quantidade: 1 }],
      formaPagamento: 'DINHEIRO',
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    return r.corpo.pedido;
  }

  const reservar = (pedidoId, telefone = '43999990001') =>
    prisma.$transaction((tx) => campanha.reservarCampanha(tx, { telefone, clienteId: cliente.id, pedidoId }));
  const elegivel = (c) => prisma.$transaction((tx) => campanha.campanhaElegivel(c, tx));
  const uso = (pedidoId) => prisma.usoCampanhaFreteGratis.findUnique({ where: { pedidoId } });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    campanha = await import('../src/services/campanha.service.js');
    const { criarApp } = await import('../src/app.js');
    const { criarAtendente } = await import('../src/services/usuario.service.js');

    produto = await prisma.produto.findFirstOrThrow({ where: { nome: 'X-Burguer' } });
    const centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });

    servidor = http.createServer(criarApp({ log: false, relogio: () => SABADO_20H }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ana@teste.com', senha: 'senha-da-ana' }),
    });
    token = (await login.json()).accessToken;

    const r = await api('POST', '/equipe/clientes', {
      nome: 'Lilian',
      telefone: '43999990001',
      endereco: { rua: 'Rua A', numero: '10', bairroId: centro.id },
    });
    cliente = r.corpo.cliente;
    await prisma.cliente.update({ where: { id: cliente.id }, data: { telefoneVerificado: true, telefoneVerificadoEm: new Date() } });
    assert.equal((await api('POST', '/equipe/caixa/abrir', { valorInicialCentavos: 0 })).status, 201);
  });

  beforeEach(async () => {
    await prisma.usoCampanhaFreteGratis.deleteMany();
    await prisma.produto.updateMany({ data: { disponivelHoje: true, ativo: true } });
    await prisma.insumo.updateMany({ data: { estoque: 50 } });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('só o telefone verificado ganha; sem telefone também não', async () => {
    assert.equal(await elegivel({ telefone: '43999990001', telefoneVerificado: true }), true);
    assert.equal(await elegivel({ telefone: '43999990001', telefoneVerificado: false }), false);
    assert.equal(await elegivel({ telefone: null, telefoneVerificado: true }), false);
    assert.equal(await elegivel(null), false);
  });

  test('um por telefone: a segunda reserva (outro pedido) é recusada sem quebrar a transação', async () => {
    const [a, b] = [await lancar(), await lancar()];
    assert.equal(await reservar(a.id), true);
    assert.equal(await elegivel({ telefone: '43999990001', telefoneVerificado: true }), false);
    // A segunda reserva falha no único, e a transação continua utilizável depois dela.
    const depois = await prisma.$transaction(async (tx) => {
      const ok = await campanha.reservarCampanha(tx, { telefone: '43999990001', pedidoId: b.id });
      return { ok, contagem: await tx.usoCampanhaFreteGratis.count() };
    });
    assert.deepEqual(depois, { ok: false, contagem: 1 });
    // Outro telefone verificado tem a própria campanha.
    assert.equal(await reservar(b.id, '43999990002'), true);
  });

  test('reservada não conta como usada; só a finalização (ou a aprovação) usa', async () => {
    const p = await lancar();
    await reservar(p.id);
    assert.equal((await uso(p.id)).situacao, 'RESERVADO');
    assert.equal((await uso(p.id)).usadoEm, null);

    const r = await api('PATCH', `/equipe/pedidos/${p.id}/finalizar`, { formaPagamento: 'DINHEIRO' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const u = await uso(p.id);
    assert.equal(u.situacao, 'USADO');
    assert.ok(u.usadoEm);
    // A aprovação do pagamento online (etapa 4) usa a mesma função: repetir não muda nada.
    assert.equal(await prisma.$transaction((tx) => campanha.usarCampanha(tx, p.id)), false);
    assert.equal(await elegivel({ telefone: '43999990001', telefoneVerificado: true }), false);
  });

  test('finalizar pedido sem campanha não cria nada', async () => {
    const p = await lancar();
    assert.equal((await api('PATCH', `/equipe/pedidos/${p.id}/finalizar`, { formaPagamento: 'DINHEIRO' })).status, 200);
    assert.equal(await prisma.usoCampanhaFreteGratis.count(), 0);
  });

  test('cancelado não consome: a reserva é liberada e o telefone volta a ganhar', async () => {
    const p = await lancar();
    await reservar(p.id);
    assert.equal((await api('PATCH', `/equipe/pedidos/${p.id}/cancelar`)).status, 200);
    assert.equal(await uso(p.id), null);
    assert.equal(await elegivel({ telefone: '43999990001', telefoneVerificado: true }), true);
  });

  test('cancelado depois do aceite (já usada) também libera', async () => {
    const p = await lancar();
    await reservar(p.id);
    await prisma.$transaction((tx) => campanha.usarCampanha(tx, p.id)); // aprovado online
    assert.equal((await uso(p.id)).situacao, 'USADO');
    assert.equal((await api('PATCH', `/equipe/pedidos/${p.id}/cancelar`)).status, 200);
    assert.equal(await uso(p.id), null);
    assert.equal(await elegivel({ telefone: '43999990001', telefoneVerificado: true }), true);
  });

  test('expirado não consome: a expiração (etapa 4) libera a reserva', async () => {
    const p = await lancar();
    await reservar(p.id);
    assert.equal(await prisma.$transaction((tx) => campanha.liberarCampanha(tx, p.id)), true);
    assert.equal(await elegivel({ telefone: '43999990001', telefoneVerificado: true }), true);
  });
});
