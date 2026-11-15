import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as conectarSocket } from 'socket.io-client';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SABADO_20H = local('2026-11-14T20:00'); // turno Lanches aberto
const QUINTA_18H59 = local('2026-11-12T18:59'); // fechado
const DOMINGO_18H30 = local('2026-11-15T18:30'); // aberto, dia seguinte

describe('pedidos: transação, estoque atômico e preço do servidor', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = SABADO_20H;
  let gerarTokenCliente;
  let baixarEstoque;
  let criarPedido;
  let tokenDono;
  let centro;
  const p = {}; // produtos por nome
  const insumo = {};

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

  /** Cliente com telefone e um endereço no Centro (taxa R$ 5,00). */
  let seq = 0;
  async function novoCliente({ telefone = '43999990000' } = {}) {
    seq += 1;
    const cliente = await prisma.cliente.create({
      data: { googleId: `pedido-${seq}`, nome: `Cliente ${seq}`, telefone },
    });
    const endereco = await prisma.endereco.create({
      data: { clienteId: cliente.id, rua: 'Rua das Flores', numero: '120', bairroId: centro.id, principal: true },
    });
    return { cliente, endereco, token: gerarTokenCliente(cliente) };
  }

  const item = (nome, quantidade = 1, extra = {}) => ({ produtoId: p[nome].id, quantidade, ...extra });

  /** Total que o cliente "viu": preços do seed + taxa do Centro (R$ 5,00). */
  function totalVisto(itens) {
    const porId = new Map(Object.values(p).map((x) => [x.id, x.precoCentavos]));
    return itens.reduce((s, i) => s + (porId.get(i.produtoId) ?? 0) * (i.quantidade ?? 1), 0) + 500;
  }

  function pedir(c, itens, extra = {}) {
    return api('POST', '/cliente/pedidos', {
      token: c.token,
      corpo: { itens, enderecoId: c.endereco.id, formaPagamento: 'PIX', totalEsperadoCentavos: totalVisto(itens), ...extra },
    });
  }

  const estoqueInsumo = async (nome) => (await prisma.insumo.findUnique({ where: { nome } })).estoque;
  const estoqueProduto = async (nome) => (await prisma.produto.findUnique({ where: { nome } })).estoque;

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    ({ gerarTokenCliente } = await import('../src/lib/tokens.js'));
    ({ baixarEstoque, criarPedido } = await import('../src/services/pedido.service.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarTempoReal } = await import('../src/lib/tempoReal.js');
    const { criarDono } = await import('../src/services/usuario.service.js');

    for (const prod of await prisma.produto.findMany()) p[prod.nome] = prod;
    for (const i of await prisma.insumo.findMany()) insumo[i.nome] = i;
    centro = await prisma.bairro.create({ data: { nome: 'Centro', taxaCentavos: 500 } });
    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });

    const app = criarApp({ log: false, relogio: () => agora });
    servidor = http.createServer(app);
    criarTempoReal(servidor);
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;

    tokenDono = (await api('POST', '/auth/login', { corpo: { email: 'dono@teste.com', senha: 'senha-do-dono' } }))
      .corpo.accessToken;
  });

  beforeEach(async () => {
    agora = SABADO_20H;
    await prisma.produto.updateMany({ data: { disponivelHoje: true, ativo: true } });
    await prisma.produto.updateMany({ where: { controlaEstoque: true }, data: { estoque: 50 } });
    await prisma.insumo.updateMany({ data: { estoque: 50 } });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('pedido do site: preço, taxa e total do banco; snapshots, movimentação e impressão PENDENTE', async () => {
    const c = await novoCliente();
    const r = await pedir(c, [item('X-Bacon', 2, { observacao: ' sem cebola ' }), item('Coca-Cola 1L')]);
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const ped = r.corpo.pedido;
    assert.equal(ped.canal, 'SITE');
    assert.equal(ped.status, 'CONFIRMADO');
    assert.equal(ped.subtotalCentavos, 2 * 1600 + 900);
    assert.equal(ped.taxaEntregaCentavos, 500);
    assert.equal(ped.totalCentavos, 2 * 1600 + 900 + 500);
    assert.equal(ped.nomeCliente, c.cliente.nome);
    assert.equal(ped.telefone, '43999990000');
    assert.equal(ped.enderecoTexto, 'Rua das Flores, 120');
    assert.equal(ped.bairroNome, 'Centro');
    assert.equal(ped.tempoEstimadoMin, 40);
    assert.deepEqual(
      ped.itens.map((i) => [i.nome, i.quantidade, i.precoUnitarioCentavos, i.totalCentavos, i.observacao]),
      [
        ['X-Bacon', 2, 1600, 3200, 'sem cebola'],
        ['Coca-Cola 1L', 1, 900, 900, null],
      ],
    );

    assert.equal(await estoqueInsumo('Pão de lanche'), 48);
    assert.equal(await estoqueProduto('Coca-Cola 1L'), 49);

    const movs = await prisma.movimentacaoEstoque.findMany({
      where: { itemPedido: { pedidoId: ped.id } },
      orderBy: { id: 'asc' },
    });
    assert.deepEqual(
      movs.map((m) => [m.tipo, m.insumoId, m.produtoId, m.quantidade]),
      [
        ['VENDA', insumo['Pão de lanche'].id, null, -2],
        ['VENDA', null, p['Coca-Cola 1L'].id, -1],
      ],
    );
    const trabalhos = await prisma.trabalhoImpressao.findMany({ where: { pedidoId: ped.id } });
    assert.deepEqual(trabalhos.map((t) => [t.tipo, t.status]), [['PEDIDO', 'PENDENTE']]);
  });

  test('preço adulterado no body é ignorado', async () => {
    const c = await novoCliente();
    const r = await api('POST', '/cliente/pedidos', {
      token: c.token,
      corpo: {
        itens: [{ produtoId: p['X-Tudo'].id, quantidade: 1, precoCentavos: 1, totalCentavos: 1, nome: 'Grátis' }],
        enderecoId: c.endereco.id,
        formaPagamento: 'PIX',
        totalEsperadoCentavos: 2800,
        subtotalCentavos: 1,
        taxaEntregaCentavos: 0,
        totalCentavos: 1,
        canal: 'SALAO',
        nomeCliente: 'Outra Pessoa',
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.pedido.itens[0].precoUnitarioCentavos, 2300);
    assert.equal(r.corpo.pedido.itens[0].nome, 'X-Tudo');
    assert.equal(r.corpo.pedido.taxaEntregaCentavos, 500);
    assert.equal(r.corpo.pedido.totalCentavos, 2800);
    assert.equal(r.corpo.pedido.canal, 'SITE');
    assert.equal(r.corpo.pedido.nomeCliente, c.cliente.nome);
    const banco = await prisma.pedido.findUnique({ where: { id: r.corpo.pedido.id } });
    assert.equal(banco.totalCentavos, 2800);
  });

  test('dois pedidos concorrentes pelo último pão: um passa, outro recebe 409 e o estoque fica em 0', async () => {
    await prisma.insumo.update({ where: { nome: 'Pão de lanche' }, data: { estoque: 1 } });
    const [a, b] = await Promise.all([novoCliente(), novoCliente()]);

    const respostas = await Promise.all([pedir(a, [item('X-Bacon')]), pedir(b, [item('X-Salada')])]);
    const status = respostas.map((r) => r.status).sort();
    assert.deepEqual(status, [201, 409]);
    const recusado = respostas.find((r) => r.status === 409);
    assert.equal(recusado.corpo.erro.codigo, 'ESTOQUE_INSUFICIENTE');
    assert.match(recusado.corpo.erro.mensagem, /^Acabou: X-(Bacon|Salada) \(sem pão de lanche\)/);

    assert.equal(await estoqueInsumo('Pão de lanche'), 0);
    const pedidos = await prisma.pedido.count({ where: { clienteId: { in: [a.cliente.id, b.cliente.id] } } });
    assert.equal(pedidos, 1, 'o recusado não deixa pedido gravado');
  });

  test('dez pedidos concorrentes por 3 pães: exatamente 3 passam, estoque 0, números do dia sem repetição', async () => {
    await prisma.insumo.update({ where: { nome: 'Pão de lanche' }, data: { estoque: 3 } });
    const clientes = await Promise.all(Array.from({ length: 10 }, () => novoCliente()));

    const respostas = await Promise.all(clientes.map((c) => pedir(c, [item('X-Burguer'), item('Refrigerante Lata')])));
    const ok = respostas.filter((r) => r.status === 201);
    assert.equal(ok.length, 3);
    assert.ok(respostas.filter((r) => r.status !== 201).every((r) => r.status === 409));
    assert.equal(await estoqueInsumo('Pão de lanche'), 0);
    assert.equal(await estoqueProduto('Refrigerante Lata'), 47, 'as latas dos 7 recusados voltaram (rollback)');

    const doDia = await prisma.pedido.findMany({ where: { dataRef: new Date('2026-11-14T00:00:00Z') } });
    const numeros = doDia.map((x) => x.numeroDia).sort((x, y) => x - y);
    assert.deepEqual(numeros, Array.from({ length: numeros.length }, (_, i) => i + 1), 'sem buraco nem repetição');
  });

  test('baixa atômica (determinística): a transação concorrente espera a trava e não leva o pão já vendido', async () => {
    await prisma.insumo.update({ where: { nome: 'Pão de lanche' }, data: { estoque: 1 } });
    const necessidade = {
      produtos: [],
      insumos: [{ id: insumo['Pão de lanche'].id, nome: 'Pão de lanche', quantidade: 1, produtos: ['X-Bacon'] }],
    };

    let liberarA;
    const aSegura = new Promise((r) => (liberarA = r));
    let aBaixou;
    const aJaBaixou = new Promise((r) => (aBaixou = r));

    const txA = prisma.$transaction(async (tx) => {
      await baixarEstoque(tx, necessidade); // trava a linha do pão (1 → 0)
      aBaixou();
      await aSegura; // segura a trava sem commit
    });

    await aJaBaixou;
    let bTerminou = false;
    const txB = prisma
      .$transaction((tx) => baixarEstoque(tx, necessidade), { maxWait: 10_000, timeout: 15_000 })
      .then(
        () => 'ok',
        (err) => err,
      )
      .finally(() => (bTerminou = true));

    await new Promise((r) => setTimeout(r, 300));
    assert.equal(bTerminou, false, 'B fica esperando a trava de A');

    liberarA();
    await txA;
    const resultadoB = await txB;
    assert.equal(resultadoB.status, 409, 'B reavalia estoque >= 1 com o saldo já baixado e falha');
    assert.equal(resultadoB.codigo, 'ESTOQUE_INSUFICIENTE');
    assert.equal(await estoqueInsumo('Pão de lanche'), 0);
  });

  test('pedidos com os mesmos itens em ordens diferentes não entram em deadlock', async () => {
    const clientes = await Promise.all(Array.from({ length: 8 }, () => novoCliente()));
    const respostas = await Promise.all(
      clientes.map((c, i) =>
        pedir(c, i % 2 ? [item('X-Bacon'), item('Coca-Cola 2L')] : [item('Coca-Cola 2L'), item('X-Bacon')]),
      ),
    );
    assert.deepEqual(respostas.map((r) => r.status), Array(8).fill(201));
    assert.equal(await estoqueInsumo('Pão de lanche'), 42);
    assert.equal(await estoqueProduto('Coca-Cola 2L'), 42);
  });

  test('pedido do SITE fora do horário = 409 LOJA_FECHADA e nada é baixado', async () => {
    agora = QUINTA_18H59;
    const c = await novoCliente();
    const r = await pedir(c, [item('X-Bacon')]);
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'LOJA_FECHADA');
    assert.equal(await estoqueInsumo('Pão de lanche'), 50);
  });

  test('troco menor que o total = 400', async () => {
    const c = await novoCliente();
    // X-Bacon 1600 + taxa 500 = 2100
    const r = await pedir(c, [item('X-Bacon')], { formaPagamento: 'DINHEIRO', trocoParaCentavos: 2000 });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'TROCO_INVALIDO');
    assert.equal(r.corpo.erro.detalhes[0].campo, 'trocoParaCentavos');
    assert.equal(await estoqueInsumo('Pão de lanche'), 50, 'rollback da baixa');
  });

  test('troco igual ao total ou com pagamento que não é dinheiro = 400; maior que o total é gravado', async () => {
    const c = await novoCliente();
    const igual = await pedir(c, [item('X-Bacon')], { formaPagamento: 'DINHEIRO', trocoParaCentavos: 2100 });
    assert.equal(igual.status, 400);
    const pix = await pedir(c, [item('X-Bacon')], { formaPagamento: 'PIX', trocoParaCentavos: 5000 });
    assert.equal(pix.status, 400);
    assert.equal(pix.corpo.erro.detalhes[0].campo, 'trocoParaCentavos');

    const ok = await pedir(c, [item('X-Bacon')], { formaPagamento: 'DINHEIRO', trocoParaCentavos: 5000 });
    assert.equal(ok.status, 201);
    assert.equal(ok.corpo.pedido.formaPagamento, 'DINHEIRO');
    assert.equal(ok.corpo.pedido.trocoParaCentavos, 5000);
  });

  test('forma de pagamento obrigatória = 400', async () => {
    const c = await novoCliente();
    const r = await pedir(c, [item('X-Bacon')], { formaPagamento: undefined });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.detalhes[0].campo, 'formaPagamento');
  });

  test('bebida sem estoque = 409 com o nome dela, e a baixa do outro item é desfeita', async () => {
    await prisma.produto.update({ where: { nome: 'Coca-Cola 2L' }, data: { estoque: 0 } });
    const c = await novoCliente();
    const r = await pedir(c, [item('X-Bacon'), item('Coca-Cola 2L')]);
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'ESTOQUE_INSUFICIENTE');
    assert.match(r.corpo.erro.mensagem, /^Acabou: Coca-Cola 2L\./);
    assert.equal(await estoqueInsumo('Pão de lanche'), 50);
    assert.equal(await estoqueProduto('Coca-Cola 2L'), 0);
  });

  test('quantidade somada de linhas diferentes do mesmo produto conta para o estoque', async () => {
    await prisma.insumo.update({ where: { nome: 'Pão de lanche' }, data: { estoque: 3 } });
    const c = await novoCliente();
    const r = await pedir(c, [item('X-Bacon', 2), item('X-Bacon', 2, { observacao: 'sem tomate' })]);
    assert.equal(r.status, 409);
    assert.equal(await estoqueInsumo('Pão de lanche'), 3);
  });

  test('produto fora do dia, inativo, de outro turno ou não vendido no site = 409 PRODUTO_INDISPONIVEL', async () => {
    const c = await novoCliente();
    await prisma.produto.update({ where: { nome: 'Pizza Bacon' }, data: { disponivelHoje: false } });
    for (const nome of ['Pizza Bacon', 'Marmita P', 'Prato por kg']) {
      const r = await pedir(c, [item(nome)]);
      assert.equal(r.status, 409, nome);
      assert.equal(r.corpo.erro.codigo, 'PRODUTO_INDISPONIVEL', nome);
      assert.match(r.corpo.erro.mensagem, new RegExp(nome), nome);
    }
    const inexistente = await pedir(c, [{ produtoId: 999999, quantidade: 1 }]);
    assert.equal(inexistente.status, 409);
  });

  test('sem telefone = 422 TELEFONE_OBRIGATORIO; endereço de outro cliente = 422; carrinho vazio = 400', async () => {
    const semTelefone = await novoCliente({ telefone: null });
    const r1 = await pedir(semTelefone, [item('X-Bacon')]);
    assert.equal(r1.status, 422);
    assert.equal(r1.corpo.erro.codigo, 'TELEFONE_OBRIGATORIO');

    const [a, b] = [await novoCliente(), await novoCliente()];
    const r2 = await pedir(a, [item('X-Bacon')], { enderecoId: b.endereco.id });
    assert.equal(r2.status, 422);
    assert.equal(r2.corpo.erro.codigo, 'ENDERECO_INVALIDO');

    assert.equal((await pedir(a, [])).status, 400);
    assert.equal((await pedir(a, [item('X-Bacon', 0)])).status, 400);
    assert.equal(await estoqueInsumo('Pão de lanche'), 50);
  });

  test('mesma chaveIdempotencia: reenvio devolve o mesmo pedido (200) sem baixar estoque de novo', async () => {
    const c = await novoCliente();
    const chaveIdempotencia = randomUUID();
    const [r1, r2] = await Promise.all([
      pedir(c, [item('X-Bacon')], { chaveIdempotencia }),
      pedir(c, [item('X-Bacon')], { chaveIdempotencia }),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 201]);
    assert.equal(r1.corpo.pedido.id, r2.corpo.pedido.id);
    const r3 = await pedir(c, [item('X-Bacon')], { chaveIdempotencia });
    assert.equal(r3.status, 200);
    assert.equal(r3.corpo.pedido.id, r1.corpo.pedido.id);
    assert.equal(await estoqueInsumo('Pão de lanche'), 49);

    const outro = await novoCliente();
    const roubo = await pedir(outro, [item('X-Bacon')], { chaveIdempotencia });
    assert.equal(roubo.status, 409);
    assert.equal(roubo.corpo.erro.codigo, 'CHAVE_EM_USO');
  });

  test('numeroDia reinicia no dia seguinte (dia local)', async () => {
    agora = DOMINGO_18H30;
    const c = await novoCliente();
    const r = await pedir(c, [item('X-Bacon')]);
    assert.equal(r.status, 201);
    assert.equal(r.corpo.pedido.numeroDia, 1);
    const banco = await prisma.pedido.findUnique({ where: { id: r.corpo.pedido.id } });
    assert.equal(banco.dataRef.toISOString(), '2026-11-15T00:00:00.000Z');
  });

  // ───────── Preço mudou (SITE) ─────────

  test('total diferente do que o cliente viu = 409 PRECO_ALTERADO com os preços novos, sem baixar estoque', async () => {
    const c = await novoCliente();
    const itens = [item('X-Bacon', 2), item('Coca-Cola 1L')];
    const visto = totalVisto(itens); // 2×1600 + 900 + 500 = 4600
    await prisma.produto.update({ where: { nome: 'X-Bacon' }, data: { precoCentavos: 1800 } });
    try {
      const r = await pedir(c, itens, { totalEsperadoCentavos: visto });
      assert.equal(r.status, 409);
      assert.equal(r.corpo.erro.codigo, 'PRECO_ALTERADO');
      assert.deepEqual(r.corpo.erro.detalhes, {
        subtotalCentavos: 2 * 1800 + 900,
        taxaEntregaCentavos: 500,
        totalCentavos: 2 * 1800 + 900 + 500,
        itens: [
          { produtoId: p['X-Bacon'].id, nome: 'X-Bacon', precoUnitarioCentavos: 1800 },
          { produtoId: p['Coca-Cola 1L'].id, nome: 'Coca-Cola 1L', precoUnitarioCentavos: 900 },
        ],
      });
      assert.equal(await estoqueInsumo('Pão de lanche'), 50, 'nada baixado');
      assert.equal(await estoqueProduto('Coca-Cola 1L'), 50);
      assert.equal(await prisma.pedido.count({ where: { clienteId: c.cliente.id } }), 0);

      // O cliente confirma de novo com o total novo: passa.
      const ok = await pedir(c, itens, { totalEsperadoCentavos: r.corpo.erro.detalhes.totalCentavos });
      assert.equal(ok.status, 201);
      assert.equal(ok.corpo.pedido.totalCentavos, 2 * 1800 + 900 + 500);
    } finally {
      await prisma.produto.update({ where: { nome: 'X-Bacon' }, data: { precoCentavos: 1600 } });
    }
  });

  test('pedido do site sem o total que o cliente viu = 400', async () => {
    const c = await novoCliente();
    const r = await pedir(c, [item('X-Bacon')], { totalEsperadoCentavos: undefined });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.detalhes[0].campo, 'totalEsperadoCentavos');
  });

  // ───────── Canais da equipe (WHATSAPP, SALAO) ─────────

  test('WHATSAPP e SALAO fora do horário: a equipe lança, com baixa de estoque e sem conferir total', async () => {
    const zap = await criarPedido({
      canal: 'WHATSAPP',
      itens: [{ produtoId: p['X-Bacon'].id, quantidade: 1 }],
      cliente: { nome: 'Seu João', telefone: '43988887777' },
      endereco: { texto: 'Rua A, 10', bairroId: centro.id },
      pagamento: { forma: 'DINHEIRO', trocoParaCentavos: 5000 },
      agora: QUINTA_18H59,
    });
    assert.equal(zap.criado, true);
    assert.equal(zap.pedido.canal, 'WHATSAPP');
    assert.equal(zap.pedido.status, 'CONFIRMADO');
    assert.equal(zap.pedido.totalCentavos, 2100);

    // Salão: depois do fim do turno, com produto fora do dia e de outro turno (Almoço).
    await prisma.produto.update({ where: { nome: 'Coca-Cola 2L' }, data: { disponivelHoje: false } });
    await prisma.produto.update({ where: { nome: 'Prato por kg' }, data: { precoCentavos: 5990 } }); // R$ 59,90/kg
    const salao = await criarPedido({
      canal: 'SALAO',
      itens: [
        { produtoId: p['Coca-Cola 2L'].id, quantidade: 1 },
        { produtoId: p['Prato por kg'].id, quantidade: 1, pesoGramas: 455 },
      ],
      mesaRotulo: '4',
      agora: local('2026-11-14T23:40'), // sábado, Lanches fecha 23:00
    });
    assert.equal(salao.pedido.status, 'ABERTO');
    assert.equal(salao.pedido.nomeCliente, 'Mesa 4');
    const kg = salao.pedido.itens.find((i) => i.nome === 'Prato por kg');
    assert.equal(kg.pesoGramas, 455);
    assert.equal(kg.totalCentavos, 2725, '59,90 × 0,455 kg = 27,2545 → R$ 27,25');
    assert.equal(salao.pedido.totalCentavos, 1500 + 2725);

    assert.equal(await estoqueInsumo('Pão de lanche'), 49);
    assert.equal(await estoqueProduto('Coca-Cola 2L'), 49);
  });

  test('WHATSAPP e SALAO: produto inativo ou sem saldo continua bloqueado (409)', async () => {
    const lancar = (canal, nome) =>
      criarPedido({
        canal,
        itens: [{ produtoId: p[nome].id, quantidade: 1 }],
        cliente: { nome: 'Balcão' },
        pagamento: { forma: 'PIX' },
        agora: QUINTA_18H59,
      });

    await prisma.produto.update({ where: { nome: 'Salame' }, data: { ativo: false } });
    for (const canal of ['WHATSAPP', 'SALAO']) {
      await assert.rejects(lancar(canal, 'Salame'), { status: 409, codigo: 'PRODUTO_INDISPONIVEL' }, canal);
    }

    await prisma.insumo.update({ where: { nome: 'Pão de lanche' }, data: { estoque: 0 } });
    for (const canal of ['WHATSAPP', 'SALAO']) {
      await assert.rejects(lancar(canal, 'X-Tudo'), { status: 409, codigo: 'ESTOQUE_INSUFICIENTE' }, canal);
    }
    assert.equal(await estoqueInsumo('Pão de lanche'), 0);
  });

  test('o banco recusa estoque negativo (CHECK), mesmo fora do service', async () => {
    await assert.rejects(prisma.insumo.update({ where: { nome: 'Pão de lanche' }, data: { estoque: -1 } }));
    await assert.rejects(prisma.produto.update({ where: { nome: 'Coca-Cola 1L' }, data: { estoque: -1 } }));
  });

  test('Socket.IO: a sala da equipe recebe pedido:novo e impressao:nova; token de cliente é recusado', async () => {
    const socket = conectarSocket(base, { auth: { token: tokenDono }, transports: ['websocket'], forceNew: true });
    try {
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const novo = new Promise((resolve) => socket.once('pedido:novo', resolve));
      const impressao = new Promise((resolve) => socket.once('impressao:nova', resolve));

      const c = await novoCliente();
      const r = await pedir(c, [item('X-Bacon')]);
      assert.equal(r.status, 201);
      const [evPedido, evImpressao] = await Promise.all([novo, impressao]);
      assert.equal(evPedido.id, r.corpo.pedido.id);
      assert.equal(evPedido.numeroDia, r.corpo.pedido.numeroDia);
      assert.equal(evPedido.itens[0].nome, 'X-Bacon');
      assert.deepEqual(
        { pedidoId: evImpressao.pedidoId, tipo: evImpressao.tipo, status: evImpressao.status },
        { pedidoId: r.corpo.pedido.id, tipo: 'PEDIDO', status: 'PENDENTE' },
      );
    } finally {
      socket.close();
    }

    const c = await novoCliente();
    for (const token of [c.token, 'lixo', undefined]) {
      const intruso = conectarSocket(base, { auth: { token }, transports: ['websocket'], forceNew: true });
      try {
        const erro = await new Promise((resolve, reject) => {
          intruso.once('connect', () => reject(new Error('conectou sem ser da equipe')));
          intruso.once('connect_error', resolve);
        });
        assert.equal(erro.message, 'NAO_AUTENTICADO');
      } finally {
        intruso.close();
      }
    }
  });

  test('GET /cliente/pedidos/ultimo: último pedido do cliente; null sem pedidos', async () => {
    const c = await novoCliente();
    assert.deepEqual((await api('GET', '/cliente/pedidos/ultimo', { token: c.token })).corpo, { pedido: null });

    await pedir(c, [item('X-Bacon')]);
    const segundo = await pedir(c, [item('X-Salada', 2, { observacao: 'sem tomate' }), item('Suco 300ml')]);
    const r = await api('GET', '/cliente/pedidos/ultimo', { token: c.token });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.pedido.id, segundo.corpo.pedido.id);
    assert.deepEqual(
      r.corpo.pedido.itens.map((i) => [i.produtoId, i.nome, i.quantidade, i.observacao]),
      [
        [p['X-Salada'].id, 'X-Salada', 2, 'sem tomate'],
        [p['Suco 300ml'].id, 'Suco 300ml', 1, null],
      ],
    );
    assert.equal((await api('GET', '/cliente/pedidos/ultimo')).status, 401);
  });
});
