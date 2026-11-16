import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { agruparItens } from '@restaurante/shared/itens';
import {
  aplicarComanda,
  idParaRemover,
  contarItens,
  filtrarComandas,
  lerGramas,
  teclarPeso,
  tempoAberta,
  valorPorPeso,
} from '../src/renderer/src/lib/salao.js';

const comanda = (id, nomeCliente, extra = {}) => ({
  id,
  nomeCliente,
  mesaRotulo: null,
  canal: 'SALAO',
  status: 'ABERTO',
  criadoEm: `2026-11-13T15:0${id}:00.000Z`,
  itens: [],
  ...extra,
});

describe('salão: busca e lista de comandas', () => {
  const lista = [comanda(1, 'João Silva'), comanda(2, 'MARIA'), comanda(3, 'Zé', { mesaRotulo: '12' })];

  test('busca pelo nome sem acento e sem diferenciar maiúsculas; também pela mesa', () => {
    assert.deepEqual(filtrarComandas(lista, 'joao').map((c) => c.id), [1]);
    assert.deepEqual(filtrarComandas(lista, '  mAr ').map((c) => c.id), [2]);
    assert.deepEqual(filtrarComandas(lista, 'ze').map((c) => c.id), [3]);
    assert.deepEqual(filtrarComandas(lista, '12').map((c) => c.id), [3]);
    assert.deepEqual(filtrarComandas(lista, '').map((c) => c.id), [1, 2, 3]);
    assert.deepEqual(filtrarComandas(lista, 'pedro'), []);
  });

  test('aplicarComanda: entra em ordem de abertura, atualiza, sai quando fecha; ignora delivery', () => {
    let l = aplicarComanda([], comanda(2, 'B'));
    l = aplicarComanda(l, comanda(1, 'A'));
    assert.deepEqual(l.map((c) => c.id), [1, 2]);
    l = aplicarComanda(l, comanda(1, 'A', { totalCentavos: 500 }));
    assert.equal(l[0].totalCentavos, 500);
    l = aplicarComanda(l, comanda(2, 'B', { status: 'FINALIZADO' }));
    assert.deepEqual(l.map((c) => c.id), [1]);
    assert.equal(aplicarComanda(l, comanda(9, 'Delivery', { canal: 'SITE' })), l);
  });

  test('tempo aberta e contagem de itens', () => {
    const criado = '2026-11-13T15:00:00.000Z';
    assert.equal(tempoAberta(criado, new Date('2026-11-13T15:00:30Z')), 'agora');
    assert.equal(tempoAberta(criado, new Date('2026-11-13T15:12:00Z')), '12 min');
    assert.equal(tempoAberta(criado, new Date('2026-11-13T16:05:00Z')), '1 h 05');
    assert.equal(tempoAberta(criado, new Date('2026-11-13T14:00:00Z')), 'agora', 'relógio atrasado não fica negativo');
    assert.equal(contarItens({ itens: [{ quantidade: 2 }, { quantidade: 1, pesoGramas: 487 }] }), 3);
  });
});

describe('salão: teclado de peso', () => {
  test('digita, apaga e limpa; sem zero à esquerda; máximo 5000 g', () => {
    let t = '';
    for (const tecla of ['0', '4', '8', '7']) t = teclarPeso(t, tecla);
    assert.equal(t, '487');
    assert.equal(teclarPeso(t, 'apagar'), '48');
    assert.equal(teclarPeso(t, 'limpar'), '');
    assert.equal(teclarPeso('500', '0'), '5000');
    assert.equal(teclarPeso('5000', '1'), '5000', 'não passa de 4 dígitos');
    assert.equal(teclarPeso('600', '0'), '600', '6000 g passa do máximo');
    assert.equal(teclarPeso('12', 'x'), '12');
  });

  test('lerGramas e valor: 487 g a R$ 59,90/kg = R$ 29,17', () => {
    assert.equal(lerGramas('487'), 487);
    assert.equal(lerGramas(''), null);
    assert.equal(lerGramas('0'), null);
    assert.equal(lerGramas('5001'), null);
    assert.equal(valorPorPeso(5990, 487), 2917);
    assert.equal(valorPorPeso(5990, 1000), 5990);
  });
});

describe('salão: itens agrupados na tela da comanda', () => {
  const refri = (id, extra = {}) => ({
    id, produtoId: 22, nome: 'Refrigerante Lata', quantidade: 1, pesoGramas: null,
    precoUnitarioCentavos: 500, totalCentavos: 500, observacao: null, ...extra,
  });

  test('4 toques viram "4×"; o × remove uma unidade por vez (a mais recente) até sumir', () => {
    let itens = [refri(1), { ...refri(2), produtoId: 30, nome: 'Prato por kg', pesoGramas: 487, totalCentavos: 2917 }, refri(3), refri(4), refri(5)];
    let [linha] = agruparItens(itens);
    assert.equal(linha.quantidade, 4);
    assert.equal(linha.totalCentavos, 2000);
    for (const esperado of [3, 2, 1]) {
      const id = idParaRemover(linha);
      itens = itens.filter((i) => i.id !== id); // a API marca canceladoEm e não devolve mais o item
      [linha] = agruparItens(itens);
      assert.equal(linha.quantidade, esperado);
    }
    assert.equal(idParaRemover(linha), 1);
    itens = itens.filter((i) => i.id !== 1);
    assert.deepEqual(agruparItens(itens).map((l) => l.nome), ['Prato por kg']);
  });

  test('item com observação fica em linha própria e remove só ele', () => {
    const linhas = agruparItens([refri(1), refri(2, { observacao: 'bem gelado' }), refri(3)]);
    assert.deepEqual(linhas.map((l) => [l.quantidade, l.observacao]), [[2, null], [1, 'bem gelado']]);
    assert.equal(idParaRemover(linhas[1]), 2);
  });
});
