import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';
import { diaOperacional, intervaloDoDia } from '../src/lib/fuso.js';
import { inicioDaJanela } from '../src/services/impressao.service.js';

const local = (iso) => new Date(`${iso}-03:00`);

// ───────── Funções puras ─────────

test('diaOperacional (virada 04:00): 23:59 e 00:30 são do mesmo dia; 03:59 ainda é ontem; 04:00 já é hoje', () => {
  assert.equal(diaOperacional(local('2026-11-13T23:59')), '2026-11-13');
  assert.equal(diaOperacional(local('2026-11-14T00:30')), '2026-11-13');
  assert.equal(diaOperacional(local('2026-11-14T03:59')), '2026-11-13');
  assert.equal(diaOperacional(local('2026-11-14T04:00')), '2026-11-14');
  assert.equal(diaOperacional(local('2026-11-14T12:00')), '2026-11-14');
});

test('diaOperacional: virada de mês e de ano; virada 0 = dia civil; virada configurável', () => {
  assert.equal(diaOperacional(local('2026-12-01T02:00')), '2026-11-30');
  assert.equal(diaOperacional(local('2027-01-01T03:00')), '2026-12-31');
  assert.equal(diaOperacional(local('2026-11-14T00:30'), 0), '2026-11-14');
  assert.equal(diaOperacional(local('2026-11-14T05:30'), 6), '2026-11-13');
  assert.equal(diaOperacional(local('2026-11-14T06:00'), 6), '2026-11-14');
});

test('intervaloDoDia: [D 04:00, D+1 04:00) local, em UTC', () => {
  const { inicio, fim } = intervaloDoDia('2026-11-13');
  assert.equal(inicio.toISOString(), '2026-11-13T07:00:00.000Z');
  assert.equal(fim.toISOString(), '2026-11-14T07:00:00.000Z');
  assert.equal(intervaloDoDia('2026-12-31').fim.toISOString(), '2027-01-01T07:00:00.000Z');
  assert.equal(intervaloDoDia('2026-11-13', 0).inicio.toISOString(), '2026-11-13T03:00:00.000Z');
});

test('fila de impressão: a janela começa no início do dia operacional (ou 2 h atrás)', () => {
  // Sábado 01:00: o expediente começou sexta 04:00.
  assert.deepEqual(inicioDaJanela(local('2026-11-14T01:00')), local('2026-11-13T04:00'));
  // Sábado 05:00: começou às 04:00, mas 2 h atrás (03:00) vem antes.
  assert.deepEqual(inicioDaJanela(local('2026-11-14T05:00')), local('2026-11-14T03:00'));
});

// ───────── Banco ─────────

describe('dia operacional no banco (numeroDia, pedidos do dia, caixas)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora;
  let tkDono;
  let tkAtendente;
  let atendente;
  let criarPedido;
  let abrirComanda;
  const p = {};

  async function api(metodo, rota, tk = tkAtendente) {
    const res = await fetch(`${base}${rota}`, { method: metodo, headers: { authorization: `Bearer ${tk}` } });
    return { status: res.status, corpo: await res.json() };
  }

  const whatsapp = (quando) =>
    criarPedido({
      canal: 'WHATSAPP',
      itens: [{ produtoId: p.Salame.id, quantidade: 1 }],
      cliente: { nome: 'Joana', telefone: '43999990000' },
      pagamento: { forma: 'PIX' },
      agora: quando,
    }).then((r) => doBanco(r.pedido.id));
  /** dataRef ("YYYY-MM-DD") e numeroDia gravados. */
  const doBanco = async (id) => {
    const x = await prisma.pedido.findUnique({ where: { id } });
    return { id, dataRef: x.dataRef.toISOString().slice(0, 10), numeroDia: x.numeroDia };
  };

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    ({ criarPedido } = await import('../src/services/pedido.service.js'));
    ({ abrirComanda } = await import('../src/services/comanda.service.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarAtendente, criarDono } = await import('../src/services/usuario.service.js');
    for (const prod of await prisma.produto.findMany()) p[prod.nome] = prod;
    atendente = await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });
    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });
    servidor = http.createServer(criarApp({ log: false, relogio: () => agora }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
    const login = async (email, senha) =>
      (
        await (
          await fetch(`${base}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, senha }),
          })
        ).json()
      ).accessToken;
    tkDono = await login('dono@teste.com', 'senha-do-dono');
    tkAtendente = await login('ana@teste.com', 'senha-da-ana');
  });

  beforeEach(async () => {
    await prisma.configuracao.update({ where: { id: 1 }, data: { horaViradaDia: 4 } });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('numeroDia não reinicia à meia-noite: 23:59 (#1) e 00:30 (#2) na sexta; 04:00 abre o sábado (#1)', async () => {
    const a = await whatsapp(local('2026-11-13T23:59'));
    const b = await whatsapp(local('2026-11-14T00:30'));
    const comanda = await doBanco((await abrirComanda({ nomeCliente: 'Mesa 3' }, { agora: local('2026-11-14T03:59') })).id);
    const c = await whatsapp(local('2026-11-14T04:00'));
    assert.deepEqual([a.dataRef, a.numeroDia], ['2026-11-13', 1]);
    assert.deepEqual([b.dataRef, b.numeroDia], ['2026-11-13', 2]);
    assert.deepEqual([comanda.dataRef, comanda.numeroDia], ['2026-11-13', 3], 'comanda usa o mesmo contador');
    assert.deepEqual([c.dataRef, c.numeroDia], ['2026-11-14', 1]);
  });

  test('GET /equipe/pedidos?dataRef=hoje às 00:30 mostra os pedidos das 23:59 (mesmo expediente)', async () => {
    agora = local('2026-11-14T00:31');
    const r = await api('GET', '/equipe/pedidos?dataRef=hoje&status=todos');
    assert.equal(r.corpo.dataRef, '2026-11-13');
    assert.deepEqual(r.corpo.pedidos.map((x) => x.numeroDia), [1, 2, 3]);
    agora = local('2026-11-14T04:01');
    assert.equal((await api('GET', '/equipe/pedidos?dataRef=hoje&status=todos')).corpo.dataRef, '2026-11-14');
  });

  test('virada configurável (horaViradaDia = 0 volta ao dia civil)', async () => {
    await prisma.configuracao.update({ where: { id: 1 }, data: { horaViradaDia: 0 } });
    const d = await whatsapp(local('2026-11-15T00:30'));
    assert.equal(d.dataRef, '2026-11-15');
    await prisma.configuracao.update({ where: { id: 1 }, data: { horaViradaDia: 4 } });
    const e = await whatsapp(local('2026-11-16T00:30'));
    assert.equal(e.dataRef, '2026-11-15');
    assert.equal(e.numeroDia, d.numeroDia + 1, 'continua o contador do mesmo dia operacional');
  });

  test('GET /retaguarda/caixas usa o dia operacional (caixa aberto às 00:30 é da véspera)', async () => {
    const criar = (abertoEm, fechadoEm) =>
      prisma.caixa.create({
        data: {
          abertoPorId: atendente.id,
          abertoEm,
          valorInicialCentavos: 100,
          fechadoPorId: atendente.id,
          fechadoEm,
          valorContadoCentavos: 100,
          esperadoCentavos: 100,
          diferencaCentavos: 0,
        },
      });
    const madrugada = await criar(local('2026-11-21T00:30'), local('2026-11-21T01:00'));
    const manha = await criar(local('2026-11-21T04:00'), local('2026-11-21T05:00'));
    agora = local('2026-11-21T12:00');
    const sexta = await api('GET', '/retaguarda/caixas?data=2026-11-20', tkDono);
    const sabado = await api('GET', '/retaguarda/caixas?data=2026-11-21', tkDono);
    assert.deepEqual(sexta.corpo.caixas.map((c) => c.id), [madrugada.id]);
    assert.deepEqual(sabado.corpo.caixas.map((c) => c.id), [manha.id]);
    agora = local('2026-11-21T02:00');
    assert.equal((await api('GET', '/retaguarda/caixas?data=hoje', tkDono)).corpo.data, '2026-11-20');
  });

  test('GET /equipe/caixa/atual informa a hora da virada (o PDV calcula "caixa de outro dia")', async () => {
    const r = await api('GET', '/equipe/caixa/atual');
    assert.equal(r.corpo.horaViradaDia, 4);
  });

  test('o banco recusa horaViradaDia fora de 0–12 (CHECK)', async () => {
    await assert.rejects(prisma.configuracao.update({ where: { id: 1 }, data: { horaViradaDia: 13 } }));
  });
});
