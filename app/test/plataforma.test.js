import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usarArmazenamento, lerTexto, gravarTexto, removerTexto } from '../src/logica/armazenamento.js';
import { usarGeradorUuid } from '../src/logica/uuid.js';
import { novaChavePedido } from '../src/logica/pedido.js';
import { carregarCarrinho, salvarCarrinho, adicionar } from '../src/logica/carrinho.js';

test('sem storage injetado: lê null e não grava (nada derruba o app)', async () => {
  usarArmazenamento(null);
  assert.equal(await lerTexto('x'), null);
  assert.equal(await gravarTexto('x', '1'), false);
  await assert.doesNotReject(() => removerTexto('x'));
});

test('storage injetado (como o app faz com o AsyncStorage) vale para quem não passa um', async () => {
  const dados = new Map();
  usarArmazenamento({
    getItem: async (k) => dados.get(k) ?? null,
    setItem: async (k, v) => void dados.set(k, v),
    removeItem: async (k) => void dados.delete(k),
  });
  const itens = adicionar([], { id: 6, nome: 'X-Bacon', precoCentavos: 1600 }, 2);
  assert.equal(await salvarCarrinho(itens), true);
  assert.deepEqual(await carregarCarrinho(), itens);
  usarArmazenamento(null);
});

test('chave do pedido usa o gerador injetado (expo-crypto no app)', () => {
  usarGeradorUuid(() => 'uuid-do-expo-crypto');
  assert.equal(novaChavePedido(), 'uuid-do-expo-crypto');
  usarGeradorUuid(() => globalThis.crypto.randomUUID());
});
