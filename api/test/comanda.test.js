import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as conectarSocket } from 'socket.io-client';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SEXTA_12H = local('2026-11-13T12:00');
const QUINTA_13H = local('2026-11-12T13:00');

describe('comandas do salão: abrir, lançar aos poucos, remover, fechar', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = SEXTA_12H;
  let token;
  const p = {};
  const insumo = {};

  async function api(metodo, rota, { corpo, tk = token } = {}) {
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

  async function abrir(nomeCliente = 'Maria', extra = {}) {
    const r = await api('POST', '/equipe/comandas', { corpo: { nomeCliente, ...extra } });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    return r.corpo.comanda;
  }

  const lancar = (id, corpo) => api('POST', `/equipe/comandas/${id}/itens`, { corpo });
  const remover = (id, itemId) => api('DELETE', `/equipe/comandas/${id}/itens/${itemId}`);
  const fechar = (id, corpo) => api('POST', `/equipe/comandas/${id}/fechar`, { corpo });

  const estoqueProduto = async (nome) => (await prisma.produto.findUnique({ where: { nome } })).estoque;
  const estoqueInsumo = async (nome) => (await prisma.insumo.findUnique({ where: { nome } })).estoque;
  const trabalhosDo = (pedidoId) => prisma.trabalhoImpressao.findMany({ where: { pedidoId } });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const { criarTempoReal } = await import('../src/lib/tempoReal.js');
    const { criarAtendente } = await import('../src/services/usuario.service.js');

    // O seed cria o "Prato por kg" sem preço e inativo; o dono define o preço.
    await prisma.produto.update({ where: { nome: 'Prato por kg' }, data: { precoCentavos: 5990, ativo: true } });
    for (const prod of await prisma.produto.findMany()) p[prod.nome] = prod;
    for (const i of await prisma.insumo.findMany()) insumo[i.nome] = i;
    const bia = await criarAtendente({ nome: 'Bia', email: 'bia@teste.com', senha: 'senha-da-bia' });
    // Fechar comanda exige caixa aberto (as regras do caixa estão em caixa.test.js).
    await prisma.caixa.create({ data: { abertoPorId: bia.id, valorInicialCentavos: 0 } });

    servidor = http.createServer(criarApp({ log: false, relogio: () => agora }));
    criarTempoReal(servidor);
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    token = (await api('POST', '/auth/login', { corpo: { email: 'bia@teste.com', senha: 'senha-da-bia' }, tk: null }))
      .corpo.accessToken;
  });

  beforeEach(async () => {
    agora = SEXTA_12H;
    await prisma.produto.updateMany({ where: { nome: { not: 'Prato por kg' } }, data: { ativo: true } });
    await prisma.produto.updateMany({ where: { controlaEstoque: true }, data: { estoque: 50 } });
    await prisma.insumo.updateMany({ data: { estoque: 50 } });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  // ───────── Abrir ─────────

  test('POST /equipe/comandas: cria pedido SALAO ABERTO, sem itens, total 0 e sem impressão', async () => {
    const c = await abrir('  João  ', { mesaRotulo: '4' });
    assert.equal(c.canal, 'SALAO');
    assert.equal(c.status, 'ABERTO');
    assert.equal(c.nomeCliente, 'João');
    assert.equal(c.mesaRotulo, '4');
    assert.equal(c.totalCentavos, 0);
    assert.deepEqual(c.itens, []);
    assert.ok(c.numeroDia >= 1);
    assert.equal(c.formaPagamento, null);
    assert.deepEqual(await trabalhosDo(c.id), [], 'comanda não imprime ao abrir');
    const banco = await prisma.pedido.findUnique({ where: { id: c.id } });
    assert.ok(banco.criadoPorId, 'grava quem abriu');
  });

  test('POST /equipe/comandas: nome obrigatório = 400; mesa vazia vira null', async () => {
    const r = await api('POST', '/equipe/comandas', { corpo: { nomeCliente: '   ' } });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'VALIDACAO');
    const c = await abrir('Ana', { mesaRotulo: '' });
    assert.equal(c.mesaRotulo, null);
  });

  // ───────── Lançar ─────────

  test('prato por kg: 487 g a R$ 59,90/kg = 2917 centavos', async () => {
    const c = await abrir();
    const r = await lancar(c.id, { produtoId: p['Prato por kg'].id, pesoGramas: 487 });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const [item] = r.corpo.comanda.itens;
    assert.equal(item.pesoGramas, 487);
    assert.equal(item.precoUnitarioCentavos, 5990);
    assert.equal(item.quantidade, 1);
    assert.equal(item.totalCentavos, 2917); // round(487 × 5990 / 1000) = round(2917,13)
    assert.equal(r.corpo.comanda.totalCentavos, 2917);
    assert.equal(r.corpo.comanda.status, 'ABERTO');
    const movs = await prisma.movimentacaoEstoque.count({ where: { itemPedidoId: item.id } });
    assert.equal(movs, 0, 'por kg não controla estoque');
  });

  test('prato por kg: sem peso = 400 PESO_OBRIGATORIO; 0 g e acima de 5 kg = 400; peso em produto por unidade = 400', async () => {
    const c = await abrir();
    const semPeso = await lancar(c.id, { produtoId: p['Prato por kg'].id });
    assert.equal(semPeso.status, 400);
    assert.equal(semPeso.corpo.erro.codigo, 'PESO_OBRIGATORIO');
    for (const pesoGramas of [0, 5001, 12.5]) {
      assert.equal((await lancar(c.id, { produtoId: p['Prato por kg'].id, pesoGramas })).status, 400, `peso ${pesoGramas}`);
    }
    const unidade = await lancar(c.id, { produtoId: p['Coca-Cola 1L'].id, pesoGramas: 300 });
    assert.equal(unidade.status, 400);
    const atual = await api('GET', `/equipe/comandas/${c.id}`);
    assert.deepEqual(atual.corpo.comanda.itens, []);
    assert.equal(atual.corpo.comanda.totalCentavos, 0);
  });

  test('lançar baixa o estoque NA HORA (produto e insumo), grava VENDA e soma no total', async () => {
    const c = await abrir();
    const coca = await lancar(c.id, { produtoId: p['Coca-Cola 1L'].id, quantidade: 2, precoCentavos: 1 });
    assert.equal(coca.status, 201);
    assert.equal(await estoqueProduto('Coca-Cola 1L'), 48, 'baixou no lançamento, comanda ainda aberta');
    assert.equal(coca.corpo.comanda.itens[0].precoUnitarioCentavos, p['Coca-Cola 1L'].precoCentavos, 'preço só do banco');

    const xb = await lancar(c.id, { produtoId: p['X-Bacon'].id, observacao: ' sem cebola ' });
    assert.equal(xb.status, 201);
    assert.equal(await estoqueInsumo('Pão de lanche'), 49);
    const comanda = xb.corpo.comanda;
    assert.equal(comanda.itens.length, 2);
    assert.equal(comanda.itens[1].observacao, 'sem cebola');
    assert.equal(comanda.totalCentavos, 2 * p['Coca-Cola 1L'].precoCentavos + p['X-Bacon'].precoCentavos);
    assert.equal(comanda.subtotalCentavos, comanda.totalCentavos);

    const vendas = await prisma.movimentacaoEstoque.findMany({
      where: { tipo: 'VENDA', itemPedido: { pedidoId: c.id } },
      orderBy: { id: 'asc' },
    });
    assert.deepEqual(
      vendas.map((v) => [v.produtoId, v.insumoId, v.quantidade]),
      [
        [p['Coca-Cola 1L'].id, null, -2],
        [null, insumo['Pão de lanche'].id, -1],
      ],
    );
    assert.ok(vendas.every((v) => v.usuarioId), 'grava quem lançou');
    assert.deepEqual(await trabalhosDo(c.id), [], 'lançar item no salão não imprime');
  });

  test('sem saldo = 409 ESTOQUE_INSUFICIENTE e a comanda não muda', async () => {
    const c = await abrir();
    await lancar(c.id, { produtoId: p['Coca-Cola 1L'].id });
    await prisma.produto.update({ where: { nome: 'Coca-Cola 1L' }, data: { estoque: 1 } });
    const r = await lancar(c.id, { produtoId: p['Coca-Cola 1L'].id, quantidade: 2 });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'ESTOQUE_INSUFICIENTE');
    assert.equal(await estoqueProduto('Coca-Cola 1L'), 1);
    const atual = (await api('GET', `/equipe/comandas/${c.id}`)).corpo.comanda;
    assert.equal(atual.itens.length, 1);
    assert.equal(atual.totalCentavos, p['Coca-Cola 1L'].precoCentavos);
  });

  test('produto inativo = 409 PRODUTO_INDISPONIVEL; "fora de hoje" e fora do turno são aceitos no salão', async () => {
    const c = await abrir();
    await prisma.produto.update({ where: { nome: 'X-Salada' }, data: { ativo: false } });
    const r = await lancar(c.id, { produtoId: p['X-Salada'].id });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'PRODUTO_INDISPONIVEL');
    await prisma.produto.update({ where: { nome: 'X-Burguer' }, data: { disponivelHoje: false } });
    assert.equal((await lancar(c.id, { produtoId: p['X-Burguer'].id })).status, 201, 'sexta 12h: X-Burguer é do turno Lanches');
    await prisma.produto.update({ where: { nome: 'X-Burguer' }, data: { disponivelHoje: true } });
    assert.equal((await lancar(c.id, { produtoId: 999999 })).status, 409);
  });

  // ───────── Remover ─────────

  test('remover item devolve o estoque, grava ESTORNO, marca canceladoEm e recalcula o total', async () => {
    const c = await abrir();
    await lancar(c.id, { produtoId: p['Coca-Cola 1L'].id, quantidade: 3 });
    const r1 = await lancar(c.id, { produtoId: p['X-Bacon'].id, quantidade: 2 });
    assert.equal(await estoqueProduto('Coca-Cola 1L'), 47);
    assert.equal(await estoqueInsumo('Pão de lanche'), 48);
    const [itemCoca, itemXb] = r1.corpo.comanda.itens;

    const r = await remover(c.id, itemXb.id);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(await estoqueInsumo('Pão de lanche'), 50, 'pão voltou');
    assert.equal(await estoqueProduto('Coca-Cola 1L'), 47, 'o outro item não muda');
    assert.deepEqual(r.corpo.comanda.itens.map((i) => i.id), [itemCoca.id]);
    assert.equal(r.corpo.comanda.totalCentavos, 3 * p['Coca-Cola 1L'].precoCentavos);

    const banco = await prisma.itemPedido.findUnique({ where: { id: itemXb.id } });
    assert.ok(banco.canceladoEm, 'item fica no banco, marcado');
    const estornos = await prisma.movimentacaoEstoque.findMany({ where: { tipo: 'ESTORNO', itemPedidoId: itemXb.id } });
    assert.deepEqual(estornos.map((e) => [e.insumoId, e.quantidade]), [[insumo['Pão de lanche'].id, 2]]);

    const deNovo = await remover(c.id, itemXb.id);
    assert.equal(deNovo.status, 409);
    assert.equal(deNovo.corpo.erro.codigo, 'ITEM_JA_REMOVIDO');
    assert.equal(await estoqueInsumo('Pão de lanche'), 50, 'não devolve duas vezes');

    const outra = await abrir('Outra');
    assert.equal((await remover(outra.id, itemCoca.id)).status, 404, 'item de outra comanda');
  });

  test('4 toques = 4 ItemPedido no banco; remover um devolve só uma unidade (a tela agrupa como "4×")', async () => {
    const c = await abrir();
    let r;
    for (let i = 0; i < 4; i += 1) r = await lancar(c.id, { produtoId: p['Refrigerante Lata'].id });
    const itens = r.corpo.comanda.itens;
    assert.equal(itens.length, 4, 'um item por toque');
    assert.ok(itens.every((i) => i.quantidade === 1));
    assert.equal(await estoqueProduto('Refrigerante Lata'), 46);

    const r2 = await remover(c.id, itens.at(-1).id);
    assert.equal(r2.corpo.comanda.itens.length, 3);
    assert.equal(r2.corpo.comanda.totalCentavos, 3 * p['Refrigerante Lata'].precoCentavos);
    assert.equal(await estoqueProduto('Refrigerante Lata'), 47);
  });

  test('remover devolve o que FOI baixado, mesmo que a receita mude depois', async () => {
    const c = await abrir();
    const r = await lancar(c.id, { produtoId: p['X-Salada'].id });
    const chave = { produtoId_insumoId: { produtoId: p['X-Salada'].id, insumoId: insumo['Pão de lanche'].id } };
    await prisma.produtoInsumo.update({ where: chave, data: { quantidade: 3 } });
    try {
      await remover(c.id, r.corpo.comanda.itens[0].id);
      assert.equal(await estoqueInsumo('Pão de lanche'), 50);
    } finally {
      await prisma.produtoInsumo.update({ where: chave, data: { quantidade: 1 } });
    }
  });

  // ───────── Fechar ─────────

  test('fechar sem forma de pagamento = 400 e a comanda continua aberta', async () => {
    const c = await abrir();
    await lancar(c.id, { produtoId: p['Prato por kg'].id, pesoGramas: 500 });
    for (const corpo of [{}, { formaPagamento: '' }, { formaPagamento: 'FIADO' }]) {
      const r = await fechar(c.id, corpo);
      assert.equal(r.status, 400, JSON.stringify(corpo));
      assert.equal(r.corpo.erro.codigo, 'VALIDACAO');
    }
    assert.equal((await prisma.pedido.findUnique({ where: { id: c.id } })).status, 'ABERTO');
  });

  test('fechar: FINALIZADO com a forma, sem mexer no estoque e sem imprimir se não pedir', async () => {
    const c = await abrir();
    await lancar(c.id, { produtoId: p['Coca-Cola 1L'].id });
    const r = await fechar(c.id, { formaPagamento: 'PIX' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.comanda.status, 'FINALIZADO');
    assert.equal(r.corpo.comanda.formaPagamento, 'PIX');
    assert.equal(r.corpo.trabalho, null);
    assert.equal(await estoqueProduto('Coca-Cola 1L'), 49, 'fechar não baixa de novo');
    const banco = await prisma.pedido.findUnique({ where: { id: c.id } });
    assert.deepEqual(banco.finalizadoEm, SEXTA_12H);
    assert.deepEqual(await trabalhosDo(c.id), []);
  });

  test('fechar com "imprimir conta" cria TrabalhoImpressao CONTA pendente', async () => {
    const c = await abrir('Carlos', { mesaRotulo: '7' });
    await lancar(c.id, { produtoId: p['Prato por kg'].id, pesoGramas: 487 });
    const r = await fechar(c.id, { formaPagamento: 'DEBITO', imprimirConta: true });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.trabalho.tipo, 'CONTA');
    assert.equal(r.corpo.trabalho.status, 'PENDENTE');
    const pend = await api('GET', '/equipe/impressoes/pendentes');
    const t = pend.corpo.trabalhos.find((x) => x.id === r.corpo.trabalho.id);
    assert.equal(t.pedido.totalCentavos, 2917);
    assert.equal(t.pedido.itens[0].pesoGramas, 487);
  });

  test('lançar item em comanda FINALIZADA = 409; remover e fechar de novo também', async () => {
    const c = await abrir();
    const r0 = await lancar(c.id, { produtoId: p['Coca-Cola 1L'].id });
    await fechar(c.id, { formaPagamento: 'DINHEIRO' });

    const r = await lancar(c.id, { produtoId: p['Coca-Cola 1L'].id });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'PEDIDO_ENCERRADO');
    assert.equal(await estoqueProduto('Coca-Cola 1L'), 49, 'nada foi baixado');
    assert.equal((await remover(c.id, r0.corpo.comanda.itens[0].id)).status, 409);
    assert.equal((await fechar(c.id, { formaPagamento: 'PIX' })).status, 409);
    assert.equal((await prisma.pedido.findUnique({ where: { id: c.id } })).formaPagamento, 'DINHEIRO');
  });

  test('comanda vazia: fechar = 409 COMANDA_VAZIA; cancelar não imprime nada', async () => {
    const c = await abrir('Engano');
    const r = await fechar(c.id, { formaPagamento: 'PIX' });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'COMANDA_VAZIA');
    const cancel = await api('PATCH', `/equipe/pedidos/${c.id}/cancelar`);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.corpo.pedido.status, 'CANCELADO');
    assert.deepEqual(await trabalhosDo(c.id), [], 'salão não imprime cancelamento');
    assert.equal((await lancar(c.id, { produtoId: p['Coca-Cola 1L'].id })).status, 409);
  });

  test('lançar e fechar ao mesmo tempo: nunca fica item numa comanda fechada nem estoque perdido', async () => {
    for (let rodada = 0; rodada < 8; rodada += 1) {
      const c = await abrir(`Corrida ${rodada}`);
      await lancar(c.id, { produtoId: p['Coca-Cola 1L'].id });
      const antes = await estoqueProduto('Coca-Cola 1L');
      const [l, f] = await Promise.all([
        lancar(c.id, { produtoId: p['Coca-Cola 1L'].id }),
        fechar(c.id, { formaPagamento: 'PIX' }),
      ]);
      assert.equal(f.status, 200);
      const banco = await prisma.pedido.findUnique({ where: { id: c.id }, include: { itens: true } });
      const somaItens = banco.itens.filter((i) => !i.canceladoEm).reduce((s, i) => s + i.totalCentavos, 0);
      assert.equal(banco.totalCentavos, somaItens, 'total bate com os itens');
      if (l.status === 201) {
        assert.equal(banco.itens.length, 2);
        assert.equal(f.corpo.comanda.itens.length, 2, 'fechou depois do lançamento, com o item');
        assert.equal(await estoqueProduto('Coca-Cola 1L'), antes - 1);
      } else {
        assert.equal(l.status, 409);
        assert.equal(banco.itens.length, 1);
        assert.equal(await estoqueProduto('Coca-Cola 1L'), antes, 'recusado não baixa');
      }
    }
  });

  // ───────── Listar / grade ─────────

  test('GET /equipe/comandas: só comandas abertas do salão, de qualquer dia, da mais antiga para a mais nova', async () => {
    agora = QUINTA_13H;
    const ontem = await abrir('Ficou de ontem');
    agora = SEXTA_12H;
    const hoje = await abrir('De hoje');
    const fechada = await abrir('Fechada');
    await lancar(fechada.id, { produtoId: p['Coca-Cola 1L'].id });
    await fechar(fechada.id, { formaPagamento: 'PIX' });
    const delivery = await prisma.pedido.create({
      data: { numeroDia: 900, dataRef: new Date('2026-11-13T00:00:00Z'), canal: 'WHATSAPP', status: 'CONFIRMADO', nomeCliente: 'Zé' },
    });

    const r = await api('GET', '/equipe/comandas');
    assert.equal(r.status, 200);
    const ids = r.corpo.comandas.map((c) => c.id);
    assert.ok(ids.indexOf(ontem.id) >= 0 && ids.indexOf(ontem.id) < ids.indexOf(hoje.id));
    assert.ok(!ids.includes(fechada.id));
    assert.ok(!ids.includes(delivery.id));
    assert.ok(r.corpo.comandas.every((c) => c.canal === 'SALAO' && c.status === 'ABERTO'));
    assert.equal((await api('GET', `/equipe/comandas/${delivery.id}`)).status, 404, 'pedido de delivery não é comanda');
    assert.equal((await lancar(delivery.id, { produtoId: p['Coca-Cola 1L'].id })).status, 404);
  });

  test('rotas de comanda exigem login da equipe', async () => {
    assert.equal((await api('GET', '/equipe/comandas', { tk: null })).status, 401);
    assert.equal((await api('POST', '/equipe/comandas', { corpo: { nomeCliente: 'X' }, tk: null })).status, 401);
  });

  test('GET /equipe/cardapio: "porKg" traz o Prato por kg do Almoço com o preço do quilo', async () => {
    const r = await api('GET', '/equipe/cardapio');
    const almoco = r.corpo.turnos.find((t) => t.nome === 'Almoço');
    const ra = await api('GET', `/equipe/cardapio?turnoId=${almoco.id}`);
    assert.deepEqual(ra.corpo.porKg, [{ id: p['Prato por kg'].id, nome: 'Prato por kg', precoCentavos: 5990 }]);
    const lanches = r.corpo.turnos.find((t) => t.nome === 'Lanches');
    assert.deepEqual((await api('GET', `/equipe/cardapio?turnoId=${lanches.id}`)).corpo.porKg, []);
  });

  test('eventos: abrir emite pedido:novo; lançar emite pedido:atualizado para a equipe', async () => {
    const socket = conectarSocket(new URL(base).origin, { path: '/api/socket.io', auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    try {
      const novo = new Promise((resolve) => socket.once('pedido:novo', resolve));
      const c = await abrir('Evento');
      assert.equal((await novo).id, c.id);
      const atualizado = new Promise((resolve) => socket.once('pedido:atualizado', resolve));
      await lancar(c.id, { produtoId: p['Prato por kg'].id, pesoGramas: 300 });
      const ev = await atualizado;
      assert.equal(ev.id, c.id);
      assert.equal(ev.totalCentavos, Math.round((300 * 5990) / 1000));
    } finally {
      socket.close();
    }
  });
});
