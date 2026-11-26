import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarPedido,
  casaComBusca,
  destacarTrecho,
  filtrarPedidos,
  minutosDeAtraso,
  ordenarPedidos,
  prazoDoPedido,
  tituloDoPedido,
  tocaAlerta,
  entraNoPainel,
  SELO_ORIGEM,
  textoRegistro,
} from '../src/renderer/src/lib/painel.js';

const pedido = (extra = {}) => ({
  id: 1,
  numeroDia: 20,
  canal: 'WHATSAPP',
  status: 'CONFIRMADO',
  nomeCliente: 'Lílian',
  telefone: '43999990001',
  encomenda: false,
  retirarNoBalcao: false,
  agendadoPara: null,
  tempoEstimadoMin: 40,
  criadoEm: '2026-11-14T23:00:00.000Z', // 20:00 em Brasília
  dataRef: '2026-11-14',
  ...extra,
});

describe('painel de delivery', () => {
  test('título: tipo, número, balcão e cliente', () => {
    assert.equal(tituloDoPedido(pedido()), 'Delivery #20 - Lílian');
    assert.equal(tituloDoPedido(pedido({ encomenda: true, retirarNoBalcao: true, numeroDia: 18, nomeCliente: 'Daiane' })),
      'Encomenda #18 (Balcão) - Daiane');
  });

  test('prazo e atraso: delivery pelo tempo informado, encomenda pelo horário; encerrado não atrasa', () => {
    const p = pedido();
    assert.equal(prazoDoPedido(p).toISOString(), '2026-11-14T23:40:00.000Z');
    assert.equal(minutosDeAtraso(p, new Date('2026-11-14T23:39:00Z')), 0);
    assert.equal(minutosDeAtraso(p, new Date('2026-11-14T23:52:30Z')), 12);
    assert.equal(minutosDeAtraso({ ...p, status: 'FINALIZADO' }, new Date('2026-11-15T03:00:00Z')), 0);
    assert.equal(minutosDeAtraso({ ...p, tempoEstimadoMin: null }, new Date('2026-11-15T03:00:00Z')), 0);
    const e = pedido({ encomenda: true, agendadoPara: '2026-11-15T01:00:00.000Z', tempoEstimadoMin: null });
    assert.equal(minutosDeAtraso(e, new Date('2026-11-15T01:05:00Z')), 5);
    assert.equal(minutosDeAtraso({ ...e, status: 'EM_PREPARO' }, new Date('2026-11-15T01:05:00Z')), 5);
  });

  test('busca: nome sem acento, número do pedido, trecho do telefone com ou sem formatação', () => {
    const p = pedido();
    assert.ok(casaComBusca(p, 'lilian'));
    assert.ok(casaComBusca(p, 'LÍL'));
    assert.ok(casaComBusca(p, '20'));
    assert.ok(casaComBusca(p, '#20'));
    assert.ok(casaComBusca(p, '9999'));
    assert.ok(casaComBusca(p, '(43) 99999'));
    assert.ok(!casaComBusca(p, '21'));
    assert.ok(!casaComBusca(p, 'maria'));
    assert.ok(casaComBusca(p, '  '));
  });

  test('filtros: em andamento (padrão), status, tipo e busca juntos', () => {
    const lista = [
      pedido({ id: 1 }),
      pedido({ id: 2, status: 'EM_PREPARO' }),
      pedido({ id: 3, status: 'SAIU_ENTREGA', encomenda: true }),
      pedido({ id: 4, status: 'FINALIZADO' }),
      pedido({ id: 5, status: 'CANCELADO', nomeCliente: 'Maria' }),
    ];
    const ids = (f) => filtrarPedidos(lista, f).map((p) => p.id);
    assert.deepEqual(ids({}), [1, 2, 3]);
    assert.deepEqual(ids({ status: 'aberto' }), [1]);
    assert.deepEqual(ids({ status: 'preparo' }), [2]);
    assert.deepEqual(ids({ status: 'finalizado' }), [4]);
    assert.deepEqual(ids({ status: 'todos', tipo: 'encomenda' }), [3]);
    assert.deepEqual(ids({ status: 'todos', tipo: 'delivery', busca: 'maria' }), [5]);
  });

  test('ordem: o último que chegou aparece primeiro (prazo não importa), empate pelo id maior', () => {
    const lista = [
      pedido({ id: 1, criadoEm: '2026-11-14T22:00:00.000Z', tempoEstimadoMin: 10 }),
      pedido({ id: 2, criadoEm: '2026-11-14T22:40:00.000Z', tempoEstimadoMin: 60 }),
      pedido({ id: 3, encomenda: true, agendadoPara: '2026-11-14T22:45:00.000Z', criadoEm: '2026-11-14T22:20:00.000Z', tempoEstimadoMin: null }),
      pedido({ id: 4, criadoEm: '2026-11-14T22:40:00.000Z' }),
    ];
    assert.deepEqual(ordenarPedidos(lista).map((p) => p.id), [4, 2, 3, 1]);
  });

  test('evento do socket: só site/WhatsApp do dia na tela; atualização mantém quem registrou', () => {
    let lista = [pedido({ id: 1, registradoPor: 'Ana' })];
    lista = aplicarPedido(lista, { ...pedido({ id: 1, status: 'EM_PREPARO' }), registradoPor: null });
    assert.equal(lista[0].status, 'EM_PREPARO');
    assert.equal(lista[0].registradoPor, 'Ana');
    assert.equal(aplicarPedido(lista, pedido({ id: 2, canal: 'SALAO' }), '2026-11-14').length, 1);
    assert.equal(aplicarPedido(lista, pedido({ id: 3, dataRef: '2026-11-13' }), '2026-11-14').length, 1);
    assert.equal(aplicarPedido(lista, pedido({ id: 4 }), '2026-11-14').length, 2);
    assert.ok(tocaAlerta({ canal: 'SITE' }));
    assert.ok(tocaAlerta({ canal: 'APP' }));
    assert.ok(!tocaAlerta({ canal: 'WHATSAPP' }));
  });

  test('painel: todos os canais menos o salão e os status ocultos; selo e registro por origem', () => {
    assert.ok(entraNoPainel(pedido({ canal: 'APP' })));
    assert.ok(entraNoPainel(pedido({ canal: 'SITE' })));
    assert.ok(entraNoPainel(pedido({ canal: 'WHATSAPP' })));
    assert.ok(entraNoPainel(pedido({ canal: 'CANAL_DO_FUTURO' })), 'canal novo aparece');
    assert.ok(!entraNoPainel(pedido({ canal: 'SALAO' })));
    assert.ok(!entraNoPainel(pedido({ canal: 'APP', status: 'AGUARDANDO_PAGAMENTO' })));
    assert.ok(!entraNoPainel(pedido({ canal: 'APP', status: 'EXPIRADO' })));
    assert.equal(SELO_ORIGEM.APP, 'App');
    assert.equal(SELO_ORIGEM.SITE, 'Site');
    assert.equal(SELO_ORIGEM.WHATSAPP, undefined);
    assert.equal(textoRegistro({ canal: 'APP' }), 'Registrado pelo app');
    assert.equal(textoRegistro({ canal: 'SITE' }), 'Registrado pelo site');
    assert.equal(textoRegistro({ canal: 'WHATSAPP', registradoPor: 'Ana' }), 'Registrado por: Ana');
  });

  test('destaque da busca: sem acento, e dígitos dentro do telefone formatado', () => {
    assert.deepEqual(destacarTrecho('João Silva', 'joao'), [
      { texto: 'João', destaque: true },
      { texto: ' Silva', destaque: false },
    ]);
    assert.deepEqual(destacarTrecho('(43) 99999-0001', '9990001'), [
      { texto: '(43) 99', destaque: false },
      { texto: '999-0001', destaque: true },
    ]);
    assert.deepEqual(destacarTrecho('X-Bacon', 'zzz'), [{ texto: 'X-Bacon', destaque: false }]);
    assert.deepEqual(destacarTrecho('X-Bacon', ''), [{ texto: 'X-Bacon', destaque: false }]);
  });
});
