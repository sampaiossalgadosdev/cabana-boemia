import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';
import { conferirModoEntrega } from '../src/services/pedido.service.js';

const PLATAFORMA = { nome: 'Cabana Boemia', modoEntrega: 'PLATAFORMA' };
const PROPRIO = { nome: 'Cabana Boemia', modoEntrega: 'PROPRIO' };
const COM_PINO = { texto: 'Rua A, 10', bairroId: 1, pin: { latitude: -23.3, longitude: -50.31 } };
const SEM_PINO = { texto: 'Rua A, 10', bairroId: 1, pin: null };

const codigo = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err.codigo ?? err.message;
  }
};

describe('regras do entregador da plataforma no pedido (conferirModoEntrega)', () => {
  test('motoboy próprio: nada muda (qualquer forma, sem pino)', () => {
    for (const forma of ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']) {
      assert.equal(codigo(() => conferirModoEntrega(PROPRIO, { canal: 'SITE', endereco: SEM_PINO, pagamento: { forma } })), null);
      assert.equal(codigo(() => conferirModoEntrega(null, { canal: 'WHATSAPP', endereco: SEM_PINO, pagamento: { forma } })), null);
    }
  });

  test('app sem pino em loja PLATAFORMA: 422 PINO_OBRIGATORIO; o site passa (taxa da área)', () => {
    assert.equal(
      codigo(() => conferirModoEntrega(PLATAFORMA, { canal: 'APP', endereco: SEM_PINO, pagamento: { forma: 'DINHEIRO' } })),
      'PINO_OBRIGATORIO',
    );
    assert.equal(
      codigo(() => conferirModoEntrega(PLATAFORMA, { canal: 'APP', endereco: COM_PINO, pagamento: { forma: 'DINHEIRO' } })),
      null,
    );
    assert.equal(
      codigo(() => conferirModoEntrega(PLATAFORMA, { canal: 'SITE', endereco: SEM_PINO, pagamento: { forma: 'DINHEIRO' } })),
      null,
    );
    // Pix online não é "na entrega": passa em loja PLATAFORMA.
    assert.equal(
      codigo(() => conferirModoEntrega(PLATAFORMA, { canal: 'APP', endereco: COM_PINO, pagamento: { forma: 'PIX' }, pagamentoOnline: 'PIX' })),
      null,
    );
  });

  test('PDV sem pino em loja PLATAFORMA passa (taxa da área como reserva)', () => {
    assert.equal(
      codigo(() => conferirModoEntrega(PLATAFORMA, { canal: 'WHATSAPP', endereco: SEM_PINO, pagamento: { forma: 'DINHEIRO' } })),
      null,
    );
  });

  test('loja PLATAFORMA na entrega: só dinheiro; retirada e pago agora aceitam todas', () => {
    for (const canal of ['SITE', 'APP', 'WHATSAPP']) {
      for (const forma of ['PIX', 'DEBITO', 'CREDITO']) {
        assert.equal(
          codigo(() => conferirModoEntrega(PLATAFORMA, { canal, endereco: COM_PINO, pagamento: { forma } })),
          'FORMA_INDISPONIVEL',
          `${canal} ${forma}`,
        );
      }
      assert.equal(codigo(() => conferirModoEntrega(PLATAFORMA, { canal, endereco: COM_PINO, pagamento: { forma: 'DINHEIRO' } })), null);
    }
    assert.equal(
      codigo(() => conferirModoEntrega(PLATAFORMA, { canal: 'WHATSAPP', endereco: null, pagamento: { forma: 'DEBITO' } })),
      null,
    );
    assert.equal(
      codigo(() => conferirModoEntrega(PLATAFORMA, { canal: 'WHATSAPP', endereco: SEM_PINO, pagamento: { forma: 'PIX' }, pagoAgora: true })),
      null,
    );
    assert.equal(codigo(() => conferirModoEntrega(PLATAFORMA, { canal: 'SALAO', pagamento: { forma: 'DEBITO' } })), null);
  });
});

test('loja PLATAFORMA: taxa digitada no PDV recusada (a taxa é a da área); retirada e motoboy próprio passam', () => {
  const pdv = (loja, extra) => () =>
    conferirModoEntrega(loja, { canal: 'WHATSAPP', endereco: SEM_PINO, pagamento: { forma: 'DINHEIRO' }, ...extra });
  assert.equal(codigo(pdv(PLATAFORMA, { ajustes: { taxaManualCentavos: 300 } })), 'TAXA_MANUAL_PROIBIDA');
  assert.equal(codigo(pdv(PLATAFORMA, { ajustes: { taxaManualCentavos: 0 } })), 'TAXA_MANUAL_PROIBIDA');
  assert.equal(codigo(pdv(PLATAFORMA, { ajustes: { taxaManualCentavos: null } })), null);
  // Retirada no balcão: a criação zera a taxa sozinha (não é taxa digitada).
  assert.equal(
    codigo(() => conferirModoEntrega(PLATAFORMA, { canal: 'WHATSAPP', endereco: null, pagamento: { forma: 'PIX' }, ajustes: { taxaManualCentavos: 0 }, entrega: { retirarNoBalcao: true } })),
    null,
  );
  assert.equal(codigo(pdv(PROPRIO, { ajustes: { taxaManualCentavos: 300 } })), null);
});

describe('formas de pagamento da loja na API (pedido do PDV e config pública)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let token;
  let cliente;
  let produto;
  const flagAntes = process.env.PAGAMENTO_ONLINE_ATIVO;

  async function api(metodo, rota, corpo, comToken = true) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: {
        ...(comToken && { authorization: `Bearer ${token}` }),
        ...(corpo !== undefined && { 'content-type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  const lancar = (formaPagamento, extra = {}) =>
    api('POST', '/equipe/pedidos', {
      clienteId: cliente.id,
      enderecoId: cliente.enderecos[0].id,
      itens: [{ produtoId: produto.id, quantidade: 1 }],
      formaPagamento,
      ...extra,
    });
  const modo = (modoEntrega) => prisma.loja.update({ where: { id: 1 }, data: { modoEntrega } });
  const formas = async () => (await api('GET', '/publico/lojas/cabana-boemia/config', undefined, false)).corpo.formasPagamento;

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const { criarAtendente } = await import('../src/services/usuario.service.js');
    produto = await prisma.produto.findFirstOrThrow({ where: { nome: 'X-Burguer' } });
    await prisma.produto.updateMany({ data: { disponivelHoje: true, ativo: true } });
    await prisma.insumo.updateMany({ data: { estoque: 50 } });
    const centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });

    servidor = http.createServer(criarApp({ log: false, relogio: () => new Date('2026-11-14T20:00-03:00') }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    token = (await api('POST', '/auth/login', { email: 'ana@teste.com', senha: 'senha-da-ana' }, false)).corpo.accessToken;
    cliente = (
      await api('POST', '/equipe/clientes', {
        nome: 'Lilian',
        telefone: '43999990001',
        endereco: { rua: 'Rua A', numero: '10', bairroId: centro.id },
      })
    ).corpo.cliente;
  });

  afterEach(async () => {
    await modo('PROPRIO');
    if (flagAntes === undefined) delete process.env.PAGAMENTO_ONLINE_ATIVO;
    else process.env.PAGAMENTO_ONLINE_ATIVO = flagAntes;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('PDV em loja PLATAFORMA: débito na entrega recusado antes de baixar estoque; dinheiro passa', async () => {
    await modo('PLATAFORMA');
    const antes = (await prisma.insumo.findFirst({ where: { nome: 'Pão de lanche' } })).estoque;
    const r = await lancar('DEBITO');
    assert.equal(r.status, 422);
    assert.equal(r.corpo.erro.codigo, 'FORMA_INDISPONIVEL');
    assert.match(r.corpo.erro.mensagem, /não aceita cartão de débito na entrega/);
    assert.equal((await prisma.insumo.findFirst({ where: { nome: 'Pão de lanche' } })).estoque, antes);
    assert.equal((await lancar('DINHEIRO')).status, 201);
  });

  test('PDV em loja PLATAFORMA: taxa digitada recusada (422) antes de baixar estoque; em PROPRIO passa', async () => {
    await modo('PLATAFORMA');
    const r = await lancar('DINHEIRO', { taxaEntregaCentavos: 300 });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.erro.codigo, 'TAXA_MANUAL_PROIBIDA');
    await modo('PROPRIO');
    const ok = await lancar('DINHEIRO', { taxaEntregaCentavos: 300 });
    assert.equal(ok.status, 201, JSON.stringify(ok.corpo));
    assert.equal(ok.corpo.pedido.taxaEntregaCentavos, 300);
  });

  test('PDV em loja PROPRIO (padrão): débito na entrega continua valendo', async () => {
    assert.equal((await lancar('DEBITO')).status, 201);
  });

  test('config pública: formas de hoje com a flag desligada, mesmo com a loja ligada e conectada', async () => {
    delete process.env.PAGAMENTO_ONLINE_ATIVO;
    await prisma.loja.update({ where: { id: 1 }, data: { pagamentoOnlineAtivo: true } });
    await prisma.conexaoMercadoPago.upsert({
      where: { lojaId: 1 },
      create: { lojaId: 1, mpUserId: '1', accessTokenCifrado: 'v1.a.b.c' },
      update: { status: 'CONECTADA', accessTokenCifrado: 'v1.a.b.c' },
    });
    assert.deepEqual(await formas(), { naEntrega: ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'], online: [] });
    // A rota antiga do site também ganha o campo (aditivo; o site ignora).
    assert.deepEqual((await api('GET', '/publico/config', undefined, false)).corpo.formasPagamento.online, []);
  });

  test('config pública: online só com flag + loja ligada + conexão CONECTADA; PLATAFORMA só dinheiro na entrega', async () => {
    process.env.PAGAMENTO_ONLINE_ATIVO = 'sim';
    assert.deepEqual(await formas(), { naEntrega: ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'], online: ['PIX', 'CARTAO_ONLINE'] });
    await modo('PLATAFORMA');
    assert.deepEqual(await formas(), { naEntrega: ['DINHEIRO'], online: ['PIX', 'CARTAO_ONLINE'] });
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { status: 'EXPIRADA' } });
    assert.deepEqual((await formas()).online, []);
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { status: 'CONECTADA' } });
    await prisma.loja.update({ where: { id: 1 }, data: { pagamentoOnlineAtivo: false } });
    assert.deepEqual((await formas()).online, []);
  });
});
