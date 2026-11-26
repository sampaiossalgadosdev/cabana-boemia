import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';
import { conferirMinimoDoFreteGratis } from '../src/services/configuracao.service.js';

const PLATAFORMA = { modoEntrega: 'PLATAFORMA', freteGratisAtivo: false, freteGratisMinimoCentavos: null };

describe('piso do frete grátis da loja com entregador da plataforma (regra)', () => {
  const codigo = (fn) => {
    try {
      fn();
      return null;
    } catch (err) {
      return err.codigo;
    }
  };

  test('motoboy próprio: qualquer mínimo', () => {
    assert.equal(codigo(() => conferirMinimoDoFreteGratis({ modoEntrega: 'PROPRIO' }, { freteGratisAtivo: true, freteGratisMinimoCentavos: 100 }, {})), null);
  });

  test('plataforma: abaixo de R$ 20,00 ligado = VALIDACAO; igual ou acima passa; desligado passa', () => {
    const ligar = (minimo, env = {}) =>
      codigo(() => conferirMinimoDoFreteGratis(PLATAFORMA, { freteGratisAtivo: true, freteGratisMinimoCentavos: minimo }, env));
    assert.equal(ligar(1999), 'VALIDACAO');
    assert.equal(ligar(2000), null);
    assert.equal(ligar(5000), null);
    assert.equal(codigo(() => conferirMinimoDoFreteGratis(PLATAFORMA, { freteGratisAtivo: false, freteGratisMinimoCentavos: 1000 }, {})), null);
    // Piso configurável.
    assert.equal(ligar(2500, { FRETE_GRATIS_MINIMO_PLATAFORMA_CENTAVOS: '3000' }), 'VALIDACAO');
    assert.equal(ligar(3000, { FRETE_GRATIS_MINIMO_PLATAFORMA_CENTAVOS: '3000' }), null);
  });

  test('plataforma: campos ausentes usam o que já está na loja', () => {
    const loja = { ...PLATAFORMA, freteGratisAtivo: true, freteGratisMinimoCentavos: 1500 };
    assert.equal(codigo(() => conferirMinimoDoFreteGratis(loja, {}, {})), 'VALIDACAO');
    assert.equal(codigo(() => conferirMinimoDoFreteGratis(loja, { freteGratisMinimoCentavos: 2000 }, {})), null);
    assert.equal(codigo(() => conferirMinimoDoFreteGratis(loja, { freteGratisAtivo: false }, {})), null);
  });
});

describe('piso do frete grátis na retaguarda (PUT /retaguarda/config)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let token;

  async function api(metodo, rota, corpo) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { authorization: `Bearer ${token}`, ...(corpo !== undefined && { 'content-type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  const salvar = (freteGratisMinimoCentavos, freteGratisAtivo = true) =>
    api('PUT', '/retaguarda/config', {
      nomeRestaurante: 'Cabana Boemia',
      whatsappNumero: '43999990000',
      tempoEstimadoPadraoMin: 40,
      horaViradaDia: 4,
      freteGratisAtivo,
      freteGratisMinimoCentavos,
    });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarDono } = await import('../src/services/usuario.service.js');
    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });
    servidor = http.createServer(criarApp({ log: false }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dono@teste.com', senha: 'senha-do-dono' }),
    });
    token = (await r.json()).accessToken;
  });

  afterEach(() => prisma.loja.update({ where: { id: 1 }, data: { modoEntrega: 'PROPRIO' } }));

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('motoboy próprio (padrão): mínimo de R$ 10,00 continua valendo; sem piso na resposta', async () => {
    const r = await salvar(1000);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.config.modoEntrega, 'PROPRIO');
    assert.equal(r.corpo.config.freteGratisMinimoPlataformaCentavos, null);
  });

  test('entregador da plataforma: abaixo do piso recusado no campo do mínimo, com o motivo', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { modoEntrega: 'PLATAFORMA' } });
    const lido = await api('GET', '/retaguarda/config');
    assert.equal(lido.corpo.config.freteGratisMinimoPlataformaCentavos, 2000);

    const r = await salvar(1500);
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'VALIDACAO');
    assert.equal(r.corpo.erro.detalhes[0].campo, 'freteGratisMinimoCentavos');
    assert.match(r.corpo.erro.mensagem, /entregadores do Taaki.*pelo menos R\$ 20,00/s);

    assert.equal((await salvar(2000)).status, 200);
    assert.equal((await salvar(1500, false)).status, 200); // desligado guarda o valor
  });
});
