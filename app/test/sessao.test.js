import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAVE_SESSAO,
  carregarToken,
  salvarToken,
  apagarToken,
  etapaCheckout,
  sessaoExpirou,
} from '../src/logica/sessao.js';

function storageFalso(inicial = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    removeItem: (k) => dados.delete(k),
    dados,
  };
}

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.assinatura_ok-123';

test('token salvo volta igual; apagar remove', async () => {
  const s = storageFalso();
  assert.equal(await carregarToken(s), null);
  assert.equal(await salvarToken(JWT, s), true);
  assert.equal(s.dados.get(CHAVE_SESSAO), JWT);
  assert.equal(await carregarToken(s), JWT);
  await apagarToken(s);
  assert.equal(await carregarToken(s), null);
});

test('valor que não parece JWT é ignorado', async () => {
  assert.equal(await carregarToken(storageFalso({ [CHAVE_SESSAO]: 'lixo' })), null);
  assert.equal(await carregarToken(storageFalso({ [CHAVE_SESSAO]: '{"a":1}' })), null);
});

test('storage que lança não derruba o app', async () => {
  const quebrado = {
    getItem() {
      throw new Error('bloqueado');
    },
    setItem() {
      throw new Error('cota');
    },
    removeItem() {
      throw new Error('bloqueado');
    },
  };
  assert.equal(await carregarToken(quebrado), null);
  assert.equal(await salvarToken(JWT, quebrado), false);
  await assert.doesNotReject(() => apagarToken(quebrado));
});

test('etapaCheckout: sem login → login; logado sem telefone → telefone; com telefone → pronto', () => {
  assert.equal(etapaCheckout({ status: 'anonimo', cliente: null }), 'login');
  assert.equal(etapaCheckout({ status: 'carregando', cliente: null }), 'carregando');
  assert.equal(
    etapaCheckout({ status: 'logado', cliente: { telefone: null, precisaTelefone: true } }),
    'telefone',
  );
  assert.equal(
    etapaCheckout({ status: 'logado', cliente: { telefone: '43999990000', precisaTelefone: false } }),
    'pronto',
  );
});

test('sessaoExpirou só para 401', () => {
  assert.equal(sessaoExpirou({ status: 401 }), true);
  assert.equal(sessaoExpirou({ status: 422 }), false);
  assert.equal(sessaoExpirou(new TypeError('rede')), false);
});
