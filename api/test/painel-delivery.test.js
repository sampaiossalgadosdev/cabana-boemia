import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as conectarSocket } from 'socket.io-client';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SABADO_20H = local('2026-11-14T20:00'); // dia operacional 2026-11-14 (virada às 4h)

describe('painel de delivery/encomendas do PDV', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = SABADO_20H;
  let token;
  let ana;
  let centro;
  let cliente;
  const p = {};

  async function api(metodo, rota, { corpo, semToken = false } = {}) {
    const headers = {};
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    if (!semToken) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  const item = (nome, quantidade = 1, extra = {}) => ({ produtoId: p[nome].id, quantidade, ...extra });
  const preco = (nome) => p[nome].precoCentavos;

  function lancar(extra = {}) {
    return api('POST', '/equipe/pedidos', {
      corpo: {
        clienteId: cliente.id,
        enderecoId: cliente.enderecos[0].id,
        itens: [item('X-Burguer', 2)],
        formaPagamento: 'PIX',
        ...extra,
      },
    });
  }

  const estoquePao = async () => (await prisma.insumo.findUnique({ where: { lojaId_nome: { lojaId: 1, nome: 'Pão de lanche' } } })).estoque;

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const { criarTempoReal } = await import('../src/lib/tempoReal.js');
    const { criarAtendente } = await import('../src/services/usuario.service.js');

    for (const prod of await prisma.produto.findMany()) p[prod.nome] = prod;
    centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    ana = await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });

    servidor = http.createServer(criarApp({ log: false, relogio: () => agora }));
    criarTempoReal(servidor);
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    token = (await api('POST', '/auth/login', { corpo: { email: 'ana@teste.com', senha: 'senha-da-ana' }, semToken: true }))
      .corpo.accessToken;

    const r = await api('POST', '/equipe/clientes', {
      corpo: { nome: 'Lilian', telefone: '43999990001', endereco: { rua: 'Rua A', numero: '10', bairroId: centro.id } },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    cliente = r.corpo.cliente;
  });

  beforeEach(async () => {
    agora = SABADO_20H;
    await prisma.produto.updateMany({ data: { disponivelHoje: true, ativo: true } });
    await prisma.insumo.updateMany({ data: { estoque: 50 } });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  // ───────── Pago agora (antes de abrir o caixa) ─────────

  test('pago agora sem caixa aberto = 409 CAIXA_FECHADO e nada é baixado', async () => {
    const antes = await estoquePao();
    const r = await lancar({ pagoAgora: true });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'CAIXA_FECHADO');
    assert.equal(await estoquePao(), antes);
    // Pagar na entrega não exige caixa (o site e o WhatsApp aceitam pedido com o caixa fechado).
    assert.equal((await lancar()).status, 201);
  });

  test('abre o caixa para os próximos testes', async () => {
    const r = await api('POST', '/equipe/caixa/abrir', { corpo: { valorInicialCentavos: 0 } });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
  });

  test('pago agora: grava pagoEm e o caixa; finalizar mantém a forma paga', async () => {
    const r = await lancar({ pagoAgora: true, formaPagamento: 'DINHEIRO' });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.ok(r.corpo.pedido.pagoEm);
    const banco = await prisma.pedido.findUnique({ where: { id: r.corpo.pedido.id } });
    assert.ok(banco.caixaId);
    assert.equal(banco.status, 'CONFIRMADO'); // continua no painel até ser entregue

    const f = await api('PATCH', `/equipe/pedidos/${banco.id}/finalizar`, { corpo: { formaPagamento: 'PIX' } });
    assert.equal(f.status, 200, JSON.stringify(f.corpo));
    assert.equal(f.corpo.pedido.formaPagamento, 'DINHEIRO');
    const final = await prisma.pedido.findUnique({ where: { id: banco.id } });
    assert.equal(final.caixaId, banco.caixaId);
    assert.equal(final.status, 'FINALIZADO');
  });

  // ───────── Encomenda ─────────

  test('encomenda para hoje: sem tempo estimado, com horário; listagem traz dia e quem registrou', async () => {
    const r = await lancar({ encomenda: true, agendadoPara: '2026-11-14T22:30:00-03:00' });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const pedido = r.corpo.pedido;
    assert.equal(pedido.encomenda, true);
    assert.equal(new Date(pedido.agendadoPara).toISOString(), local('2026-11-14T22:30').toISOString());
    assert.equal(pedido.tempoEstimadoMin, null);
    assert.equal(pedido.taxaEntregaCentavos, 500);

    const lista = await api('GET', '/equipe/pedidos?dataRef=hoje&canal=SITE,WHATSAPP&status=todos');
    const daLista = lista.corpo.pedidos.find((x) => x.id === pedido.id);
    assert.equal(daLista.dataRef, '2026-11-14');
    assert.equal(daLista.registradoPor, 'Ana');
    assert.equal(daLista.encomenda, true);
    assert.equal(daLista.finalizadoEm, null);
  });

  test('encomenda depois da meia-noite ainda é do expediente de hoje; depois da virada não', async () => {
    assert.equal((await lancar({ encomenda: true, agendadoPara: '2026-11-15T01:00:00-03:00' })).status, 201);
    const amanha = await lancar({ encomenda: true, agendadoPara: '2026-11-15T05:00:00-03:00' });
    assert.equal(amanha.status, 422);
    assert.equal(amanha.corpo.erro.codigo, 'AGENDAMENTO_INVALIDO');
    const passado = await lancar({ encomenda: true, agendadoPara: '2026-11-14T19:00:00-03:00' });
    assert.equal(passado.status, 422);
    assert.equal(passado.corpo.erro.codigo, 'AGENDAMENTO_INVALIDO');
  });

  test('encomenda sem horário, horário sem encomenda e delivery sem endereço = 400', async () => {
    assert.equal((await lancar({ encomenda: true })).status, 400);
    assert.equal((await lancar({ agendadoPara: '2026-11-14T22:00:00-03:00' })).status, 400);
    assert.equal((await lancar({ enderecoId: null })).status, 400);
    assert.equal((await lancar({ retirarNoBalcao: true })).status, 400); // retirada só em encomenda
  });

  test('encomenda retirada no balcão: sem endereço e sem taxa (mesmo se mandar taxa)', async () => {
    const r = await lancar({
      encomenda: true,
      agendadoPara: '2026-11-14T21:00:00-03:00',
      retirarNoBalcao: true,
      enderecoId: null,
      taxaEntregaCentavos: 900,
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.pedido.retirarNoBalcao, true);
    assert.equal(r.corpo.pedido.enderecoTexto, null);
    assert.equal(r.corpo.pedido.taxaEntregaCentavos, 0);
    assert.equal(r.corpo.pedido.totalCentavos, preco('X-Burguer') * 2);
  });

  // ───────── Desconto, taxa digitada, observação ─────────

  test('desconto, taxa digitada e observação do pedido; total = subtotal + taxa − desconto', async () => {
    const r = await lancar({ descontoCentavos: 300, taxaEntregaCentavos: 800, observacao: ' Interfone quebrado ' });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const pd = r.corpo.pedido;
    assert.equal(pd.subtotalCentavos, preco('X-Burguer') * 2);
    assert.equal(pd.taxaEntregaCentavos, 800);
    assert.equal(pd.descontoCentavos, 300);
    assert.equal(pd.totalCentavos, preco('X-Burguer') * 2 + 800 - 300);
    assert.equal(pd.observacao, 'Interfone quebrado');
  });

  test('desconto maior que os itens = 400 DESCONTO_INVALIDO, antes de baixar estoque', async () => {
    const antes = await estoquePao();
    const r = await lancar({ descontoCentavos: preco('X-Burguer') * 2 + 1 });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'DESCONTO_INVALIDO');
    assert.equal(await estoquePao(), antes);
  });

  test('troco é conferido contra o total com desconto', async () => {
    const total = preco('X-Burguer') * 2 + 500 - 1000;
    const igual = await lancar({ descontoCentavos: 1000, formaPagamento: 'DINHEIRO', trocoParaCentavos: total });
    assert.equal(igual.status, 400);
    assert.equal(igual.corpo.erro.codigo, 'TROCO_INVALIDO');
    assert.equal((await lancar({ descontoCentavos: 1000, formaPagamento: 'DINHEIRO', trocoParaCentavos: total + 1 })).status, 201);
  });

  test('o site nunca usa desconto, taxa digitada, encomenda nem pago agora', async () => {
    const { criarPedido } = await import('../src/services/pedido.service.js');
    const base = { lojaId: 1, canal: 'SITE', itens: [item('X-Burguer')], totalEsperadoCentavos: 0, agora };
    for (const extra of [
      { ajustes: { descontoCentavos: 100 } },
      { ajustes: { taxaManualCentavos: 0 } },
      { entrega: { encomenda: true, agendadoPara: local('2026-11-14T22:00') } },
      { pagoAgora: true },
    ]) {
      await assert.rejects(criarPedido({ ...base, ...extra }), (e) => e.status === 400);
    }
  });

  // ───────── Status e horário ─────────

  test('status: Em preparo → Saiu para entrega, com evento para a equipe; finalizar e cancelar continuam valendo', async () => {
    const { corpo } = await lancar();
    const id = corpo.pedido.id;

    const login = await api('POST', '/auth/login', { corpo: { email: 'ana@teste.com', senha: 'senha-da-ana' }, semToken: true });
    const socket = conectarSocket(new URL(base).origin, {
      path: '/api/socket.io',
      auth: { token: login.corpo.accessToken },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const evento = new Promise((resolve) => socket.once('pedido:atualizado', resolve));
    const r = await api('PATCH', `/equipe/pedidos/${id}/status`, { corpo: { status: 'EM_PREPARO' } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.pedido.status, 'EM_PREPARO');
    const recebido = await evento;
    socket.close();
    assert.equal(recebido.id, id);
    assert.equal(recebido.status, 'EM_PREPARO');
    assert.equal(recebido.registradoPor, 'Ana');

    assert.equal((await api('PATCH', `/equipe/pedidos/${id}/status`, { corpo: { status: 'SAIU_ENTREGA' } })).corpo.pedido.status, 'SAIU_ENTREGA');
    // Em andamento continua "aberto" na fila padrão.
    const abertos = await api('GET', '/equipe/pedidos?dataRef=hoje&canal=SITE,WHATSAPP');
    assert.ok(abertos.corpo.pedidos.some((x) => x.id === id));

    const f = await api('PATCH', `/equipe/pedidos/${id}/finalizar`, { corpo: { formaPagamento: 'PIX' } });
    assert.equal(f.status, 200);
    const depois = await api('PATCH', `/equipe/pedidos/${id}/status`, { corpo: { status: 'EM_PREPARO' } });
    assert.equal(depois.status, 409);
    assert.equal(depois.corpo.erro.codigo, 'PEDIDO_ENCERRADO');

    const outro = (await lancar()).corpo.pedido.id;
    await api('PATCH', `/equipe/pedidos/${outro}/status`, { corpo: { status: 'SAIU_ENTREGA' } });
    const c = await api('PATCH', `/equipe/pedidos/${outro}/cancelar`);
    assert.equal(c.status, 200);
    assert.equal(c.corpo.pedido.status, 'CANCELADO');
  });

  test('status inválido = 400; comanda do salão e pedido inexistente = 404', async () => {
    const { corpo } = await lancar();
    assert.equal((await api('PATCH', `/equipe/pedidos/${corpo.pedido.id}/status`, { corpo: { status: 'FINALIZADO' } })).status, 400);
    const comanda = await api('POST', '/equipe/comandas', { corpo: { nomeCliente: 'Mesa do João' } });
    assert.equal((await api('PATCH', `/equipe/pedidos/${comanda.corpo.comanda.id}/status`, { corpo: { status: 'EM_PREPARO' } })).status, 404);
    assert.equal((await api('PATCH', '/equipe/pedidos/999999/status', { corpo: { status: 'EM_PREPARO' } })).status, 404);
    await api('PATCH', `/equipe/pedidos/${comanda.corpo.comanda.id}/cancelar`);
  });

  test('alterar horário da encomenda: mesmas regras da criação; delivery comum = 409', async () => {
    const enc = (await lancar({ encomenda: true, agendadoPara: '2026-11-14T22:00:00-03:00' })).corpo.pedido;
    const ok = await api('PATCH', `/equipe/pedidos/${enc.id}/agendamento`, { corpo: { agendadoPara: '2026-11-14T23:15:00-03:00' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
    assert.equal(new Date(ok.corpo.pedido.agendadoPara).toISOString(), local('2026-11-14T23:15').toISOString());
    const amanha = await api('PATCH', `/equipe/pedidos/${enc.id}/agendamento`, { corpo: { agendadoPara: '2026-11-15T12:00:00-03:00' } });
    assert.equal(amanha.status, 422);

    const comum = (await lancar()).corpo.pedido;
    const r = await api('PATCH', `/equipe/pedidos/${comum.id}/agendamento`, { corpo: { agendadoPara: '2026-11-14T23:00:00-03:00' } });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'NAO_E_ENCOMENDA');
  });

  // ───────── Clientes ─────────

  test('cliente sem endereço (retirada), com e-mail e observação; e-mail inválido = 400', async () => {
    const r = await api('POST', '/equipe/clientes', {
      corpo: { nome: 'Daiane', telefone: '43999990002', email: ' Daiane@Exemplo.com ', observacao: 'Cliente antiga' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.cliente.email, 'daiane@exemplo.com');
    assert.equal(r.corpo.cliente.observacao, 'Cliente antiga');
    assert.equal(r.corpo.cliente.doSite, false);
    assert.deepEqual(r.corpo.cliente.enderecos, []);

    const ruim = await api('POST', '/equipe/clientes', { corpo: { nome: 'X', telefone: '43999990003', email: 'sem-arroba' } });
    assert.equal(ruim.status, 400);
  });

  test('PUT /equipe/clientes/:id: edita; telefone de outro cliente = 409', async () => {
    const r = await api('PUT', `/equipe/clientes/${cliente.id}`, {
      corpo: { nome: 'Lilian Souza', telefone: '(43) 99999-0001', email: '', observacao: 'Portão azul' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.cliente.nome, 'Lilian Souza');
    assert.equal(r.corpo.cliente.observacao, 'Portão azul');
    // A busca sem acento continua achando (nomeBusca recalculado pela extensão do Prisma).
    const busca = await api('GET', '/equipe/clientes?busca=souza');
    assert.ok(busca.corpo.clientes.some((c) => c.id === cliente.id));

    const dup = await api('PUT', `/equipe/clientes/${cliente.id}`, { corpo: { nome: 'Lilian', telefone: '43999990002' } });
    assert.equal(dup.status, 409);
    assert.equal(dup.corpo.erro.codigo, 'CLIENTE_JA_EXISTE');
    assert.equal((await api('PUT', '/equipe/clientes/999999', { corpo: { nome: 'A', telefone: '43999990009' } })).status, 404);
  });

  test('cliente do site: nome e e-mail não mudam pelo PDV; observação muda', async () => {
    const site = await prisma.cliente.create({
      data: { googleId: 'g-123', nome: 'Maria do Site', email: 'maria@gmail.com', telefone: '43999990004' },
    });
    const r = await api('PUT', `/equipe/clientes/${site.id}`, {
      corpo: { nome: 'Outro', telefone: '43999990005', email: 'outro@x.com', observacao: 'Casa amarela' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.cliente.doSite, true);
    assert.equal(r.corpo.cliente.nome, 'Maria do Site');
    assert.equal(r.corpo.cliente.email, 'maria@gmail.com');
    assert.equal(r.corpo.cliente.telefone, '43999990004');
    assert.equal(r.corpo.cliente.observacao, 'Casa amarela');
  });

  test('endereço com CEP, cidade e estado; editar endereço; de outro cliente = 404; CEP inválido = 400', async () => {
    const novo = await api('POST', `/equipe/clientes/${cliente.id}/enderecos`, {
      corpo: { rua: 'Rua B', numero: '5', bairroId: centro.id, cep: '86.460-000', cidade: 'Abatiá', estado: 'Paraná' },
    });
    assert.equal(novo.status, 201, JSON.stringify(novo.corpo));
    const e = novo.corpo.cliente.enderecos[0];
    assert.equal(e.cep, '86460000');
    assert.equal(e.cidade, 'Abatiá');
    assert.equal(e.principal, true);

    const ed = await api('PUT', `/equipe/clientes/${cliente.id}/enderecos/${e.id}`, {
      corpo: { rua: 'Rua B', numero: '7', bairroId: centro.id, cep: '', cidade: 'Abatiá', estado: 'Paraná' },
    });
    assert.equal(ed.status, 200, JSON.stringify(ed.corpo));
    const editado = ed.corpo.cliente.enderecos.find((x) => x.id === e.id);
    assert.equal(editado.numero, '7');
    assert.equal(editado.cep, null);

    const outro = await api('POST', '/equipe/clientes', {
      corpo: { nome: 'Outro', telefone: '43999990006', endereco: { rua: 'R', numero: '1', bairroId: centro.id } },
    });
    const alheio = await api('PUT', `/equipe/clientes/${cliente.id}/enderecos/${outro.corpo.cliente.enderecos[0].id}`, {
      corpo: { rua: 'R', numero: '1', bairroId: centro.id },
    });
    assert.equal(alheio.status, 404);
    const cep = await api('POST', `/equipe/clientes/${cliente.id}/enderecos`, {
      corpo: { rua: 'Rua C', numero: '1', bairroId: centro.id, cep: '123' },
    });
    assert.equal(cep.status, 400);
    // O endereço continua o do cadastro para o site (o site não manda CEP e não apaga).
    cliente = ed.corpo.cliente;
  });

  // ───────── Caixa e relatório ─────────

  test('fechar o caixa com pedido em preparo = 409 PEDIDOS_ABERTOS com o pedido na lista', async () => {
    const { corpo } = await lancar();
    await api('PATCH', `/equipe/pedidos/${corpo.pedido.id}/status`, { corpo: { status: 'EM_PREPARO' } });
    const r = await api('POST', '/equipe/caixa/fechar', { corpo: { valorContadoCentavos: 0 } });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'PEDIDOS_ABERTOS');
    assert.ok(r.corpo.erro.detalhes.pedidos.some((x) => x.id === corpo.pedido.id && x.status === 'EM_PREPARO'));
  });

  test('relatório do dia soma o desconto: Σ subtotal + Σ taxa − Σ desconto = Σ total', async () => {
    const { corpo } = await lancar({ descontoCentavos: 250 });
    await api('PATCH', `/equipe/pedidos/${corpo.pedido.id}/finalizar`, { corpo: { formaPagamento: 'PIX' } });
    const { relatorioDoDia } = await import('../src/services/relatorio.service.js');
    const r = await relatorioDoDia(1, '2026-11-14', agora);
    assert.ok(r.descontoCentavos >= 250);
    assert.equal(r.subtotalCentavos + r.taxaEntregaCentavos - r.descontoCentavos, r.totalCentavos);
  });
});
