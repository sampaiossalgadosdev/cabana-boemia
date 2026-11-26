import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';

const SABADO_20H = new Date('2026-11-14T20:00-03:00'); // dia operacional 2026-11-14
const DIA = new Date('2026-11-14T00:00:00Z');

/**
 * Pedido pago online que ainda espera a aprovação (AGUARDANDO_PAGAMENTO) ou que expirou
 * (EXPIRADO) não existe para a equipe: fora da lista do dia (inclusive "Todos"), das
 * ações do painel, da reimpressão, do fechamento de caixa e do relatório de cancelados.
 */
describe('pedido aguardando pagamento ou expirado fica fora do PDV', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let tokenAna;
  let tokenDono;
  let normal;
  let aguardando;
  let expirado;
  let clienteId;

  async function api(metodo, rota, { corpo, token = tokenAna } = {}) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { authorization: `Bearer ${token}`, ...(corpo !== undefined && { 'content-type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  const login = async (email, senha) => {
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    return (await r.json()).accessToken;
  };

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const usuarios = await import('../src/services/usuario.service.js');
    await usuarios.criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });
    await usuarios.criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });
    const centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    await prisma.produto.updateMany({ data: { disponivelHoje: true, ativo: true } });
    await prisma.insumo.updateMany({ data: { estoque: 50 } });

    servidor = http.createServer(criarApp({ log: false, relogio: () => SABADO_20H }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tokenAna = await login('ana@teste.com', 'senha-da-ana');
    tokenDono = await login('dono@teste.com', 'senha-do-dono');

    const c = await api('POST', '/equipe/clientes', {
      corpo: { nome: 'Lilian', telefone: '43999990001', endereco: { rua: 'Rua A', numero: '10', bairroId: centro.id } },
    });
    clienteId = c.corpo.cliente.id;
    const produto = await prisma.produto.findFirstOrThrow({ where: { nome: 'X-Burguer' } });
    const r = await api('POST', '/equipe/pedidos', {
      corpo: {
        clienteId,
        enderecoId: c.corpo.cliente.enderecos[0].id,
        itens: [{ produtoId: produto.id, quantidade: 1 }],
        formaPagamento: 'DINHEIRO',
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    normal = r.corpo.pedido;

    // Como a etapa 4 vai criar: sem número do dia até a aprovação.
    const base_ = { lojaId: 1, dataRef: DIA, canal: 'SITE', nomeCliente: 'Lilian', clienteId, totalCentavos: 2500, criadoEm: SABADO_20H };
    aguardando = await prisma.pedido.create({ data: { ...base_, status: 'AGUARDANDO_PAGAMENTO', numeroDia: null } });
    expirado = await prisma.pedido.create({ data: { ...base_, status: 'EXPIRADO', numeroDia: null, canceladoEm: SABADO_20H } });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('lista do dia: nem em "abertos" nem em "Todos"', async () => {
    for (const status of ['abertos', 'todos']) {
      const r = await api('GET', `/equipe/pedidos?dataRef=2026-11-14&status=${status}`);
      assert.equal(r.status, 200);
      const ids = r.corpo.pedidos.map((p) => p.id);
      assert.ok(ids.includes(normal.id), status);
      assert.ok(!ids.includes(aguardando.id), status);
      assert.ok(!ids.includes(expirado.id), status);
    }
  });

  test('ações do painel e reimpressão: 404, como inexistente', async () => {
    // Caixa aberto: finalizar não pode falhar por CAIXA_FECHADO antes de achar o pedido.
    assert.equal((await api('POST', '/equipe/caixa/abrir', { corpo: { valorInicialCentavos: 0 } })).status, 201);
    for (const p of [aguardando, expirado]) {
      const acoes = [
        ['PATCH', `/equipe/pedidos/${p.id}/finalizar`, { formaPagamento: 'PIX' }],
        ['PATCH', `/equipe/pedidos/${p.id}/cancelar`, undefined],
        ['PATCH', `/equipe/pedidos/${p.id}/status`, { status: 'EM_PREPARO' }],
        ['PATCH', `/equipe/pedidos/${p.id}/agendamento`, { agendadoPara: new Date(SABADO_20H.getTime() + 3600_000).toISOString() }],
        ['PATCH', `/equipe/pedidos/${p.id}/nfce`, { chaveNfce: null }],
        ['POST', `/equipe/pedidos/${p.id}/reimprimir`, undefined],
      ];
      for (const [metodo, rota, corpo] of acoes) {
        const r = await api(metodo, rota, { corpo });
        assert.equal(r.status, 404, `${metodo} ${rota}: ${JSON.stringify(r.corpo)}`);
      }
    }
    assert.equal(await prisma.trabalhoImpressao.count({ where: { pedidoId: { in: [aguardando.id, expirado.id] } } }), 0);
    const intacto = await prisma.pedido.findUnique({ where: { id: aguardando.id } });
    assert.equal(intacto.status, 'AGUARDANDO_PAGAMENTO');
  });

  test('fechamento de caixa não espera o pedido que aguarda pagamento', async () => {
    assert.equal((await api('PATCH', `/equipe/pedidos/${normal.id}/finalizar`, { corpo: { formaPagamento: 'DINHEIRO' } })).status, 200);
    const r = await api('POST', '/equipe/caixa/fechar', { corpo: { valorContadoCentavos: 0 } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
  });

  test('relatório do dia: o expirado não entra nos cancelados', async () => {
    const r = await api('GET', '/retaguarda/relatorios/dia?data=2026-11-14', { token: tokenDono });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo.cancelados, { quantidade: 0, totalCentavos: 0 });
    assert.equal(r.corpo.quantidadePedidos, 1);
  });

  test('exclusão de conta: o expirado não conta como pedido em andamento', async () => {
    const { contarPedidosRecentes } = await import('../src/repositories/cliente.repository.js');
    const desde = new Date(SABADO_20H.getTime() - 3600_000);
    assert.equal(await contarPedidosRecentes(clienteId, desde), 1); // só o que aguarda pagamento
  });
});
