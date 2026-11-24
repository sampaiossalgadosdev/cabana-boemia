import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codigoDoErroGoogle, interpretarErroGoogle, linhaDoLogGoogle } from '../src/logica/erroGoogle.js';

/** Erro do login com Google: texto da tela com o código e linha do log. */

// Mesmos valores que a biblioteca exporta no Android.
const statusCodes = {
  SIGN_IN_CANCELLED: '12501',
  IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
};
const isErrorWithCode = (e) => e != null && typeof e === 'object' && 'code' in e;
const bib = { statusCodes, isErrorWithCode };
const erro = (code, message = 'falhou') => Object.assign(new Error(message), { code });

test('DEVELOPER_ERROR (10): "ainda não configurado" com o código', () => {
  assert.deepEqual(interpretarErroGoogle(erro('10'), bib), {
    mensagem: 'Login com Google ainda não configurado para esta versão do app (código 10).',
    cancelado: false,
  });
  assert.equal(
    interpretarErroGoogle(erro('DEVELOPER_ERROR'), bib).mensagem,
    'Login com Google ainda não configurado para esta versão do app (código DEVELOPER_ERROR).',
  );
  // Número em vez de texto também vale.
  assert.match(interpretarErroGoogle(erro(10), bib).mensagem, /ainda não configurado.*\(código 10\)/);
});

test('outro código: mensagem genérica com o código', () => {
  assert.deepEqual(interpretarErroGoogle(erro('12500'), bib), {
    mensagem: 'Não foi possível entrar com o Google. Tente de novo (código 12500).',
    cancelado: false,
  });
  assert.equal(
    interpretarErroGoogle(new Error('sem code'), bib).mensagem,
    'Não foi possível entrar com o Google. Tente de novo (código sem código).',
  );
});

test('cancelado, em andamento e Play Services: como antes', () => {
  assert.deepEqual(interpretarErroGoogle(erro('12501'), bib), { mensagem: 'Login cancelado.', cancelado: true });
  assert.deepEqual(interpretarErroGoogle(erro('ASYNC_OP_IN_PROGRESS'), bib), {
    mensagem: 'Já existe um login em andamento.',
    cancelado: true,
  });
  assert.deepEqual(interpretarErroGoogle(erro('PLAY_SERVICES_NOT_AVAILABLE'), bib), {
    mensagem: 'O Google Play Services está desatualizado ou indisponível neste aparelho.',
    cancelado: false,
  });
});

test('linha do log: prefixo [login-google], código e mensagem', () => {
  assert.equal(linhaDoLogGoogle(erro('10', 'DEVELOPER_ERROR: Follow troubleshooting')), '[login-google] código 10: DEVELOPER_ERROR: Follow troubleshooting');
  assert.equal(codigoDoErroGoogle(null), 'sem código');
  assert.equal(linhaDoLogGoogle('texto'), '[login-google] código sem código: texto');
});
