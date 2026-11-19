import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categoriasVisiveis,
  limiteParaAdicionar,
  salvarCardapio,
  lerCardapioSalvo,
  podePedir,
  textoCardapioSalvo,
  CHAVE_CARDAPIO,
  VALIDADE_PEDIDO_MS,
} from '../src/logica/cardapio.js';
import { adicionar } from '../src/logica/carrinho.js';

const XBACON = { id: 6, nome: 'X-Bacon', precoCentavos: 1600, maxSacola: 4 };
const COCA = { id: 23, nome: 'Coca-Cola 1L', precoCentavos: 900, maxSacola: 0 };
const SUCO = { id: 30, nome: 'Suco', precoCentavos: 700, maxSacola: 20 };

function storageFalso() {
  const dados = new Map();
  return { getItem: async (k) => dados.get(k) ?? null, setItem: async (k, v) => void dados.set(k, v), dados };
}

test('aberto: produto sem saldo (maxSacola 0) não aparece e categoria vazia some', () => {
  const r = categoriasVisiveis({
    aberto: true,
    categorias: [
      { id: 1, nome: 'Lanches', produtos: [XBACON] },
      { id: 4, nome: 'Bebidas', produtos: [COCA] },
      { id: 5, nome: 'Sucos', produtos: [SUCO, COCA] },
    ],
  });
  assert.deepEqual(r.map((c) => [c.nome, c.produtos.map((p) => p.id)]), [['Lanches', [6]], ['Sucos', [30]]]);
});

test('fechado (prévia, maxSacola null): mostra tudo; sem cardápio = lista vazia', () => {
  const previa = { aberto: false, categorias: [{ id: 1, nome: 'Lanches', produtos: [{ ...XBACON, maxSacola: null }] }] };
  assert.equal(categoriasVisiveis(previa)[0].produtos.length, 1);
  assert.deepEqual(categoriasVisiveis(null), []);
});

test('limiteParaAdicionar: maxSacola menos o que já está na sacola (todas as linhas), nunca acima de 20', () => {
  let itens = adicionar([], XBACON, 1, 'sem cebola');
  itens = adicionar(itens, XBACON, 2);
  assert.equal(limiteParaAdicionar(itens, XBACON), 1);
  assert.equal(limiteParaAdicionar(adicionar([], XBACON, 4), XBACON), 0);
  assert.equal(limiteParaAdicionar([], { ...SUCO, maxSacola: 50 }), 20);
  assert.equal(limiteParaAdicionar([], { ...SUCO, maxSacola: null }), 20);
});

test('cardápio salvo no aparelho volta igual; corrompido ou com formato errado = nada', async () => {
  const s = storageFalso();
  const dados = { aberto: true, categorias: [{ id: 1, nome: 'Lanches', produtos: [XBACON] }] };
  assert.equal(await lerCardapioSalvo(s), null);
  assert.equal(await salvarCardapio(dados, 1000, s), true);
  assert.deepEqual(await lerCardapioSalvo(s), { dados, salvoEm: 1000 });

  s.dados.set(CHAVE_CARDAPIO, '{quebrado');
  assert.equal(await lerCardapioSalvo(s), null);
  s.dados.set(CHAVE_CARDAPIO, JSON.stringify({ salvoEm: 1, dados: { aberto: true, categorias: [{ nome: 1 }] } }));
  assert.equal(await lerCardapioSalvo(s), null);
  s.dados.set(CHAVE_CARDAPIO, JSON.stringify({ dados }));
  assert.equal(await lerCardapioSalvo(s), null, 'sem data');
});

test('podePedir: rede = se está aberto; salvo no aparelho = aberto e recente', () => {
  const aberto = { aberto: true, categorias: [] };
  const agora = 10 * VALIDADE_PEDIDO_MS;
  assert.equal(podePedir({ dados: aberto, origem: 'rede', salvoEm: 0 }, agora), true);
  assert.equal(podePedir({ dados: { ...aberto, aberto: false }, origem: 'rede', salvoEm: agora }, agora), false);
  assert.equal(podePedir({ dados: aberto, origem: 'aparelho', salvoEm: agora - 60_000 }, agora), true);
  assert.equal(podePedir({ dados: aberto, origem: 'aparelho', salvoEm: agora - VALIDADE_PEDIDO_MS }, agora), false);
  assert.equal(podePedir(null, agora), false);
});

test('textoCardapioSalvo usa o horário de Brasília', () => {
  assert.equal(textoCardapioSalvo(Date.parse('2026-11-19T22:42:00Z')), 'Mostrando o cardápio das 19:42.');
});
