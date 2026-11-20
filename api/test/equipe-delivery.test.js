import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as conectarSocket } from 'socket.io-client';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SABADO_20H = local('2026-11-14T20:00'); // turno Lanches aberto
const QUINTA_10H = local('2026-11-12T10:00'); // fechado (próxima abertura: Lanches 19:00)

describe('delivery do WhatsApp pelo PDV: clientes, lançamento, cancelamento e grade', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = SABADO_20H;
  let tokenAna;
  let ana;
  let centro;
  let vila;
  let fechado;
  const p = {};
  const insumo = {};

  async function api(metodo, rota, { corpo, token = tokenAna } = {}) {
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

  const endereco = (extra = {}) => ({ rua: 'Rua das Flores', numero: '120', bairroId: centro.id, ...extra });

  let seq = 0;
  async function novoCliente(extra = {}) {
    seq += 1;
    const r = await api('POST', '/equipe/clientes', {
      corpo: { nome: `Cliente ${seq}`, telefone: `4399999${String(seq).padStart(4, '0')}`, endereco: endereco(), ...extra },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    return r.corpo.cliente;
  }

  const item = (nome, quantidade = 1, extra = {}) => ({ produtoId: p[nome].id, quantidade, ...extra });

  function lancar(cliente, itens, extra = {}) {
    return api('POST', '/equipe/pedidos', {
      corpo: { clienteId: cliente.id, enderecoId: cliente.enderecos[0].id, itens, formaPagamento: 'PIX', ...extra },
    });
  }

  const estoqueProduto = async (nome) => (await prisma.produto.findUnique({ where: { lojaId_nome: { lojaId: 1, nome } } })).estoque;
  const estoqueInsumo = async (nome) => (await prisma.insumo.findUnique({ where: { lojaId_nome: { lojaId: 1, nome } } })).estoque;

  async function conectar() {
    const login = await api('POST', '/auth/login', { corpo: { email: 'ana@teste.com', senha: 'senha-da-ana' }, token: null });
    const socket = conectarSocket(new URL(base).origin, { path: '/api/socket.io',
      auth: { token: login.corpo.accessToken },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const { criarTempoReal } = await import('../src/lib/tempoReal.js');
    const { criarAtendente } = await import('../src/services/usuario.service.js');

    for (const prod of await prisma.produto.findMany()) p[prod.nome] = prod;
    for (const i of await prisma.insumo.findMany()) insumo[i.nome] = i;
    centro = await prisma.bairro.create({ data: { lojaId: 1, nome: 'Centro', taxaCentavos: 500 } });
    vila = await prisma.bairro.create({ data: { lojaId: 1, nome: 'Vila Nova', taxaCentavos: 700 } });
    fechado = await prisma.bairro.create({ data: { lojaId: 1, nome: 'Longe', taxaCentavos: 2000, ativo: false } });
    ana = await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });
    // Finalizar exige caixa aberto (as regras do caixa estão em caixa.test.js).
    await prisma.caixa.create({ data: { lojaId: 1, abertoPorId: ana.id, valorInicialCentavos: 0 } });

    servidor = http.createServer(criarApp({ log: false, relogio: () => agora }));
    criarTempoReal(servidor);
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tokenAna = (await api('POST', '/auth/login', { corpo: { email: 'ana@teste.com', senha: 'senha-da-ana' }, token: null }))
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

  // ───────── Clientes ─────────

  test('POST /equipe/clientes: cria cliente com endereço principal; telefone normalizado', async () => {
    const r = await api('POST', '/equipe/clientes', {
      corpo: { nome: ' Seu João ', telefone: '(43) 98888-7777', endereco: endereco({ complemento: 'Casa 2', referencia: '' }) },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const c = r.corpo.cliente;
    assert.equal(c.nome, 'Seu João');
    assert.equal(c.telefone, '43988887777');
    assert.equal(c.enderecos.length, 1);
    assert.equal(c.enderecos[0].principal, true);
    assert.equal(c.enderecos[0].complemento, 'Casa 2');
    assert.equal(c.enderecos[0].referencia, null);
    assert.deepEqual(c.enderecos[0].bairro, { id: centro.id, nome: 'Centro', taxaCentavos: 500, ativo: true });
    const banco = await prisma.cliente.findUnique({ where: { id: c.id } });
    assert.equal(banco.googleId, null);
  });

  test('POST /equipe/clientes: telefone já cadastrado = 409 com o cliente existente', async () => {
    const r = await api('POST', '/equipe/clientes', {
      corpo: { nome: 'Outro Nome', telefone: '43988887777', endereco: endereco() },
    });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'CLIENTE_JA_EXISTE');
    assert.equal(r.corpo.erro.detalhes.cliente.nome, 'Seu João');
  });

  test('POST /equipe/clientes: telefone inválido = 400; bairro inativo = 422 sem criar o cliente', async () => {
    const t = await api('POST', '/equipe/clientes', { corpo: { nome: 'X', telefone: '1234', endereco: endereco() } });
    assert.equal(t.status, 400);
    const b = await api('POST', '/equipe/clientes', {
      corpo: { nome: 'Sem Bairro', telefone: '43977776666', endereco: endereco({ bairroId: fechado.id }) },
    });
    assert.equal(b.status, 422);
    assert.equal(b.corpo.erro.codigo, 'BAIRRO_INVALIDO');
    assert.equal(await prisma.cliente.count({ where: { telefone: '43977776666' } }), 0);
  });

  test('GET /equipe/clientes?busca=: por nome (sem diferenciar maiúsculas) ou trecho do telefone', async () => {
    const porNome = await api('GET', `/equipe/clientes?busca=${encodeURIComponent('joão')}`);
    assert.equal(porNome.status, 200);
    assert.deepEqual(porNome.corpo.clientes.map((c) => c.nome), ['Seu João']);
    assert.equal(porNome.corpo.clientes[0].enderecos.length, 1);

    const porTelefone = await api('GET', `/equipe/clientes?busca=${encodeURIComponent('8888-77')}`);
    assert.deepEqual(porTelefone.corpo.clientes.map((c) => c.nome), ['Seu João']);

    assert.equal((await api('GET', '/equipe/clientes?busca=a')).status, 400);
    assert.equal((await api('GET', '/equipe/clientes?busca=zzzz')).corpo.clientes.length, 0);
    assert.equal((await api('GET', '/equipe/clientes?busca=joao', { token: null })).status, 401);
  });

  test('POST /equipe/clientes/:id/enderecos: endereço novo vira o principal', async () => {
    const c = await novoCliente();
    const r = await api('POST', `/equipe/clientes/${c.id}/enderecos`, {
      corpo: endereco({ rua: 'Av. Brasil', numero: '9', bairroId: vila.id }),
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.cliente.enderecos.length, 2);
    assert.equal(r.corpo.cliente.enderecos[0].rua, 'Av. Brasil');
    assert.equal(r.corpo.cliente.enderecos[0].principal, true);
    assert.equal(r.corpo.cliente.enderecos.filter((e) => e.principal).length, 1);
    assert.equal((await api('POST', '/equipe/clientes/999999/enderecos', { corpo: endereco() })).status, 404);
  });

  // ───────── Lançamento ─────────

  test('POST /equipe/pedidos: WHATSAPP pelo criarPedido (preço do banco, baixa, impressão, criado pela atendente)', async () => {
    const c = await novoCliente();
    const socket = await conectar();
    try {
      const novo = new Promise((resolve) => socket.once('pedido:novo', resolve));
      const r = await lancar(c, [item('X-Bacon', 2, { observacao: ' sem cebola ', precoCentavos: 1 }), item('Coca-Cola 1L')], {
        formaPagamento: 'DINHEIRO',
        trocoParaCentavos: 10000,
      });
      assert.equal(r.status, 201, JSON.stringify(r.corpo));
      const ped = r.corpo.pedido;
      assert.equal(ped.canal, 'WHATSAPP');
      assert.equal(ped.status, 'CONFIRMADO');
      assert.equal(ped.subtotalCentavos, 2 * p['X-Bacon'].precoCentavos + p['Coca-Cola 1L'].precoCentavos);
      assert.equal(ped.taxaEntregaCentavos, 500);
      assert.equal(ped.nomeCliente, c.nome);
      assert.equal(ped.telefone, c.telefone);
      assert.equal(ped.enderecoTexto, 'Rua das Flores, 120');
      assert.equal(ped.bairroNome, 'Centro');
      assert.equal(ped.itens[0].observacao, 'sem cebola');
      assert.equal((await novo).id, ped.id);

      const banco = await prisma.pedido.findUnique({ where: { id: ped.id }, include: { impressoes: true } });
      assert.equal(banco.criadoPorId, ana.id);
      assert.deepEqual(banco.impressoes.map((t) => [t.tipo, t.status]), [['PEDIDO', 'PENDENTE']]);
      assert.equal(await estoqueInsumo('Pão de lanche'), 48);
      assert.equal(await estoqueProduto('Coca-Cola 1L'), 49);
    } finally {
      socket.close();
    }
  });

  test('POST /equipe/pedidos: aceita com a loja fechada (canal da equipe)', async () => {
    agora = QUINTA_10H;
    const c = await novoCliente();
    const r = await lancar(c, [item('X-Burguer')]);
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
  });

  test('POST /equipe/pedidos: endereço de outro cliente = 422; sem forma de pagamento = 400; estoque insuficiente = 409', async () => {
    const a = await novoCliente();
    const b = await novoCliente();
    const outro = await api('POST', '/equipe/pedidos', {
      corpo: { clienteId: a.id, enderecoId: b.enderecos[0].id, itens: [item('X-Burguer')], formaPagamento: 'PIX' },
    });
    assert.equal(outro.status, 422);
    assert.equal(outro.corpo.erro.codigo, 'ENDERECO_INVALIDO');

    const semForma = await lancar(a, [item('X-Burguer')], { formaPagamento: undefined });
    assert.equal(semForma.status, 400);

    await prisma.insumo.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Pão de lanche' } }, data: { estoque: 1 } });
    const sem = await lancar(a, [item('X-Burguer', 2)]);
    assert.equal(sem.status, 409);
    assert.equal(sem.corpo.erro.codigo, 'ESTOQUE_INSUFICIENTE');
    assert.equal(await estoqueInsumo('Pão de lanche'), 1, 'nada baixado');
  });

  test('POST /equipe/pedidos: mesma chave de idempotência devolve o mesmo pedido sem baixar de novo', async () => {
    const c = await novoCliente();
    const chaveIdempotencia = randomUUID();
    const r1 = await lancar(c, [item('X-Burguer')], { chaveIdempotencia });
    const r2 = await lancar(c, [item('X-Burguer')], { chaveIdempotencia });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 200);
    assert.equal(r2.corpo.pedido.id, r1.corpo.pedido.id);
    assert.equal(await estoqueInsumo('Pão de lanche'), 49);
  });

  // ───────── Cancelamento ─────────

  test('cancelar devolve exatamente o que foi baixado (produto e insumos), com ESTORNO e impressão CANCELAMENTO', async () => {
    const c = await novoCliente();
    const antes = {
      pao: await estoqueInsumo('Pão de lanche'),
      paoCachorro: await estoqueInsumo('Pão de cachorro-quente'),
      coca: await estoqueProduto('Coca-Cola 1L'),
    };
    const r = await lancar(c, [
      item('X-Bacon', 2),
      item('X-Bacon', 1, { observacao: 'sem tomate' }),
      item('Cachorro Quente', 2),
      item('Coca-Cola 1L', 3),
    ]);
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const id = r.corpo.pedido.id;
    assert.equal(await estoqueInsumo('Pão de lanche'), antes.pao - 3);
    assert.equal(await estoqueInsumo('Pão de cachorro-quente'), antes.paoCachorro - 2);
    assert.equal(await estoqueProduto('Coca-Cola 1L'), antes.coca - 3);

    const socket = await conectar();
    try {
      const atualizado = new Promise((resolve) => socket.once('pedido:atualizado', resolve));
      const impressao = new Promise((resolve) => socket.once('impressao:nova', resolve));
      const cancel = await api('PATCH', `/equipe/pedidos/${id}/cancelar`);
      assert.equal(cancel.status, 200, JSON.stringify(cancel.corpo));
      assert.equal(cancel.corpo.pedido.status, 'CANCELADO');
      assert.equal(cancel.corpo.pedido.itens.length, 4, 'o pedido cancelado continua com os itens (cupom)');
      assert.equal((await atualizado).status, 'CANCELADO');
      assert.equal((await impressao).tipo, 'CANCELAMENTO');
    } finally {
      socket.close();
    }

    assert.equal(await estoqueInsumo('Pão de lanche'), antes.pao);
    assert.equal(await estoqueInsumo('Pão de cachorro-quente'), antes.paoCachorro);
    assert.equal(await estoqueProduto('Coca-Cola 1L'), antes.coca);

    const movs = await prisma.movimentacaoEstoque.findMany({ where: { itemPedido: { pedidoId: id } } });
    const soma = (tipo) => movs.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.quantidade, 0);
    assert.equal(soma('VENDA'), -(3 + 2 + 3));
    assert.equal(soma('ESTORNO'), 3 + 2 + 3);
    assert.ok(movs.filter((m) => m.tipo === 'ESTORNO').every((m) => m.usuarioId === ana.id));

    const banco = await prisma.pedido.findUnique({ where: { id }, include: { impressoes: { orderBy: { id: 'asc' } } } });
    assert.deepEqual(banco.canceladoEm, SABADO_20H);
    assert.deepEqual(banco.impressoes.map((t) => [t.tipo, t.status]), [
      ['PEDIDO', 'PENDENTE'],
      ['CANCELAMENTO', 'PENDENTE'],
    ]);
  });

  test('cancelar devolve o que foi baixado na venda mesmo se a receita mudou depois', async () => {
    const c = await novoCliente();
    const antes = await estoqueInsumo('Pão de lanche');
    const r = await lancar(c, [item('X-Salada', 2)]);
    await prisma.produtoInsumo.update({
      where: { produtoId_insumoId: { produtoId: p['X-Salada'].id, insumoId: insumo['Pão de lanche'].id } },
      data: { quantidade: 5 },
    });
    try {
      assert.equal((await api('PATCH', `/equipe/pedidos/${r.corpo.pedido.id}/cancelar`)).status, 200);
      assert.equal(await estoqueInsumo('Pão de lanche'), antes);
    } finally {
      await prisma.produtoInsumo.update({
        where: { produtoId_insumoId: { produtoId: p['X-Salada'].id, insumoId: insumo['Pão de lanche'].id } },
        data: { quantidade: 1 },
      });
    }
  });

  test('cancelar duas vezes = 409 e não devolve de novo', async () => {
    const c = await novoCliente();
    const antes = await estoqueInsumo('Pão de lanche');
    const { corpo } = await lancar(c, [item('X-Burguer', 2)]);
    const id = corpo.pedido.id;
    assert.equal((await api('PATCH', `/equipe/pedidos/${id}/cancelar`)).status, 200);
    const de2 = await api('PATCH', `/equipe/pedidos/${id}/cancelar`);
    assert.equal(de2.status, 409);
    assert.equal(de2.corpo.erro.codigo, 'PEDIDO_ENCERRADO');
    assert.match(de2.corpo.erro.mensagem, /cancelado/);
    assert.equal(await estoqueInsumo('Pão de lanche'), antes, 'devolvido uma vez só');
    assert.equal(await prisma.trabalhoImpressao.count({ where: { pedidoId: id, tipo: 'CANCELAMENTO' } }), 1);
  });

  test('cancelar ao mesmo tempo: só um vence e o estoque volta uma vez', async () => {
    const c = await novoCliente();
    const antes = await estoqueInsumo('Pão de lanche');
    const { corpo } = await lancar(c, [item('X-Burguer', 3)]);
    const rs = await Promise.all([1, 2, 3].map(() => api('PATCH', `/equipe/pedidos/${corpo.pedido.id}/cancelar`)));
    assert.deepEqual(rs.map((x) => x.status).sort(), [200, 409, 409]);
    assert.equal(await estoqueInsumo('Pão de lanche'), antes);
  });

  test('cancelar finalizado = 409; finalizar cancelado = 409; inexistente = 404', async () => {
    const c = await novoCliente();
    const a = (await lancar(c, [item('X-Burguer')])).corpo.pedido.id;
    await api('PATCH', `/equipe/pedidos/${a}/finalizar`, { corpo: { formaPagamento: 'PIX' } });
    const r1 = await api('PATCH', `/equipe/pedidos/${a}/cancelar`);
    assert.equal(r1.status, 409);
    assert.match(r1.corpo.erro.mensagem, /finalizado/);

    const b = (await lancar(c, [item('X-Burguer')])).corpo.pedido.id;
    await api('PATCH', `/equipe/pedidos/${b}/cancelar`);
    assert.equal((await api('PATCH', `/equipe/pedidos/${b}/finalizar`, { corpo: { formaPagamento: 'PIX' } })).status, 409);

    assert.equal((await api('PATCH', '/equipe/pedidos/999999/cancelar')).status, 404);
  });

  test('cancelar pedido do site também devolve o estoque', async () => {
    const { criarPedido } = await import('../src/services/pedido.service.js');
    const cliente = await prisma.cliente.create({ data: { googleId: 'g-site', nome: 'Maria', telefone: '43911112222' } });
    const antes = await estoqueProduto('Coca-Cola 1L');
    const { pedido } = await criarPedido({
      lojaId: 1,
      canal: 'SITE',
      itens: [{ produtoId: p['Coca-Cola 1L'].id, quantidade: 2 }],
      cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone },
      endereco: { texto: 'Rua B, 20', bairroId: centro.id },
      pagamento: { forma: 'PIX' },
      totalEsperadoCentavos: 2 * p['Coca-Cola 1L'].precoCentavos + 500,
      agora: SABADO_20H,
    });
    assert.equal(await estoqueProduto('Coca-Cola 1L'), antes - 2);
    assert.equal((await api('PATCH', `/equipe/pedidos/${pedido.id}/cancelar`)).status, 200);
    assert.equal(await estoqueProduto('Coca-Cola 1L'), antes);
  });

  // ───────── Grade (cardápio do PDV) ─────────

  test('GET /equipe/cardapio: item esgotado vem marcado (a grade desabilita), com o saldo', async () => {
    await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Coca-Cola 1L' } }, data: { estoque: 0 } });
    await prisma.insumo.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Pão de cachorro-quente' } }, data: { estoque: 0 } });
    await prisma.insumo.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Pão de lanche' } }, data: { estoque: 4 } });
    await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'X-Egg' } }, data: { disponivelHoje: false } });

    const r = await api('GET', '/equipe/cardapio');
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo.turno, { id: r.corpo.turnoAtivo.id, nome: 'Lanches' });
    const prod = Object.fromEntries(r.corpo.categorias.flatMap((c) => c.produtos).map((x) => [x.nome, x]));

    assert.equal(prod['Coca-Cola 1L'].esgotado, true);
    assert.equal(prod['Coca-Cola 1L'].saldo, 0);
    assert.equal(prod['Cachorro Quente'].esgotado, true, 'insumo zerado esgota o lanche');
    assert.equal(prod['X-Burguer'].esgotado, false);
    assert.equal(prod['X-Burguer'].saldo, 4);
    assert.equal(prod['X-Egg'].disponivelHoje, false, 'fora de hoje vem marcado, mas aparece');
    assert.equal(prod['X-Egg'].esgotado, false);
    assert.equal(prod['X-Burguer'].precoCentavos, p['X-Burguer'].precoCentavos);
  });

  test('GET /equipe/cardapio: loja fechada mostra o turno da próxima abertura; turnoId escolhe; por kg fica de fora', async () => {
    agora = QUINTA_10H;
    const r = await api('GET', '/equipe/cardapio');
    assert.equal(r.corpo.turnoAtivo, null);
    assert.equal(r.corpo.turno.nome, 'Lanches');
    assert.deepEqual(r.corpo.turnos.map((t) => t.nome).sort(), ['Almoço', 'Lanches']);

    const almoco = r.corpo.turnos.find((t) => t.nome === 'Almoço');
    const ra = await api('GET', `/equipe/cardapio?turnoId=${almoco.id}`);
    assert.equal(ra.status, 200);
    assert.equal(ra.corpo.turno.nome, 'Almoço');
    const nomes = ra.corpo.categorias.flatMap((c) => c.produtos).map((x) => x.nome);
    assert.ok(!nomes.includes('Prato por kg'), 'por kg é do salão');
    assert.equal((await api('GET', '/equipe/cardapio?turnoId=999')).status, 404);
  });
});
