import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resumoDoPedido,
  corpoDoPedido,
  lerReais,
  erroDoTroco,
  linkCancelamento,
  repetirPedido,
  novaChavePedido,
  aplicarPrecosNovos,
  textoTaxa,
  resumoItens,
  dataDoPedido,
  avisosDaRepeticao,
  AVISO_INDISPONIVEIS,
} from '../src/logica/pedido.js';
import { adicionar } from '../src/logica/carrinho.js';

const XBACON = { id: 6, nome: 'X-Bacon', precoCentavos: 1600 };
const COCA = { id: 23, nome: 'Coca-Cola 1L', precoCentavos: 900 };
const categorias = [
  { id: 1, nome: 'Lanches', produtos: [XBACON] },
  { id: 4, nome: 'Bebidas', produtos: [COCA] },
];

test('resumoDoPedido: itens + taxa do bairro', () => {
  const itens = adicionar(adicionar([], XBACON, 2), COCA, 1);
  assert.deepEqual(resumoDoPedido(itens, 500), { subtotalCentavos: 4100, taxaEntregaCentavos: 500, totalCentavos: 4600 });
});

test('resumoDoPedido com frete grátis: subtotal (sem taxa) >= mínimo zera a taxa', () => {
  const itens = adicionar(adicionar([], XBACON, 2), COCA, 1); // 4100
  assert.deepEqual(resumoDoPedido(itens, 500, { minimoCentavos: 4100 }), { subtotalCentavos: 4100, taxaEntregaCentavos: 0, totalCentavos: 4100 });
  assert.deepEqual(resumoDoPedido(itens, 500, { minimoCentavos: 4101 }), { subtotalCentavos: 4100, taxaEntregaCentavos: 500, totalCentavos: 4600 });
  assert.equal(textoTaxa(0), 'Grátis');
  assert.match(textoTaxa(500), /R\$\s5,00/);
});

test('histórico: itens resumidos e data no horário de Brasília', () => {
  const itens = [
    { quantidade: 2, nome: 'X-Bacon' },
    { quantidade: 1, nome: 'Coca-Cola 1L' },
    { quantidade: 1, nome: 'Batata' },
    { quantidade: 3, nome: 'Água' },
    { quantidade: 1, nome: 'Pudim' },
  ];
  assert.equal(resumoItens(itens.slice(0, 2)), '2× X-Bacon, 1× Coca-Cola 1L');
  assert.equal(resumoItens(itens), '2× X-Bacon, 1× Coca-Cola 1L, 1× Batata e mais 2');
  assert.equal(dataDoPedido('2026-11-14T23:15:00.000Z'), 'sáb., 14/11/2026 · 20:15');
  assert.equal(dataDoPedido('2026-11-15T03:30:00.000Z'), 'dom., 15/11/2026 · 00:30');
});

test('corpoDoPedido nunca manda preço nem nome; troco só em dinheiro', () => {
  const itens = adicionar(adicionar([], XBACON, 2, 'sem cebola'), COCA, 1);
  const corpo = corpoDoPedido(itens, { enderecoId: 7, formaPagamento: 'PIX', trocoParaCentavos: 5000, chaveIdempotencia: 'k' });
  assert.deepEqual(corpo, {
    itens: [
      { produtoId: 6, quantidade: 2, observacao: 'sem cebola' },
      { produtoId: 23, quantidade: 1 },
    ],
    enderecoId: 7,
    formaPagamento: 'PIX',
    chaveIdempotencia: 'k',
  });
  assert.ok(!JSON.stringify(corpo).includes('preco'));

  const dinheiro = corpoDoPedido(itens, { enderecoId: 7, formaPagamento: 'DINHEIRO', trocoParaCentavos: 5000 });
  assert.equal(dinheiro.trocoParaCentavos, 5000);
});

test('lerReais: aceita "100", "50,5", "R$ 1.234,56"; recusa lixo', () => {
  assert.equal(lerReais('100'), 10000);
  assert.equal(lerReais('50,5'), 5050);
  assert.equal(lerReais('50,05'), 5005);
  assert.equal(lerReais('R$ 1.234,56'), 123456);
  for (const v of ['', 'abc', '10,999', '-5', null]) assert.equal(lerReais(v), null, String(v));
});

test('erroDoTroco: precisa ser maior que o total', () => {
  assert.equal(erroDoTroco(null, 4600), null);
  assert.equal(erroDoTroco(5000, 4600), null);
  assert.match(erroDoTroco(4600, 4600), /maior que o total/);
  assert.match(erroDoTroco(2000, 4600), /maior que o total/);
});

test('linkCancelamento: wa.me com a mensagem pronta (número e nome)', () => {
  const link = linkCancelamento('+55 (43) 99999-0000', 12, 'Maria Silva');
  assert.equal(
    link,
    'https://wa.me/5543999990000?text=' + encodeURIComponent('Olá, gostaria de cancelar o pedido 12, em nome de Maria Silva'),
  );
  assert.equal(new URL(link).searchParams.get('text'), 'Olá, gostaria de cancelar o pedido 12, em nome de Maria Silva');
  assert.equal(linkCancelamento('', 12, 'Maria'), null);
});

test('repetirPedido: só o que está no cardápio agora, com o preço de agora', () => {
  const ultimo = {
    itens: [
      { produtoId: 6, nome: 'X-Bacon', quantidade: 2, observacao: 'sem cebola', precoUnitarioCentavos: 1400 },
      { produtoId: 99, nome: 'Pizza Bacon', quantidade: 1, observacao: null },
      { produtoId: 23, nome: 'Coca-Cola 1L', quantidade: 1, observacao: null },
    ],
  };
  const r = repetirPedido([], ultimo, categorias);
  assert.equal(r.adicionados, 3);
  assert.deepEqual(r.indisponiveis, ['Pizza Bacon']);
  assert.deepEqual(
    r.itens.map((i) => [i.produtoId, i.quantidade, i.observacao, i.precoCentavos]),
    [
      [6, 2, 'sem cebola', 1600],
      [23, 1, '', 900],
    ],
  );
});

test('repetirPedido soma com o que já está no carrinho', () => {
  const carrinho = adicionar([], XBACON, 1, 'sem cebola');
  const r = repetirPedido(carrinho, { itens: [{ produtoId: 6, nome: 'X-Bacon', quantidade: 2, observacao: 'sem cebola' }] }, categorias);
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].quantidade, 3);
});

test('repetir: preço de AGORA (não o salvo), observações mantidas, indisponíveis pulados com o aviso', () => {
  // Pedido antigo: X-Bacon a R$ 14 com observação; Coca (sem saldo hoje), lanche de outro
  // turno e produto inativo: nenhum dos três vem no cardápio público de agora.
  const antigo = {
    itens: [
      { produtoId: 6, nome: 'X-Bacon', quantidade: 2, observacao: 'sem cebola', precoUnitarioCentavos: 1400 },
      { produtoId: 6, nome: 'X-Bacon', quantidade: 1, observacao: 'bem passado', precoUnitarioCentavos: 1400 },
      { produtoId: 23, nome: 'Coca-Cola 1L', quantidade: 1, observacao: null, precoUnitarioCentavos: 800 },
      { produtoId: 50, nome: 'Marmita M', quantidade: 1, observacao: null },
      { produtoId: 51, nome: 'X-Antigo', quantidade: 1, observacao: 'sem tomate' },
    ],
  };
  const agora = [{ id: 1, nome: 'Lanches', produtos: [XBACON] }]; // só o X-Bacon, a R$ 16
  const r = repetirPedido([], antigo, agora);
  assert.deepEqual(
    r.itens.map((i) => [i.nome, i.quantidade, i.observacao, i.precoCentavos]),
    [
      ['X-Bacon', 2, 'sem cebola', 1600],
      ['X-Bacon', 1, 'bem passado', 1600],
    ],
  );
  assert.deepEqual(r.indisponiveis, ['Coca-Cola 1L', 'Marmita M', 'X-Antigo']);
  assert.deepEqual(avisosDaRepeticao(r), {
    mensagens: ['3 itens foram para a sacola.', `${AVISO_INDISPONIVEIS}: Coca-Cola 1L, Marmita M, X-Antigo.`],
    abrirSacola: true,
  });
  assert.equal(AVISO_INDISPONIVEIS, 'Alguns itens não estão disponíveis e não foram adicionados');
});

test('repetir sem nada disponível: sacola intacta, só o aviso, não abre a sacola', () => {
  const naSacola = adicionar([], COCA, 1);
  const r = repetirPedido(naSacola, { itens: [{ produtoId: 6, nome: 'X-Bacon', quantidade: 2, observacao: null }] }, []);
  assert.equal(r.adicionados, 0);
  assert.equal(r.itens, naSacola, 'mesma sacola, nada mudou');
  assert.deepEqual(avisosDaRepeticao(r), { mensagens: [`${AVISO_INDISPONIVEIS}: X-Bacon.`], abrirSacola: false });
  // Sacola vazia e nada disponível também não abre.
  assert.equal(avisosDaRepeticao(repetirPedido([], { itens: [] }, categorias)).abrirSacola, false);
});

test('novaChavePedido gera UUIDs diferentes', () => {
  const a = novaChavePedido();
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.notEqual(a, novaChavePedido());
});

test('corpoDoPedido leva o total que o cliente viu', () => {
  const itens = adicionar([], XBACON, 2);
  const corpo = corpoDoPedido(itens, { enderecoId: 1, formaPagamento: 'PIX', totalEsperadoCentavos: 3700 });
  assert.equal(corpo.totalEsperadoCentavos, 3700);
});

test('aplicarPrecosNovos (409 PRECO_ALTERADO): atualiza o carrinho e lista o que mudou', () => {
  const itens = adicionar(adicionar(adicionar([], XBACON, 1), XBACON, 1, 'sem cebola'), COCA, 1);
  const r = aplicarPrecosNovos(itens, [
    { produtoId: 6, nome: 'X-Bacon', precoUnitarioCentavos: 1800 },
    { produtoId: 23, nome: 'Coca-Cola 1L', precoUnitarioCentavos: 900 },
  ]);
  assert.deepEqual(r.alterados, [{ nome: 'X-Bacon', de: 1600, para: 1800 }]);
  assert.deepEqual(r.itens.map((i) => [i.produtoId, i.precoCentavos, i.observacao]), [
    [6, 1800, ''],
    [6, 1800, 'sem cebola'],
    [23, 900, ''],
  ]);
  assert.equal(r.itens[2], itens[2], 'linha sem mudança fica a mesma');
  assert.deepEqual(aplicarPrecosNovos(itens, undefined).alterados, []);
});
