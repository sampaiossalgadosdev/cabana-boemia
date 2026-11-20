import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';
import { porQuantidade, porValor, ticketMedio } from '../src/services/relatorio.service.js';

const local = (iso) => new Date(`${iso}-03:00`);

test('ticketMedio arredonda ao centavo; sem pedidos = 0', () => {
  assert.equal(ticketMedio(11517, 3), 3839);
  assert.equal(ticketMedio(100, 3), 33);
  assert.equal(ticketMedio(200, 3), 67);
  assert.equal(ticketMedio(0, 0), 0);
});

test('ordenação dos tops: desempate por valor/quantidade e depois pelo nome', () => {
  const l = [
    { nome: 'B', quantidade: 1, totalCentavos: 900 },
    { nome: 'A', quantidade: 1, totalCentavos: 900 },
    { nome: 'C', quantidade: 2, totalCentavos: 500 },
    { nome: 'D', quantidade: 1, totalCentavos: 3000 },
  ];
  assert.deepEqual([...l].sort(porQuantidade).map((x) => x.nome), ['C', 'D', 'A', 'B']);
  assert.deepEqual([...l].sort(porValor).map((x) => x.nome), ['D', 'A', 'B', 'C']);
});

/**
 * Dados fixos (dia operacional sexta 2026-11-13, virada às 04:00), criados
 * pelos fluxos reais (criarPedido, comanda, finalizar, cancelar):
 *   P1 SITE      2 X-Bacon (3200) + Refri (500) + taxa 500 = 4200, PIX, finalizado sex 20:10
 *   P2 WHATSAPP  X-Salada (1300) + Coca 1L (900) + taxa 500 = 2700, DINHEIRO, finalizado sex 23:59
 *   P3 SALAO     Prato 487 g (2917) + X-Burguer (1200) + 2 Refri, 1 Refri REMOVIDO = 4617, DEBITO, fechado sáb 00:30
 *   P4 WHATSAPP  Pizza Calabresa (5000) + taxa 500 = 5500, CANCELADO sex 23:00
 *   P0 SALAO     Salame 2000, fechado sex 03:59 → dia operacional de QUINTA
 *   P5 SALAO     Salame 2000, fechado sáb 04:00 → dia operacional de SÁBADO
 * Total sexta = 4200 + 2700 + 4617 = 11517; itens 10517 + taxa 1000.
 */
describe('relatório do dia operacional', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = local('2026-11-14T10:00');
  let tkDono;
  let tkAtendente;
  let eventos = [];
  let pararEventos;
  const p = {};
  const ids = {};

  async function api(metodo, rota, { corpo, tk = tkDono } = {}) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const { criarAtendente, criarDono } = await import('../src/services/usuario.service.js');
    const { aoEmitirParaEquipe } = await import('../src/lib/eventos.js');
    const pedidoService = await import('../src/services/pedido.service.js');
    const comanda = await import('../src/services/comanda.service.js');
    const caixa = await import('../src/services/caixa.service.js');
    const { finalizarPedido } = await import('../src/services/equipe.service.js');
    pararEventos = aoEmitirParaEquipe((evento, dados) => eventos.push({ evento, dados }));

    await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Prato por kg' } }, data: { precoCentavos: 5990, ativo: true } });
    await prisma.produto.updateMany({ where: { controlaEstoque: true }, data: { estoque: 100 } });
    await prisma.insumo.updateMany({ data: { estoque: 100 } });
    for (const prod of await prisma.produto.findMany()) p[prod.nome] = prod;
    const atendente = await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });
    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });
    const bairro = await prisma.bairro.create({ data: { lojaId: 1, nome: 'Centro', taxaCentavos: 500 } });
    const cliente = await prisma.cliente.create({ data: { nome: 'Joana', telefone: '43999990000' } });
    const endereco = { texto: 'Rua A, 1', bairroId: bairro.id };
    const item = (nome, quantidade = 1) => ({ produtoId: p[nome].id, quantidade });

    // Um caixa aberto desde quinta (finalizar exige caixa).
    await caixa.abrirCaixa(1, { valorInicialCentavos: 10000 }, { usuarioId: atendente.id, agora: local('2026-11-12T10:00') });

    async function comandaFechada(nome, itens, { abre, fecha, forma }) {
      const c = await comanda.abrirComanda(1, { nomeCliente: nome }, { agora: abre });
      for (const i of itens) await comanda.lancarItem(1, c.id, i);
      await comanda.fecharComanda(1, c.id, { formaPagamento: forma }, { agora: fecha });
      return c.id;
    }

    // P0: fechada sexta 03:59 → quinta.
    ids.p0 = await comandaFechada('Madrugada', [item('Salame')], { abre: local('2026-11-13T03:00'), fecha: local('2026-11-13T03:59'), forma: 'PIX' });

    // P1 SITE (loja aberta: Lanches sexta 19:00–00:00).
    const p1 = await pedidoService.criarPedido({
      lojaId: 1,
      canal: 'SITE',
      itens: [item('X-Bacon', 2), item('Refrigerante Lata')],
      cliente: { id: cliente.id, nome: 'Joana', telefone: '43999990000' },
      endereco,
      pagamento: { forma: 'PIX' },
      totalEsperadoCentavos: 4200,
      agora: local('2026-11-13T19:30'),
    });
    ids.p1 = p1.pedido.id;
    await finalizarPedido(1, ids.p1, { formaPagamento: 'PIX' }, local('2026-11-13T20:10'));

    // P2 WHATSAPP, finalizado 23:59.
    const p2 = await pedidoService.criarPedido({
      lojaId: 1,
      canal: 'WHATSAPP',
      itens: [item('X-Salada'), item('Coca-Cola 1L')],
      cliente: { id: cliente.id, nome: 'Joana', telefone: '43999990000' },
      endereco,
      pagamento: { forma: 'DINHEIRO', trocoParaCentavos: 5000 },
      agora: local('2026-11-13T21:00'),
    });
    ids.p2 = p2.pedido.id;
    await finalizarPedido(1, ids.p2, { formaPagamento: 'DINHEIRO' }, local('2026-11-13T23:59'));

    // P4 WHATSAPP cancelado 23:00.
    const p4 = await pedidoService.criarPedido({
      lojaId: 1,
      canal: 'WHATSAPP',
      itens: [item('Pizza Calabresa')],
      cliente: { id: cliente.id, nome: 'Joana', telefone: '43999990000' },
      endereco,
      pagamento: { forma: 'PIX' },
      agora: local('2026-11-13T22:30'),
    });
    ids.p4 = p4.pedido.id;
    await pedidoService.cancelarPedido(1, ids.p4, { agora: local('2026-11-13T23:00') });

    // P3 SALAO: 2 Refri, remove 1; fechada sábado 00:30 (ainda é sexta).
    const c3 = await comanda.abrirComanda(1, { nomeCliente: 'Mesa do fundo' }, { agora: local('2026-11-13T22:00') });
    await comanda.lancarItem(1, c3.id, { produtoId: p['Prato por kg'].id, pesoGramas: 487 });
    await comanda.lancarItem(1, c3.id, item('X-Burguer'));
    await comanda.lancarItem(1, c3.id, item('Refrigerante Lata'));
    const comRefri = await comanda.lancarItem(1, c3.id, item('Refrigerante Lata'));
    const refri = comRefri.itens.filter((i) => i.produtoId === p['Refrigerante Lata'].id).at(-1);
    await comanda.removerItem(1, c3.id, refri.id, { agora: local('2026-11-13T23:30') });
    await comanda.fecharComanda(1, c3.id, { formaPagamento: 'DEBITO' }, { agora: local('2026-11-14T00:30') });
    ids.p3 = c3.id;

    // P5: fechada sábado 04:00 → sábado.
    ids.p5 = await comandaFechada('Cedo', [item('Salame')], { abre: local('2026-11-14T03:50'), fecha: local('2026-11-14T04:00'), forma: 'CREDITO' });

    servidor = http.createServer(criarApp({ log: false, relogio: () => agora }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    const login = async (email, senha) =>
      (await api('POST', '/auth/login', { corpo: { email, senha }, tk: null })).corpo.accessToken;
    tkDono = await login('dono@teste.com', 'senha-do-dono');
    tkAtendente = await login('ana@teste.com', 'senha-da-ana');
  });

  after(async () => {
    pararEventos?.();
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('os dados fixos ficaram como planejado (totais gravados pelos fluxos reais)', async () => {
    const t = async (id) => (await prisma.pedido.findUnique({ where: { id } })).totalCentavos;
    assert.equal(await t(ids.p1), 4200);
    assert.equal(await t(ids.p2), 2700);
    assert.equal(await t(ids.p3), 4617, 'comanda sem o Refri removido');
    assert.equal(await t(ids.p4), 5500);
    assert.equal(await prisma.itemPedido.count({ where: { pedidoId: ids.p3, canceladoEm: { not: null } } }), 1);
  });

  test('sexta: totais batem centavo a centavo (só FINALIZADOS, sem item removido)', async () => {
    const r = await api('GET', '/retaguarda/relatorios/dia?data=2026-11-13');
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const d = r.corpo;
    assert.equal(d.data, '2026-11-13');
    assert.equal(d.horaViradaDia, 4);
    assert.deepEqual(new Date(d.inicio), local('2026-11-13T04:00'));
    assert.deepEqual(new Date(d.fim), local('2026-11-14T04:00'));
    assert.equal(d.totalCentavos, 11517);
    assert.equal(d.quantidadePedidos, 3);
    assert.equal(d.ticketMedioCentavos, 3839);
    assert.equal(d.taxaEntregaCentavos, 1000);
    assert.equal(d.subtotalCentavos, 10517);
    assert.deepEqual(d.porFormaPagamento, [
      { forma: 'DINHEIRO', quantidade: 1, totalCentavos: 2700 },
      { forma: 'PIX', quantidade: 1, totalCentavos: 4200 },
      { forma: 'DEBITO', quantidade: 1, totalCentavos: 4617 },
      { forma: 'CREDITO', quantidade: 0, totalCentavos: 0 },
    ]);
    assert.deepEqual(d.porCanal, [
      { canal: 'SITE', quantidade: 1, totalCentavos: 4200 },
      { canal: 'WHATSAPP', quantidade: 1, totalCentavos: 2700 },
      { canal: 'SALAO', quantidade: 1, totalCentavos: 4617 },
    ]);
    const linha = (x) => [x.nome, x.quantidade, x.totalCentavos, x.pesoGramas];
    assert.deepEqual(d.topPorQuantidade.map(linha), [
      ['X-Bacon', 2, 3200, null],
      ['Refrigerante Lata', 2, 1000, null],
      ['Prato por kg', 1, 2917, 487],
      ['X-Salada', 1, 1300, null],
      ['X-Burguer', 1, 1200, null],
      ['Coca-Cola 1L', 1, 900, null],
    ]);
    assert.deepEqual(d.topPorValor.map((x) => x.nome), ['X-Bacon', 'Prato por kg', 'X-Salada', 'X-Burguer', 'Refrigerante Lata', 'Coca-Cola 1L']);
    assert.deepEqual(d.cancelados, { quantidade: 1, totalCentavos: 5500 });
    assert.deepEqual(d.itensRemovidos, { quantidade: 1, totalCentavos: 500 });

    // Coerência: Σ itens + Σ taxa = Σ total; formas e canais somam o total.
    const itens = d.topPorValor.reduce((s, x) => s + x.totalCentavos, 0);
    assert.equal(itens + d.taxaEntregaCentavos, d.totalCentavos);
    assert.equal(d.porFormaPagamento.reduce((s, x) => s + x.totalCentavos, 0), d.totalCentavos);
    assert.equal(d.porCanal.reduce((s, x) => s + x.quantidade, 0), d.quantidadePedidos);
  });

  test('borda do dia operacional: 23:59 e 00:30 contam na sexta; 03:59 de sexta é quinta; 04:00 de sábado é sábado', async () => {
    const quinta = (await api('GET', '/retaguarda/relatorios/dia?data=2026-11-12')).corpo;
    assert.deepEqual([quinta.totalCentavos, quinta.quantidadePedidos], [2000, 1]);
    assert.equal(quinta.topPorQuantidade[0].nome, 'Salame');
    const sabado = (await api('GET', '/retaguarda/relatorios/dia?data=2026-11-14')).corpo;
    assert.deepEqual([sabado.totalCentavos, sabado.quantidadePedidos], [2000, 1]);
    assert.deepEqual(sabado.porFormaPagamento.find((f) => f.forma === 'CREDITO'), { forma: 'CREDITO', quantidade: 1, totalCentavos: 2000 });
    assert.deepEqual(sabado.cancelados, { quantidade: 0, totalCentavos: 0 });
  });

  test('"hoje" é o dia operacional: sábado 02:00 ainda é sexta', async () => {
    agora = local('2026-11-14T02:00');
    const r = await api('GET', '/retaguarda/relatorios/dia?data=hoje');
    assert.equal(r.corpo.data, '2026-11-13');
    assert.equal(r.corpo.totalCentavos, 11517);
    agora = local('2026-11-14T10:00');
    assert.equal((await api('GET', '/retaguarda/relatorios/dia')).corpo.data, '2026-11-14');
  });

  test('dia sem vendas: zeros (formas e canais completos); data inválida ou no futuro = 400', async () => {
    const r = (await api('GET', '/retaguarda/relatorios/dia?data=2026-11-01')).corpo;
    assert.equal(r.totalCentavos, 0);
    assert.equal(r.ticketMedioCentavos, 0);
    assert.equal(r.porFormaPagamento.length, 4);
    assert.equal(r.porCanal.length, 3);
    assert.deepEqual(r.topPorQuantidade, []);
    for (const data of ['2026-11-15', '2026-02-31', '13/11/2026', 'ontem']) {
      const e = await api('GET', `/retaguarda/relatorios/dia?data=${encodeURIComponent(data)}`);
      assert.equal(e.status, 400, data);
    }
  });

  test('imprimir: TrabalhoImpressao RELATORIO_DIA pendente com dataRelatorio; a fila leva o relatório calculado', async () => {
    eventos = [];
    const r = await api('POST', '/retaguarda/relatorios/dia/imprimir', { corpo: { data: '2026-11-13' } });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo.trabalho.dataRelatorio, '2026-11-13');
    const t = await prisma.trabalhoImpressao.findUnique({ where: { id: r.corpo.trabalho.id } });
    assert.equal(t.tipo, 'RELATORIO_DIA');
    assert.equal(t.status, 'PENDENTE');
    assert.equal(t.pedidoId, null);
    assert.equal(t.caixaId, null);
    assert.equal(t.dataRelatorio.toISOString().slice(0, 10), '2026-11-13');
    assert.deepEqual(eventos.map((e) => e.evento), ['impressao:nova']);

    const fila = await api('GET', '/equipe/impressoes/pendentes', { tk: tkAtendente });
    const noFila = fila.corpo.trabalhos.find((x) => x.id === t.id);
    assert.equal(noFila.tipo, 'RELATORIO_DIA');
    assert.equal(noFila.dataRelatorio, '2026-11-13');
    assert.equal(noFila.relatorio.totalCentavos, 11517);

    const { montarCupom, cupomParaTexto } = await import('@restaurante/shared/cupom');
    const texto = cupomParaTexto(montarCupom(noFila, { colunas: 48 }), 48);
    assert.match(texto, /RESUMO DO DIA/);
    assert.match(texto, /R\$ 115,17/);

    assert.equal((await api('POST', '/retaguarda/relatorios/dia/imprimir', { corpo: { data: '2026-12-01' } })).status, 400);
    assert.equal((await api('POST', '/retaguarda/relatorios/dia/imprimir', { corpo: { data: 'hoje' }, tk: tkAtendente })).status, 403);
  });

  test('o banco recusa trabalho com dois donos ou sem dono (CHECK)', async () => {
    await assert.rejects(prisma.trabalhoImpressao.create({ data: { lojaId: 1, tipo: 'RELATORIO_DIA' } }));
    await assert.rejects(
      prisma.trabalhoImpressao.create({ data: { lojaId: 1, tipo: 'RELATORIO_DIA', pedidoId: ids.p1, dataRelatorio: new Date('2026-11-13T00:00:00Z') } }),
    );
  });
});
