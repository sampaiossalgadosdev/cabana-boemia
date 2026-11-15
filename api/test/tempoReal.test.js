import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as conectarSocket } from 'socket.io-client';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

describe('Socket.IO da equipe', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let tokenDono;

  async function api(metodo, rota, { corpo, token } = {}) {
    const headers = {};
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${rota}`, { method: metodo, headers, body: corpo && JSON.stringify(corpo) });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  const login = async (email, senha) => (await api('POST', '/auth/login', { corpo: { email, senha } })).corpo.accessToken;

  /** Conecta sem reconexão automática; resolve no connect ou rejeita no connect_error. */
  async function conectar(token) {
    const socket = conectarSocket(base, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarTempoReal } = await import('../src/lib/tempoReal.js');
    const { criarDono } = await import('../src/services/usuario.service.js');
    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });

    servidor = http.createServer(criarApp({ log: false }));
    criarTempoReal(servidor);
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
    tokenDono = await login('dono@teste.com', 'senha-do-dono');
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('desativar um atendente derruba os sockets dele na hora e a reconexão é recusada', async () => {
    const criado = await api('POST', '/usuarios', {
      token: tokenDono,
      corpo: { nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' },
    });
    assert.equal(criado.status, 201);
    const tokenAna = await login('ana@teste.com', 'senha-da-ana');

    const ana1 = await conectar(tokenAna);
    const ana2 = await conectar(tokenAna); // ex.: PDV aberto em dois computadores
    const dono = await conectar(tokenDono);
    try {
      const quedas = [ana1, ana2].map((s) => new Promise((resolve) => s.once('disconnect', resolve)));
      let donoCaiu = false;
      dono.once('disconnect', () => (donoCaiu = true));

      const r = await api('PATCH', `/usuarios/${criado.corpo.usuario.id}/desativar`, { token: tokenDono });
      assert.equal(r.status, 200);

      assert.deepEqual(await Promise.all(quedas), ['io server disconnect', 'io server disconnect']);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(donoCaiu, false, 'só os sockets do desativado caem');
      assert.equal(dono.connected, true);

      // O access token dela ainda está dentro dos 15 min, mas o usuário está desativado.
      await assert.rejects(conectar(tokenAna), { message: 'NAO_AUTENTICADO' });
    } finally {
      for (const s of [ana1, ana2, dono]) s.close();
    }
  });
});
