import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAVE_SESSAO,
  carregarSessao,
  salvarSessao,
  apagarSessao,
  expiraEm,
  precisaRenovar,
  etapaCheckout,
  sessaoExpirou,
} from '../src/logica/sessao.js';
import { usarCofre, usarArmazenamento } from '../src/logica/armazenamento.js';

/** Cofre em memória com a interface do adaptador do SecureStore (Promise). */
function cofreFalso(inicial = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: async (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: async (k, v) => void dados.set(k, String(v)),
    removeItem: async (k) => void dados.delete(k),
    dados,
  };
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtCom = (payload) => `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura_ok-123`;
const JWT = jwtCom({ sub: '1', exp: 2_000_000_000 });
const REFRESH = 'r'.repeat(43);

test('chave do cofre só com caracteres aceitos pelo SecureStore', () => {
  assert.match(CHAVE_SESSAO, /^[\w.-]+$/);
});

test('sessão salva volta igual; apagar remove', async () => {
  const c = cofreFalso();
  assert.equal(await carregarSessao(c), null);
  assert.equal(await salvarSessao({ token: JWT, refreshToken: REFRESH, provedor: 'apple' }, c), true);
  assert.deepEqual(await carregarSessao(c), { token: JWT, refreshToken: REFRESH, provedor: 'apple' });
  await apagarSessao(c);
  assert.equal(await carregarSessao(c), null);
});

test('valor corrompido ou sem JWT = sem sessão; refresh curto e provedor estranho viram null', async () => {
  assert.equal(await carregarSessao(cofreFalso({ [CHAVE_SESSAO]: 'lixo' })), null);
  assert.equal(await carregarSessao(cofreFalso({ [CHAVE_SESSAO]: '{"token":"x"}' })), null);
  const s = await carregarSessao(cofreFalso({ [CHAVE_SESSAO]: JSON.stringify({ token: JWT, refreshToken: 'curto', provedor: 'facebook' }) }));
  assert.deepEqual(s, { token: JWT, refreshToken: null, provedor: null });
});

test('sem cofre injetado: nada é lido nem gravado (nunca cai no AsyncStorage)', async () => {
  const asyncStorage = cofreFalso();
  usarArmazenamento(asyncStorage);
  usarCofre(null);
  assert.equal(await salvarSessao({ token: JWT, refreshToken: REFRESH }), false);
  assert.equal(asyncStorage.dados.size, 0, 'o token não foi parar no AsyncStorage');

  const cofre = cofreFalso();
  usarCofre(cofre);
  assert.equal(await salvarSessao({ token: JWT, refreshToken: REFRESH }), true);
  assert.equal(cofre.dados.size, 1);
  assert.equal(asyncStorage.dados.size, 0);
  usarCofre(null);
  usarArmazenamento(null);
});

test('cofre que lança não derruba o app', async () => {
  const quebrado = {
    getItem: async () => {
      throw new Error('keystore');
    },
    setItem: async () => {
      throw new Error('keystore');
    },
    removeItem: async () => {
      throw new Error('keystore');
    },
  };
  assert.equal(await carregarSessao(quebrado), null);
  assert.equal(await salvarSessao({ token: JWT }, quebrado), false);
  await assert.doesNotReject(() => apagarSessao(quebrado));
});

test('expiraEm lê o "exp" do JWT; precisaRenovar quando falta menos de um dia', () => {
  const agora = 1_800_000_000_000;
  const umaHora = jwtCom({ exp: agora / 1000 + 3600 });
  const tresDias = jwtCom({ exp: agora / 1000 + 3 * 86400 });
  assert.equal(expiraEm(tresDias), agora + 3 * 86400 * 1000);
  assert.equal(precisaRenovar(umaHora, agora), true);
  assert.equal(precisaRenovar(tresDias, agora), false);
  assert.equal(expiraEm('nao.e.jwt'), null);
  assert.equal(precisaRenovar('nao.e.jwt', agora), true, 'ilegível: renova');
});

test('etapaCheckout: carregando, erro, login, telefone, pronto', () => {
  assert.equal(etapaCheckout({ status: 'anonimo', cliente: null }), 'login');
  assert.equal(etapaCheckout({ status: 'carregando', cliente: null }), 'carregando');
  assert.equal(etapaCheckout({ status: 'erro', cliente: null }), 'erro');
  assert.equal(etapaCheckout({ status: 'logado', cliente: { telefone: null, precisaTelefone: true } }), 'telefone');
  assert.equal(etapaCheckout({ status: 'logado', cliente: { telefone: '43999990000', precisaTelefone: false } }), 'pronto');
});

test('sessaoExpirou só para 401', () => {
  assert.equal(sessaoExpirou({ status: 401 }), true);
  assert.equal(sessaoExpirou({ status: 422 }), false);
  assert.equal(sessaoExpirou(new TypeError('rede')), false);
});
