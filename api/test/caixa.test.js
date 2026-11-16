import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as conectarSocket } from 'socket.io-client';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SEXTA_12H = local('2026-11-13T12:00');
const DIA = '2026-11-13';

/** Procura chaves proibidas em qualquer nível da resposta. */
function chavesDoFechamento(valor) {
  const achadas = [];
  JSON.stringify(valor, (k, v) => {
    if (k === 'esperadoCentavos' || k === 'diferencaCentavos') achadas.push(k);
    return v;
  });
  return achadas;
}

describe('caixa: abrir, movimentos, fechamento cego e retaguarda', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = SEXTA_12H;
  let tkAtendente;
  let tkDono;
  let atendente;
  const p = {};

  async function api(metodo, rota, { corpo, tk = tkAtendente } = {}) {
    const headers = {};
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    if (tk) headers.authorization = `Bearer ${tk}`;
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  const abrirCaixa = (valorInicialCentavos = 10000, tk) =>
    api('POST', '/equipe/caixa/abrir', { corpo: { valorInicialCentavos }, tk });
  const movimento = (tipo, valorCentavos, motivo = 'teste') =>
    api('POST', '/equipe/caixa/movimentos', { corpo: { tipo, valorCentavos, motivo } });
  const fecharCaixa = (corpo) => api('POST', '/equipe/caixa/fechar', { corpo });
  const finalizar = (id, formaPagamento) => api('PATCH', `/equipe/pedidos/${id}/finalizar`, { corpo: { formaPagamento } });

  /** Pedido de delivery confirmado (como se viesse do site/WhatsApp), com total exato. */
  let numero = 0;
  async function pedidoConfirmado(totalCentavos, extra = {}) {
    numero += 1;
    return prisma.pedido.create({
      data: {
        numeroDia: 1000 + numero,
        dataRef: new Date(`${DIA}T00:00:00Z`),
        canal: 'WHATSAPP',
        status: 'CONFIRMADO',
        nomeCliente: `Cliente ${numero}`,
        subtotalCentavos: totalCentavos,
        totalCentavos,
        formaPagamento: 'DINHEIRO',
        ...extra,
      },
    });
  }

  async function abrirComanda(nomeCliente) {
    const r = await api('POST', '/equipe/comandas', { corpo: { nomeCliente } });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    return r.corpo.comanda;
  }

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const { criarTempoReal } = await import('../src/lib/tempoReal.js');
    const { criarAtendente, criarDono } = await import('../src/services/usuario.service.js');

    await prisma.produto.update({ where: { nome: 'Prato por kg' }, data: { precoCentavos: 5990, ativo: true } });
    for (const prod of await prisma.produto.findMany()) p[prod.nome] = prod;
    atendente = await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });
    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });

    servidor = http.createServer(criarApp({ log: false, relogio: () => agora }));
    criarTempoReal(servidor);
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    const login = async (email, senha) =>
      (await api('POST', '/auth/login', { corpo: { email, senha }, tk: null })).corpo.accessToken;
    tkAtendente = await login('ana@teste.com', 'senha-da-ana');
    tkDono = await login('dono@teste.com', 'senha-do-dono');
  });

  // Cada teste começa sem caixa aberto e sem pedido aberto.
  beforeEach(async () => {
    agora = SEXTA_12H;
    await prisma.pedido.updateMany({ where: { status: { in: ['ABERTO', 'CONFIRMADO'] } }, data: { status: 'CANCELADO' } });
    await prisma.caixa.updateMany({
      where: { fechadoEm: null },
      data: { fechadoEm: agora, fechadoPorId: atendente.id, valorContadoCentavos: 0, esperadoCentavos: 0, diferencaCentavos: 0 },
    });
    await prisma.produto.updateMany({ where: { controlaEstoque: true }, data: { estoque: 50 } });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  // ───────── Abrir ─────────

  test('abrir: 201 com valor inicial e quem abriu; abrir de novo = 409 CAIXA_JA_ABERTO; negativo = 400', async () => {
    const r = await abrirCaixa(15000);
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.caixa.valorInicialCentavos, 15000);
    assert.deepEqual(r.corpo.caixa.abertoPor, { id: atendente.id, nome: 'Ana' });
    assert.deepEqual(new Date(r.corpo.caixa.abertoEm), SEXTA_12H);

    const atual = await api('GET', '/equipe/caixa/atual');
    assert.equal(atual.corpo.caixa.id, r.corpo.caixa.id);

    const outra = await abrirCaixa(1);
    assert.equal(outra.status, 409);
    assert.equal(outra.corpo.erro.codigo, 'CAIXA_JA_ABERTO');
    await prisma.caixa.updateMany({ where: { fechadoEm: null }, data: { fechadoEm: agora, fechadoPorId: atendente.id, valorContadoCentavos: 0, esperadoCentavos: 0, diferencaCentavos: 0 } });
    for (const corpo of [{ valorInicialCentavos: -1 }, { valorInicialCentavos: 12.5 }, { valorInicialCentavos: '100' }, {}]) {
      assert.equal((await api('POST', '/equipe/caixa/abrir', { corpo })).status, 400, JSON.stringify(corpo));
    }
    assert.equal(await prisma.caixa.count({ where: { fechadoEm: null } }), 0);
  });

  test('só um caixa aberto, mesmo com aberturas simultâneas (o banco garante)', async () => {
    const respostas = await Promise.all(Array.from({ length: 6 }, (_, i) => abrirCaixa(1000 + i)));
    assert.equal(respostas.filter((r) => r.status === 201).length, 1, JSON.stringify(respostas.map((r) => r.status)));
    assert.ok(respostas.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.corpo.erro.codigo === 'CAIXA_JA_ABERTO'));
    assert.equal(await prisma.caixa.count({ where: { fechadoEm: null } }), 1);

    // Mesmo por fora do service, o índice parcial recusa o segundo aberto.
    await assert.rejects(
      prisma.caixa.create({ data: { abertoPorId: atendente.id, valorInicialCentavos: 0 } }),
      (err) => err.code === 'P2002',
    );
    // CHECK: fechado pela metade é recusado.
    await assert.rejects(prisma.caixa.updateMany({ where: { fechadoEm: null }, data: { fechadoEm: agora } }));
  });

  // ───────── Finalizar exige caixa ─────────

  test('finalizar sem caixa = 409 CAIXA_FECHADO (delivery e comanda), e o pedido continua aberto', async () => {
    const delivery = await pedidoConfirmado(2500);
    const r = await finalizar(delivery.id, 'PIX');
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'CAIXA_FECHADO');
    const banco = await prisma.pedido.findUnique({ where: { id: delivery.id } });
    assert.equal(banco.status, 'CONFIRMADO');
    assert.equal(banco.caixaId, null);

    // Comanda: abre e lança sem caixa (só fechar a conta exige).
    const c = await abrirComanda('Sem caixa');
    assert.equal((await api('POST', `/equipe/comandas/${c.id}/itens`, { corpo: { produtoId: p['Coca-Cola 1L'].id } })).status, 201);
    const f = await api('POST', `/equipe/comandas/${c.id}/fechar`, { corpo: { formaPagamento: 'DINHEIRO' } });
    assert.equal(f.status, 409);
    assert.equal(f.corpo.erro.codigo, 'CAIXA_FECHADO');
    assert.equal((await prisma.pedido.findUnique({ where: { id: c.id } })).status, 'ABERTO');
  });

  // ───────── Esperado ─────────

  test('esperado bate centavo a centavo: abertura + 3 em dinheiro − Pix + suprimento − sangria', async () => {
    // Pedido finalizado em dinheiro num caixa ANTERIOR não entra neste.
    const anterior = await abrirCaixa(0);
    const velho = await pedidoConfirmado(9999);
    assert.equal((await finalizar(velho.id, 'DINHEIRO')).status, 200);
    await prisma.pedido.updateMany({ where: { status: { in: ['ABERTO', 'CONFIRMADO'] } }, data: { status: 'CANCELADO' } });
    assert.equal((await fecharCaixa({ valorContadoCentavos: 9999 })).status, 200);

    const delivery1 = await pedidoConfirmado(3333); // criado ANTES da abertura: entra no caixa em que for finalizado
    const r = await abrirCaixa(10000);
    assert.notEqual(r.corpo.caixa.id, anterior.corpo.caixa.id);
    const caixaId = r.corpo.caixa.id;

    // 1) comanda: prato 487 g = 2917, em dinheiro
    const c = await abrirComanda('João');
    await api('POST', `/equipe/comandas/${c.id}/itens`, { corpo: { produtoId: p['Prato por kg'].id, pesoGramas: 487 } });
    assert.equal((await api('POST', `/equipe/comandas/${c.id}/fechar`, { corpo: { formaPagamento: 'DINHEIRO' } })).status, 200);
    // 2) delivery em dinheiro (3333) e 3) site que escolheu Pix mas pagou em dinheiro (1287)
    assert.equal((await finalizar(delivery1.id, 'DINHEIRO')).status, 200);
    const site = await pedidoConfirmado(1287, { canal: 'SITE', formaPagamento: 'PIX' });
    assert.equal((await finalizar(site.id, 'DINHEIRO')).status, 200);
    // Pix (não entra) e um cancelado em dinheiro (não entra)
    const pix = await pedidoConfirmado(4590, { trocoParaCentavos: 5000 });
    assert.equal((await finalizar(pix.id, 'PIX')).status, 200);
    const cancelado = await pedidoConfirmado(7777);
    assert.equal((await api('PATCH', `/equipe/pedidos/${cancelado.id}/cancelar`)).status, 200);

    assert.equal((await movimento('SUPRIMENTO', 2000, 'troco do banco')).status, 201);
    assert.equal((await movimento('SANGRIA', 5000, 'depósito')).status, 201);

    const esperado = 10000 + 2917 + 3333 + 1287 + 2000 - 5000;
    assert.equal(esperado, 14537);

    // Retaguarda com o caixa ainda aberto: esperado parcial, sem contado.
    const parcial = await api('GET', `/retaguarda/caixas?data=${DIA}`, { tk: tkDono });
    const cxAberto = parcial.corpo.caixas.find((x) => x.id === caixaId);
    assert.equal(cxAberto.aberto, true);
    assert.equal(cxAberto.esperadoCentavos, esperado);
    assert.equal(cxAberto.valorContadoCentavos, null);

    agora = local('2026-11-13T23:30');
    const f = await fecharCaixa({ valorContadoCentavos: 14500, observacao: 'faltou moeda' });
    assert.equal(f.status, 200, JSON.stringify(f.corpo));

    const banco = await prisma.caixa.findUnique({ where: { id: caixaId } });
    assert.equal(banco.esperadoCentavos, 14537);
    assert.equal(banco.valorContadoCentavos, 14500);
    assert.equal(banco.diferencaCentavos, -37);
    assert.equal(banco.fechadoPorId, atendente.id);

    const ret = await api('GET', `/retaguarda/caixas?data=${DIA}`, { tk: tkDono });
    assert.equal(ret.status, 200);
    const cx = ret.corpo.caixas.find((x) => x.id === caixaId);
    assert.equal(cx.aberto, false);
    assert.equal(cx.valorInicialCentavos, 10000);
    assert.equal(cx.vendasDinheiroCentavos, 7537);
    assert.equal(cx.suprimentosCentavos, 2000);
    assert.equal(cx.sangriasCentavos, 5000);
    assert.equal(cx.esperadoCentavos, 14537);
    assert.equal(cx.valorContadoCentavos, 14500);
    assert.equal(cx.diferencaCentavos, -37);
    assert.equal(cx.observacao, 'faltou moeda');
    assert.deepEqual(
      [...cx.totaisPorForma].sort((a, b) => a.forma.localeCompare(b.forma)),
      [
        { forma: 'DINHEIRO', quantidade: 3, totalCentavos: 7537 },
        { forma: 'PIX', quantidade: 1, totalCentavos: 4590 },
      ],
    );
    assert.deepEqual(cx.movimentos.map((m) => [m.tipo, m.valorCentavos, m.motivo]), [
      ['SUPRIMENTO', 2000, 'troco do banco'],
      ['SANGRIA', 5000, 'depósito'],
    ]);
    // Outro dia: nada. Dia no futuro: 400.
    assert.deepEqual((await api('GET', '/retaguarda/caixas?data=2026-11-12', { tk: tkDono })).corpo.caixas, []);
    assert.equal((await api('GET', '/retaguarda/caixas?data=2026-11-14', { tk: tkDono })).status, 400);
  });

  // ───────── Fechamento cego ─────────

  test('atendente não recebe o esperado nem a diferença (abrir, atual, movimentos, fechar, impressão, socket); retaguarda = 403', async () => {
    const socket = conectarSocket(new URL(base).origin, { path: '/api/socket.io', auth: { token: tkAtendente }, transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const eventos = [];
    socket.on('caixa:atualizado', (d) => eventos.push(d));
    try {
      const respostas = [];
      respostas.push(await abrirCaixa(5000));
      const d = await pedidoConfirmado(1234);
      await finalizar(d.id, 'DINHEIRO');
      respostas.push(await movimento('SANGRIA', 100));
      respostas.push(await api('GET', '/equipe/caixa/atual'));
      respostas.push(await fecharCaixa({ valorContadoCentavos: 1, esperadoCentavos: 999 }));
      respostas.push(await api('GET', '/equipe/impressoes/pendentes'));
      respostas.push(await api('GET', '/equipe/caixa/atual', { tk: tkDono }));
      await new Promise((r) => setTimeout(r, 100));

      for (const r of respostas) assert.ok(r.status < 300, JSON.stringify(r.corpo));
      assert.deepEqual(chavesDoFechamento(respostas.map((r) => r.corpo)), [], 'nenhuma resposta da equipe traz esperado/diferença');
      assert.deepEqual(chavesDoFechamento(eventos), [], 'nem o evento do socket');
      assert.ok(eventos.length >= 3);

      const caixa = await prisma.caixa.findFirst({ orderBy: { id: 'desc' } });
      assert.equal(caixa.esperadoCentavos, 5000 + 1234 - 100, 'o corpo não manda no esperado');
      assert.equal(caixa.diferencaCentavos, 1 - 6134);

      const proibido = await api('GET', '/retaguarda/caixas', { tk: tkAtendente });
      assert.equal(proibido.status, 403);
      assert.equal((await api('GET', '/retaguarda/caixas', { tk: null })).status, 401);
    } finally {
      socket.close();
    }
  });

  test('fechar cria TrabalhoImpressao FECHAMENTO do caixa, com resumo e totais por forma', async () => {
    const r = await abrirCaixa(3000);
    const d = await pedidoConfirmado(1500);
    await finalizar(d.id, 'CREDITO');
    await movimento('SUPRIMENTO', 700, 'moedas');
    await fecharCaixa({ valorContadoCentavos: 3700 });

    const [trabalho] = await prisma.trabalhoImpressao.findMany({ where: { caixaId: r.corpo.caixa.id } });
    assert.equal(trabalho.tipo, 'FECHAMENTO');
    assert.equal(trabalho.status, 'PENDENTE');
    assert.equal(trabalho.pedidoId, null);

    const pend = await api('GET', '/equipe/impressoes/pendentes');
    const t = pend.corpo.trabalhos.find((x) => x.id === trabalho.id);
    assert.equal(t.pedido, undefined);
    assert.equal(t.caixa.valorInicialCentavos, 3000);
    assert.equal(t.caixa.valorContadoCentavos, 3700);
    assert.deepEqual(t.caixa.totaisPorForma, [{ forma: 'CREDITO', quantidade: 1, totalCentavos: 1500 }]);
    assert.deepEqual(t.caixa.movimentos.map((m) => m.motivo), ['moedas']);

    // CHECK: trabalho sem dono (nem pedido nem caixa) é recusado pelo banco.
    await assert.rejects(prisma.trabalhoImpressao.create({ data: { tipo: 'FECHAMENTO' } }));
  });

  test('fechar com comanda aberta = 409 PEDIDOS_ABERTOS listando a comanda (e o delivery confirmado)', async () => {
    await abrirCaixa(1000);
    const c = await abrirComanda('Maria');
    await api('POST', `/equipe/comandas/${c.id}/itens`, { corpo: { produtoId: p['Coca-Cola 1L'].id } });
    const d = await pedidoConfirmado(2200);

    const r = await fecharCaixa({ valorContadoCentavos: 1000 });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'PEDIDOS_ABERTOS');
    const lista = r.corpo.erro.detalhes.pedidos;
    const comanda = lista.find((x) => x.id === c.id);
    assert.deepEqual(
      { canal: comanda.canal, status: comanda.status, nome: comanda.nomeCliente, itens: comanda.quantidadeItens },
      { canal: 'SALAO', status: 'ABERTO', nome: 'Maria', itens: 1 },
    );
    assert.equal(comanda.totalCentavos, p['Coca-Cola 1L'].precoCentavos);
    assert.ok(lista.some((x) => x.id === d.id && x.canal === 'WHATSAPP'));
    assert.ok(lista.every((x) => 'numeroDia' in x && 'formaPagamento' in x), 'o PDV precisa disso para os atalhos');
    assert.equal(await prisma.caixa.count({ where: { fechadoEm: null } }), 1, 'continua aberto');

    // Resolvendo pela lista: fechar a comanda e cancelar o delivery; aí fecha.
    assert.equal((await api('POST', `/equipe/comandas/${c.id}/fechar`, { corpo: { formaPagamento: 'DINHEIRO' } })).status, 200);
    assert.equal((await api('PATCH', `/equipe/pedidos/${d.id}/cancelar`)).status, 200);
    assert.equal((await fecharCaixa({ valorContadoCentavos: 1000 + p['Coca-Cola 1L'].precoCentavos })).status, 200);
  });

  test('fechar: sem valor contado = 400; sem caixa aberto = 409 CAIXA_FECHADO', async () => {
    await abrirCaixa(0);
    for (const corpo of [{}, { valorContadoCentavos: -1 }, { valorContadoCentavos: 10.5 }]) {
      assert.equal((await fecharCaixa(corpo)).status, 400, JSON.stringify(corpo));
    }
    assert.equal((await fecharCaixa({ valorContadoCentavos: 0 })).status, 200);
    const r = await fecharCaixa({ valorContadoCentavos: 0 });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'CAIXA_FECHADO');
  });

  // ───────── Movimentos ─────────

  test('movimentos: sangria maior que a gaveta é permitida; valor 0, motivo vazio ou tipo errado = 400; sem caixa = 409', async () => {
    assert.equal((await movimento('SANGRIA', 100)).corpo.erro.codigo, 'CAIXA_FECHADO');
    await abrirCaixa(500);
    const r = await movimento('SANGRIA', 99999, 'banco');
    assert.equal(r.status, 201);
    assert.equal(r.corpo.caixa.movimentos[0].usuario.nome, 'Ana');
    assert.equal((await movimento('SANGRIA', 0)).status, 400);
    assert.equal((await movimento('SANGRIA', 100, '   ')).status, 400);
    assert.equal((await movimento('RETIRADA', 100)).status, 400);
    await fecharCaixa({ valorContadoCentavos: 0 });
    const cx = await prisma.caixa.findFirst({ orderBy: { id: 'desc' } });
    assert.equal(cx.esperadoCentavos, 500 - 99999, 'esperado negativo fica registrado para o dono');
  });

  // ───────── Concorrência ─────────

  test('finalizar e fechar o caixa ao mesmo tempo: o pedido nunca fica fora do esperado', async () => {
    for (let rodada = 0; rodada < 6; rodada += 1) {
      await abrirCaixa(1000);
      const d = await pedidoConfirmado(500 + rodada);
      const [fin, fec] = await Promise.all([finalizar(d.id, 'DINHEIRO'), fecharCaixa({ valorContadoCentavos: 0 })]);
      const ped = await prisma.pedido.findUnique({ where: { id: d.id } });
      if (fec.status === 200) {
        // Fechou depois da finalização: o pedido está no esperado deste caixa.
        assert.equal(fin.status, 200);
        const cx = await prisma.caixa.findUnique({ where: { id: ped.caixaId } });
        assert.equal(cx.esperadoCentavos, 1000 + 500 + rodada);
      } else {
        assert.equal(fec.corpo.erro.codigo, 'PEDIDOS_ABERTOS');
        assert.equal(fin.status, 200);
        assert.equal((await fecharCaixa({ valorContadoCentavos: 0 })).status, 200);
        const cx = await prisma.caixa.findUnique({ where: { id: ped.caixaId } });
        assert.equal(cx.esperadoCentavos, 1000 + 500 + rodada);
      }
    }
  });

  test('sangria e fechamento ao mesmo tempo: ou entra no esperado, ou é recusada com CAIXA_FECHADO', async () => {
    for (let rodada = 0; rodada < 6; rodada += 1) {
      const r = await abrirCaixa(1000);
      const [mov, fec] = await Promise.all([movimento('SANGRIA', 300), fecharCaixa({ valorContadoCentavos: 0 })]);
      assert.equal(fec.status, 200);
      const cx = await prisma.caixa.findUnique({ where: { id: r.corpo.caixa.id } });
      if (mov.status === 201) assert.equal(cx.esperadoCentavos, 700);
      else {
        assert.equal(mov.corpo.erro.codigo, 'CAIXA_FECHADO');
        assert.equal(cx.esperadoCentavos, 1000);
        assert.equal(await prisma.movimentoCaixa.count({ where: { caixaId: cx.id } }), 0);
      }
    }
  });
});
