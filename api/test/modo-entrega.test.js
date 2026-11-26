import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

/**
 * Modo de entrega da loja (Decisão 2 e Decisão 9 da Etapa 3): só o ADMIN muda, toda loja
 * nasce PROPRIO, e virar PLATAFORMA com o frete grátis abaixo do piso exige escolher
 * entre subir o mínimo ou desligar o frete grátis (a loja nunca fica violando o piso).
 */
describe('modo de entrega da loja (ADMIN) e o piso do frete grátis', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  const tk = {};

  async function api(metodo, rota, { corpo, token } = {}) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { ...(token && { authorization: `Bearer ${token}` }), ...(corpo !== undefined && { 'content-type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  const login = async (email, senha) => (await api('POST', '/auth/login', { corpo: { email, senha } })).corpo.accessToken;
  const loja = () => prisma.loja.findUniqueOrThrow({ where: { id: 1 } });
  const mudar = (corpo) => api('PATCH', '/plataforma/lojas/1', { token: tk.admin, corpo });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { criarApp } = await import('../src/app.js');
    const usuarios = await import('../src/services/usuario.service.js');
    await usuarios.criarDono({ nome: 'Dono', email: 'dono@teste.test', senha: 'senha-do-dono' });
    await usuarios.criarDono({ nome: 'Plataforma', email: 'admin@teste.test', senha: 'senha-do-admin' });
    await usuarios.promoverAAdmin('admin@teste.test');
    servidor = http.createServer(criarApp({ log: false }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tk.dono = await login('dono@teste.test', 'senha-do-dono');
    tk.admin = await login('admin@teste.test', 'senha-do-admin');
  });

  beforeEach(() =>
    prisma.loja.update({
      where: { id: 1 },
      // Com pino: loja PLATAFORMA exige a localização (Decisão 3 da Etapa 4; teste próprio abaixo).
      data: { modoEntrega: 'PROPRIO', freteGratisAtivo: false, freteGratisMinimoCentavos: null, latitude: -23.3049, longitude: -50.3133 },
    }),
  );

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('a lista do ADMIN traz o modo (PROPRIO por padrão), o frete grátis e o Mercado Pago', async () => {
    const r = await api('GET', '/plataforma/lojas', { token: tk.admin });
    const cabana = r.corpo.lojas.find((l) => l.id === 1);
    assert.equal(cabana.modoEntrega, 'PROPRIO');
    assert.equal(cabana.freteGratisAtivo, false);
    assert.equal(cabana.mercadoPago, null);
    assert.equal(cabana.pagamentoOnlineAtivo, false);
  });

  test('só o ADMIN muda: o DONO leva 403 na plataforma e a configuração dele ignora o campo', async () => {
    assert.equal((await api('PATCH', '/plataforma/lojas/1', { token: tk.dono, corpo: { modoEntrega: 'PLATAFORMA' } })).status, 403);
    const r = await api('PUT', '/retaguarda/config', {
      token: tk.dono,
      corpo: { nomeRestaurante: 'Cabana Boemia', whatsappNumero: '43999990000', tempoEstimadoPadraoMin: 40, horaViradaDia: 4, freteGratisAtivo: false, freteGratisMinimoCentavos: null, modoEntrega: 'PLATAFORMA' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal((await loja()).modoEntrega, 'PROPRIO');
    // Valor fora da lista: 400.
    assert.equal((await mudar({ modoEntrega: 'LOJA' })).status, 400);
  });

  test('sem frete grátis (ou acima do piso): muda direto, e volta para PROPRIO', async () => {
    const r = await mudar({ modoEntrega: 'PLATAFORMA' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.loja.modoEntrega, 'PLATAFORMA');
    await prisma.loja.update({ where: { id: 1 }, data: { modoEntrega: 'PROPRIO', freteGratisAtivo: true, freteGratisMinimoCentavos: 3000 } });
    assert.equal((await mudar({ modoEntrega: 'PLATAFORMA' })).status, 200);
    assert.equal((await mudar({ modoEntrega: 'PROPRIO' })).corpo.loja.modoEntrega, 'PROPRIO');
  });

  test('frete grátis abaixo do piso: 409 com o mínimo e o piso, e nada muda', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { freteGratisAtivo: true, freteGratisMinimoCentavos: 1500 } });
    const r = await mudar({ modoEntrega: 'PLATAFORMA' });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'FRETE_GRATIS_ABAIXO_DO_PISO');
    assert.deepEqual(r.corpo.erro.detalhes, { minimoCentavos: 1500, pisoCentavos: 2000 });
    assert.match(r.corpo.erro.mensagem, /R\$ 15,00.*R\$ 20,00/s);
    const l = await loja();
    assert.equal(l.modoEntrega, 'PROPRIO');
    assert.equal(l.freteGratisMinimoCentavos, 1500);
  });

  test('escolha "subir": o mínimo vai ao piso junto com o modo', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { freteGratisAtivo: true, freteGratisMinimoCentavos: 1500 } });
    const r = await mudar({ modoEntrega: 'PLATAFORMA', freteGratisPiso: 'SUBIR' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const l = await loja();
    assert.equal(l.modoEntrega, 'PLATAFORMA');
    assert.equal(l.freteGratisAtivo, true);
    assert.equal(l.freteGratisMinimoCentavos, 2000);
  });

  test('escolha "desligar": o frete grátis da loja desliga (o mínimo fica guardado)', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { freteGratisAtivo: true, freteGratisMinimoCentavos: 1500 } });
    assert.equal((await mudar({ modoEntrega: 'PLATAFORMA', freteGratisPiso: 'DESLIGAR' })).status, 200);
    const l = await loja();
    assert.equal(l.modoEntrega, 'PLATAFORMA');
    assert.equal(l.freteGratisAtivo, false);
    assert.equal(l.freteGratisMinimoCentavos, 1500);
  });
});
