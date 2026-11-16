import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarSessao, expiracaoDoToken, CHAVE_REFRESH } from '../src/lib/sessao.js';

const AGORA = 1_800_000_000_000;
const jwt = (expMs, papel = 'DONO') =>
  `x.${Buffer.from(JSON.stringify({ exp: Math.floor(expMs / 1000), papel })).toString('base64url')}.y`;

function memoria(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

const erro = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

/** API falsa: o refresh gira a cada uso; reuso = 401 (como a API real trata roubo). */
function apiFalsa({ papel = 'DONO' } = {}) {
  const validos = new Set(['r0']);
  let n = 0;
  const chamadas = [];
  async function enviar(metodo, rota, { corpo, token } = {}) {
    chamadas.push({ metodo, rota, token });
    await new Promise((r) => setTimeout(r, 5));
    if (rota === '/auth/login') {
      if (corpo.senha !== 'certa') throw erro(401);
      validos.add('r-login');
      return { accessToken: jwt(AGORA + 15 * 60_000), refreshToken: 'r-login', usuario: { id: 1, nome: 'D', papel } };
    }
    if (rota === '/auth/refresh') {
      if (!validos.delete(corpo.refreshToken)) throw erro(401);
      n += 1;
      validos.add(`r${n}`);
      return { accessToken: jwt(AGORA + 15 * 60_000), refreshToken: `r${n}` };
    }
    if (rota === '/auth/logout') return null;
    if (!token) throw erro(401);
    if (rota === '/auth/me') return { usuario: { id: 1, nome: 'D', papel } };
    return { ok: true };
  }
  return { enviar, chamadas, validos };
}

const quantosRefresh = (f) => f.chamadas.filter((c) => c.rota === '/auth/refresh').length;

test('expiracaoDoToken lê o exp; lixo = 0', () => {
  assert.equal(expiracaoDoToken(jwt(AGORA)), AGORA);
  assert.equal(expiracaoDoToken('nada'), 0);
});

test('restaurar: com refresh salvo renova (girando o refresh) e confere o dono; sem refresh = null', async () => {
  const arm = memoria({ [CHAVE_REFRESH]: 'r0' });
  const f = apiFalsa();
  const s = criarSessao({ armazenamento: arm, enviar: f.enviar, agora: () => AGORA });
  assert.equal((await s.restaurar()).papel, 'DONO');
  assert.equal(arm.getItem(CHAVE_REFRESH), 'r1');
  assert.equal(await criarSessao({ armazenamento: memoria(), enviar: f.enviar }).restaurar(), null);
});

test('renovação single-flight: 5 chamadas sem access viram UM refresh (sem reuso)', async () => {
  const f = apiFalsa();
  const s = criarSessao({ armazenamento: memoria({ [CHAVE_REFRESH]: 'r0' }), enviar: f.enviar, agora: () => AGORA });
  const rs = await Promise.all(Array.from({ length: 5 }, () => s.chamar('GET', '/retaguarda/produtos')));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(quantosRefresh(f), 1);
});

test('entre abas: a trava serializa e a segunda aba usa o refresh que a primeira gravou', async () => {
  const arm = memoria({ [CHAVE_REFRESH]: 'r0' });
  const f = apiFalsa();
  let fila = Promise.resolve();
  const travar = (fn) => {
    const r = fila.then(fn);
    fila = r.catch(() => {});
    return r;
  };
  const a = criarSessao({ armazenamento: arm, enviar: f.enviar, travar, agora: () => AGORA });
  const b = criarSessao({ armazenamento: arm, enviar: f.enviar, travar, agora: () => AGORA });
  await Promise.all([a.renovar(), b.renovar()]);
  assert.equal(arm.getItem(CHAVE_REFRESH), 'r2', 'girou duas vezes, sem reuso');
});

test('renova 60 s antes de vencer', async () => {
  let agora = AGORA;
  const f = apiFalsa();
  const s = criarSessao({ armazenamento: memoria({ [CHAVE_REFRESH]: 'r0' }), enviar: f.enviar, agora: () => agora });
  await s.chamar('GET', '/x');
  await s.chamar('GET', '/x');
  assert.equal(quantosRefresh(f), 1, 'token novo: não renova');
  agora = AGORA + 14 * 60_000 + 1; // faltam menos de 60 s
  await s.chamar('GET', '/x');
  assert.equal(quantosRefresh(f), 2);
});

test('refresh recusado apaga a sessão e avisa; erro de rede mantém o refresh', async () => {
  const arm = memoria({ [CHAVE_REFRESH]: 'roubado' });
  const s = criarSessao({ armazenamento: arm, enviar: apiFalsa().enviar, agora: () => AGORA });
  assert.equal(await s.restaurar(), null);
  assert.equal(arm.getItem(CHAVE_REFRESH), null);

  const arm2 = memoria({ [CHAVE_REFRESH]: 'r0' });
  const semRede = criarSessao({
    armazenamento: arm2,
    enviar: async () => {
      throw erro(0);
    },
    agora: () => AGORA,
  });
  await assert.rejects(semRede.restaurar());
  assert.equal(arm2.getItem(CHAVE_REFRESH), 'r0');

  // Sessão em uso que perde o refresh: avisa a tela (volta ao login).
  let avisos = 0;
  const f3 = apiFalsa();
  const s3 = criarSessao({ armazenamento: memoria(), enviar: f3.enviar, agora: () => AGORA, aoExpirar: () => avisos++ });
  await s3.entrar('dono@x', 'certa');
  f3.validos.clear();
  await assert.rejects(s3.renovar(), { name: 'SessaoExpirada' });
  assert.equal(avisos, 1);
});

test('login de atendente é recusado e a sessão aberta por ele é encerrada', async () => {
  const arm = memoria();
  const f = apiFalsa({ papel: 'ATENDENTE' });
  const s = criarSessao({ armazenamento: arm, enviar: f.enviar, agora: () => AGORA });
  await assert.rejects(s.entrar('ana@x', 'certa'), { codigo: 'SO_DONO' });
  assert.equal(arm.getItem(CHAVE_REFRESH), null);
  assert.ok(f.chamadas.some((c) => c.rota === '/auth/logout'));
  assert.equal(s.usuario, null);
});

test('senha errada propaga o 401 do login sem gravar nada', async () => {
  const arm = memoria();
  const s = criarSessao({ armazenamento: arm, enviar: apiFalsa().enviar, agora: () => AGORA });
  await assert.rejects(s.entrar('dono@x', 'errada'), { status: 401 });
  assert.equal(arm.getItem(CHAVE_REFRESH), null);
});

test('sair chama /auth/logout com o refresh e limpa', async () => {
  const arm = memoria();
  const f = apiFalsa();
  const s = criarSessao({ armazenamento: arm, enviar: f.enviar, agora: () => AGORA });
  await s.entrar('dono@x', 'certa');
  await s.sair();
  assert.equal(arm.getItem(CHAVE_REFRESH), null);
  assert.equal(s.usuario, null);
  await assert.rejects(s.chamar('GET', '/x'), { name: 'SessaoExpirada' });
});
