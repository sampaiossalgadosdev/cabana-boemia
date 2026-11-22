import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  celularValido,
  codigoCompleto,
  interpretarErroCelular,
  limparCodigo,
  segundosParaReenviar,
  textoEspera,
  textoReenvio,
  ERRO_REDE_CELULAR,
} from '../src/logica/loginCelular.js';
import { precisaPedirNome } from '../src/logica/plataforma.js';
import { etapaCheckout, carregarSessao, CHAVE_SESSAO } from '../src/logica/sessao.js';
import { ErroApi } from '../src/lib/api.js';

/** Login com celular: regras da tela (sem React Native). */

test('celular: mesma regra do shared (DDD + 9 dígitos, com ou sem máscara)', () => {
  assert.equal(celularValido('(43) 99999-0001'), true);
  assert.equal(celularValido('+55 43 99999-0001'), true);
  assert.equal(celularValido('(43) 3333-1234'), false, 'fixo');
  assert.equal(celularValido('(43) 99999'), false, 'incompleto');
  assert.equal(celularValido(''), false);
});

test('código: só números, no máximo 6; colar com espaço ou traço vale', () => {
  assert.equal(limparCodigo('123 456'), '123456');
  assert.equal(limparCodigo('12-34-56-78'), '123456');
  assert.equal(limparCodigo('ab1'), '1');
  assert.equal(limparCodigo(null), '');
  assert.equal(codigoCompleto('123456'), true);
  assert.equal(codigoCompleto('12345'), false);
});

test('reenvio: contador de 60 s', () => {
  const agora = 1_000_000;
  assert.equal(segundosParaReenviar(0, agora), 0);
  assert.equal(segundosParaReenviar(agora + 60_000, agora), 60);
  assert.equal(segundosParaReenviar(agora + 44_100, agora), 45, 'arredonda para cima');
  assert.equal(segundosParaReenviar(agora - 1, agora), 0);
  assert.equal(textoReenvio(0), 'Reenviar código');
  assert.equal(textoReenvio(60), 'Reenviar código em 1:00');
  assert.equal(textoReenvio(5), 'Reenviar código em 0:05');
});

test('erros claros: número inválido, código errado, muitas tentativas, indisponível, sem rede', () => {
  const erro = (status, codigo, detalhes) => new ErroApi(status, { mensagem: 'da API', codigo, detalhes });

  assert.equal(interpretarErroCelular(erro(400, 'TELEFONE_INVALIDO')).campo, 'celular');
  assert.match(interpretarErroCelular(erro(400, 'TELEFONE_INVALIDO')).mensagem, /Número inválido/);
  assert.deepEqual(interpretarErroCelular(erro(401, 'CODIGO_INVALIDO')), {
    mensagem: 'Código errado. Confira os 6 números e tente de novo.',
    campo: 'codigo',
  });
  assert.match(interpretarErroCelular(erro(503, 'SMS_INDISPONIVEL')).mensagem, /SMS ainda não disponível/);

  const aguarde = interpretarErroCelular(erro(429, 'AGUARDE_REENVIO', { segundos: 42 }));
  assert.equal(aguarde.esperarSegundos, 42, 'o contador passa a valer o que a API mandou');
  const hora = interpretarErroCelular(erro(429, 'MUITOS_ENVIOS', { segundos: 1800 }));
  assert.match(hora.mensagem, /Muitas tentativas\. Aguarde 30 minutos/);
  assert.equal(hora.esperarSegundos, 1800);
  const codigos = interpretarErroCelular(erro(429, 'MUITAS_TENTATIVAS', { segundos: 300 }));
  assert.match(codigos.mensagem, /Aguarde 5 minutos/);
  assert.equal(codigos.esperarSegundos, undefined, 'tentativas de código não mexem no contador do reenvio');

  assert.deepEqual(interpretarErroCelular(new TypeError('Network request failed')), { mensagem: ERRO_REDE_CELULAR, campo: 'geral' });
  assert.equal(interpretarErroCelular(erro(500, 'ERRO_INTERNO')).mensagem, 'da API');
  assert.equal(textoEspera(1), '1 segundo');
  assert.equal(textoEspera(61), '2 minutos');
});

test('depois de entrar: aceite primeiro, depois o nome (quem entrou só pelo celular)', () => {
  const novo = { telefone: '43999990001', precisaTelefone: false, precisaNome: true, precisaAceite: true };
  assert.equal(precisaPedirNome('logado', novo), false, 'o aceite vem antes');
  assert.equal(precisaPedirNome('logado', { ...novo, precisaAceite: false }), true);
  assert.equal(precisaPedirNome('logado', { ...novo, precisaAceite: false, precisaNome: false }), false);
  assert.equal(precisaPedirNome('anonimo', null), false);
  // checkout sem nome: o passo de nome e telefone
  assert.equal(etapaCheckout({ status: 'logado', cliente: { ...novo, precisaAceite: false } }), 'telefone');
});

test('sessão do login com celular guarda o provedor "telefone"', async () => {
  const JWT = 'aaa.bbb.ccc';
  const cofre = { getItem: async (k) => (k === CHAVE_SESSAO ? JSON.stringify({ token: JWT, refreshToken: 'r'.repeat(43), provedor: 'telefone' }) : null) };
  assert.deepEqual(await carregarSessao(cofre), { token: JWT, refreshToken: 'r'.repeat(43), provedor: 'telefone' });
});

test('rotas do login com celular', async () => {
  const { enviarCodigoTelefone, entrarComTelefone } = await import('../src/lib/api.js');
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opcoes) => {
    chamadas.push({ url, metodo: opcoes.method, corpo: JSON.parse(opcoes.body) });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  try {
    await enviarCodigoTelefone('43999990001');
    await entrarComTelefone({ telefone: '43999990001', codigo: '123456', aceite: '2026-11-20' });
    await entrarComTelefone({ telefone: '43999990001', codigo: '123456' });
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(chamadas.map((c) => `${c.metodo} ${c.url.replace(/^.*\/api/, '')}`), [
    'POST /cliente/auth/telefone/enviar',
    'POST /cliente/auth/telefone/entrar',
    'POST /cliente/auth/telefone/entrar',
  ]);
  assert.deepEqual(chamadas[0].corpo, { telefone: '43999990001' });
  assert.deepEqual(chamadas[1].corpo, { telefone: '43999990001', codigo: '123456', refresh: true, aceite: '2026-11-20' });
  assert.equal('aceite' in chamadas[2].corpo, false);
});
