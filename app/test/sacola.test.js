import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adicionar } from '../src/logica/carrinho.js';
import {
  limiteDaLinha,
  sugestoes,
  enderecoDaTaxa,
  resumoDaSacola,
  rotuloItens,
  produtosDoCardapio,
} from '../src/logica/sacola.js';

const XBACON = { id: 6, nome: 'X-Bacon', precoCentavos: 1600, tipoPreco: 'UNIDADE', maxSacola: 4, sugerirNaSacola: false };
const COCA = { id: 23, nome: 'Coca-Cola 1L', precoCentavos: 900, tipoPreco: 'UNIDADE', maxSacola: 2, sugerirNaSacola: false };
const GUARANA = { id: 24, nome: 'Guaraná 2L', precoCentavos: 1000, tipoPreco: 'UNIDADE', maxSacola: 20, sugerirNaSacola: false };
const PUDIM = { id: 40, nome: 'Pudim', precoCentavos: 800, tipoPreco: 'UNIDADE', maxSacola: 20, sugerirNaSacola: true };
const cardapio = (extra = {}) => ({
  aberto: true,
  categorias: [
    { id: 1, nome: 'Lanches', produtos: [XBACON] },
    { id: 4, nome: 'Bebidas', produtos: [COCA, GUARANA] },
    ...(extra.sobremesas ? [{ id: 5, nome: 'Sobremesas', produtos: [PUDIM] }] : []),
  ],
});

test('limiteDaLinha: saldo do produto menos as outras linhas do mesmo produto; até 20', () => {
  let itens = adicionar([], XBACON, 2, 'sem cebola');
  itens = adicionar(itens, XBACON, 1);
  const [comObs, semObs] = itens;
  assert.equal(limiteDaLinha(comObs, itens, XBACON), 3, '4 − 1 da outra linha');
  assert.equal(limiteDaLinha(semObs, itens, XBACON), 2, '4 − 2 da outra linha');
  assert.equal(limiteDaLinha(semObs, itens, undefined), 18, 'sem info: só o máximo por item (20 − 2)');
  assert.equal(limiteDaLinha(semObs, itens, { maxSacola: null }), 18);
  assert.equal(limiteDaLinha(adicionar([], COCA, 2)[0], adicionar([], COCA, 2), COCA), 2, 'chegou no limite');
});

test('sugestões: sem marcados = bebidas; tira o que já está na sacola; fechado = nenhuma', () => {
  assert.deepEqual(sugestoes(cardapio(), []).map((p) => p.nome), ['Coca-Cola 1L', 'Guaraná 2L']);
  const naSacola = adicionar([], COCA, 1);
  assert.deepEqual(sugestoes(cardapio(), naSacola).map((p) => p.nome), ['Guaraná 2L']);
  assert.deepEqual(sugestoes(cardapio(), naSacola, new Set([23])).map((p) => p.nome), ['Coca-Cola 1L', 'Guaraná 2L'], 'feedback do +');
  assert.deepEqual(sugestoes({ ...cardapio(), aberto: false }, []), []);
  assert.deepEqual(sugestoes(null, []), []);
});

test('sugestões: com marcados, só eles; todos na sacola = seção some; sem saldo e por kg ficam de fora', () => {
  assert.deepEqual(sugestoes(cardapio({ sobremesas: true }), []).map((p) => p.nome), ['Pudim']);
  assert.deepEqual(sugestoes(cardapio({ sobremesas: true }), adicionar([], PUDIM, 1)), [], 'não cai nas bebidas');
  const semSaldo = { aberto: true, categorias: [{ id: 4, nome: 'Bebidas', produtos: [{ ...COCA, maxSacola: 0 }, { ...GUARANA, tipoPreco: 'POR_KG' }] }] };
  assert.deepEqual(sugestoes(semSaldo, []), []);
  const muitas = { aberto: true, categorias: [{ id: 4, nome: 'BEBIDAS', produtos: Array.from({ length: 15 }, (_, i) => ({ ...GUARANA, id: 100 + i })) }] };
  assert.equal(sugestoes(muitas, []).length, 10, 'no máximo 10, categoria sem diferenciar maiúsculas');
});

test('enderecoDaTaxa: principal ativo, senão o primeiro ativo; nenhum ativo = null', () => {
  const e = (id, principal, ativo, taxa = 500) => ({ id, principal, bairro: { ativo, taxaCentavos: taxa } });
  assert.equal(enderecoDaTaxa([e(1, false, true), e(2, true, true)]).id, 2);
  assert.equal(enderecoDaTaxa([e(1, true, false), e(2, false, true)]).id, 2);
  assert.equal(enderecoDaTaxa([e(1, true, false)]), null);
  assert.equal(enderecoDaTaxa(null), null);
});

test('resumoDaSacola: taxa conhecida, desconhecida e frete grátis (mesmo sem saber o bairro)', () => {
  const itens = adicionar(adicionar([], XBACON, 2), COCA, 1); // 4100
  const frete = { minimoCentavos: 5000 };

  assert.deepEqual(
    { ...resumoDaSacola(itens, { taxaBairroCentavos: 500, freteGratis: frete }), progresso: undefined },
    { subtotalCentavos: 4100, taxaEntregaCentavos: 500, gratis: false, totalCentavos: 4600, rotuloTotal: 'Total com entrega', progresso: undefined },
  );
  assert.deepEqual(resumoDaSacola(itens, { taxaBairroCentavos: 500, freteGratis: frete }).progresso, {
    atingido: false,
    faltaCentavos: 900,
    percentual: 82,
  });

  const semTaxa = resumoDaSacola(itens, { freteGratis: frete });
  assert.equal(semTaxa.taxaEntregaCentavos, null);
  assert.equal(semTaxa.totalCentavos, 4100);
  assert.equal(semTaxa.rotuloTotal, 'Subtotal');

  const gratis = resumoDaSacola(adicionar(itens, COCA, 1), { freteGratis: frete }); // 5000
  assert.equal(gratis.gratis, true);
  assert.equal(gratis.taxaEntregaCentavos, 0);
  assert.equal(gratis.totalCentavos, 5000);
  assert.equal(gratis.rotuloTotal, 'Total com entrega grátis');

  const desligado = resumoDaSacola(itens, { taxaBairroCentavos: 500 });
  assert.equal(desligado.progresso, null);
  assert.equal(desligado.totalCentavos, 4600);
});

test('auxiliares: rótulo de itens e mapa de produtos com a categoria', () => {
  assert.equal(rotuloItens(1), '1 item');
  assert.equal(rotuloItens(3), '3 itens');
  assert.equal(produtosDoCardapio(cardapio().categorias).get(23).categoria, 'Bebidas');
});
