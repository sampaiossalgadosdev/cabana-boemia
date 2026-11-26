import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisoDesconectar, descreverSituacao, mensagemDoRetorno, motivoInterruptorTravado } from '../src/lib/pagamentoOnline.js';

test('situação da conta: conectada (com a conta), expirada e não conectada', () => {
  assert.deepEqual(descreverSituacao({ situacao: 'CONECTADA', conta: '111' }), {
    rotulo: 'Conectada',
    classe: 'etiqueta--ok',
    texto: 'Conta Mercado Pago 111.',
  });
  assert.equal(descreverSituacao({ situacao: 'EXPIRADA', conta: '111' }).classe, 'etiqueta--alerta');
  assert.match(descreverSituacao({ situacao: 'EXPIRADA', conta: '111' }).texto, /Conecte de novo/);
  assert.equal(descreverSituacao({ situacao: 'NAO_CONECTADA' }).rotulo, 'Não conectada');
});

test('interruptor: só libera com a conta conectada e a flag global ligada', () => {
  assert.equal(motivoInterruptorTravado({ situacao: 'CONECTADA', flagGlobal: true }), null);
  assert.match(motivoInterruptorTravado({ situacao: 'CONECTADA', flagGlobal: false }), /ainda não foi liberado/);
  assert.match(motivoInterruptorTravado({ situacao: 'EXPIRADA', flagGlobal: true }), /Conecte a conta/);
  assert.match(motivoInterruptorTravado({ situacao: 'NAO_CONECTADA', flagGlobal: true }), /Conecte a conta/);
});

test('mensagem da volta do Mercado Pago', () => {
  assert.deepEqual(mensagemDoRetorno('?mp=conectada'), { tipo: 'ok', texto: 'Conta Mercado Pago conectada.' });
  assert.match(mensagemDoRetorno('?mp=erro&motivo=CONTA_EM_OUTRA_LOJA').texto, /outra loja/);
  assert.match(mensagemDoRetorno('?mp=erro&motivo=STATE_EXPIRADO').texto, /10 minutos/);
  assert.match(mensagemDoRetorno('?mp=erro&motivo=QUALQUER').texto, /Não foi possível conectar/);
  assert.equal(mensagemDoRetorno(''), null);
  assert.equal(mensagemDoRetorno('?x=1'), null);
});

test('aviso antes de desconectar: com e sem pagamentos pendentes', () => {
  assert.equal(avisoDesconectar(0), 'A loja deixa de receber pagamento online até conectar de novo.');
  assert.match(avisoDesconectar(1), /^Há 1 pagamento pendente: ele será cancelado/);
  assert.match(avisoDesconectar(3), /^Há 3 pagamentos pendentes: eles serão cancelados/);
});
