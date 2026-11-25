import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formasDePagamento, formaNaEntregaPermitida } from '../src/formasPagamento.js';

test('motoboy próprio sem online: exatamente as formas de hoje', () => {
  assert.deepEqual(formasDePagamento({ modoEntrega: 'PROPRIO' }), {
    naEntrega: ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'],
    online: [],
  });
  assert.deepEqual(formasDePagamento(), formasDePagamento({ modoEntrega: 'PROPRIO', onlineDisponivel: false }));
});

test('motoboy próprio com a loja conectada: as de hoje mais Pix e cartão online', () => {
  assert.deepEqual(formasDePagamento({ modoEntrega: 'PROPRIO', onlineDisponivel: true }), {
    naEntrega: ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'],
    online: ['PIX', 'CARTAO_ONLINE'],
  });
});

test('entregador da plataforma: só dinheiro na entrega; online quando disponível', () => {
  assert.deepEqual(formasDePagamento({ modoEntrega: 'PLATAFORMA' }), { naEntrega: ['DINHEIRO'], online: [] });
  assert.deepEqual(formasDePagamento({ modoEntrega: 'PLATAFORMA', onlineDisponivel: true }), {
    naEntrega: ['DINHEIRO'],
    online: ['PIX', 'CARTAO_ONLINE'],
  });
});

test('forma na entrega: plataforma recusa Pix e maquininha; próprio aceita todas', () => {
  for (const forma of ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']) {
    assert.equal(formaNaEntregaPermitida({ modoEntrega: 'PROPRIO', forma }), true);
    assert.equal(formaNaEntregaPermitida({ modoEntrega: 'PLATAFORMA', forma }), forma === 'DINHEIRO');
  }
  assert.equal(formaNaEntregaPermitida({ modoEntrega: 'PROPRIO', forma: 'BOLETO' }), false);
});

test('plataforma: retirada no balcão e pago agora no balcão aceitam todas as formas', () => {
  assert.equal(formaNaEntregaPermitida({ modoEntrega: 'PLATAFORMA', forma: 'DEBITO', comEntrega: false }), true);
  assert.equal(formaNaEntregaPermitida({ modoEntrega: 'PLATAFORMA', forma: 'PIX', pagoAgora: true }), true);
});
