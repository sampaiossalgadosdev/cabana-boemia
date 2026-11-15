import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarPedido, filaDaApi, removerPedido, tocaAlerta } from '../src/renderer/src/lib/fila.js';

const pedido = (id, extra = {}) => ({
  id,
  numeroDia: id,
  canal: 'SITE',
  status: 'CONFIRMADO',
  criadoEm: `2026-11-14T23:0${id}:00.000Z`,
  ...extra,
});

describe('fila de pedidos (renderer)', () => {
  test('pedido novo entra na ordem de chegada; repetido não duplica', () => {
    let f = filaDaApi([pedido(2), pedido(1)]);
    assert.deepEqual(f.map((p) => p.id), [1, 2]);
    f = aplicarPedido(f, pedido(3, { canal: 'WHATSAPP' }));
    f = aplicarPedido(f, pedido(3, { canal: 'WHATSAPP' }));
    assert.deepEqual(f.map((p) => p.id), [1, 2, 3]);
  });

  test('salão e pedidos encerrados não entram; finalizado sai', () => {
    let f = filaDaApi([pedido(1), pedido(2)]);
    f = aplicarPedido(f, pedido(3, { canal: 'SALAO', status: 'ABERTO' }));
    assert.deepEqual(f.map((p) => p.id), [1, 2]);
    f = aplicarPedido(f, pedido(1, { status: 'FINALIZADO' }));
    assert.deepEqual(f.map((p) => p.id), [2]);
    f = aplicarPedido(f, pedido(2, { status: 'CANCELADO' }));
    assert.deepEqual(f, []);
    assert.deepEqual(removerPedido([pedido(5)], 5), []);
  });

  test('alerta sonoro só para pedido do site', () => {
    assert.equal(tocaAlerta(pedido(1)), true);
    assert.equal(tocaAlerta(pedido(1, { canal: 'WHATSAPP' })), false);
  });
});
