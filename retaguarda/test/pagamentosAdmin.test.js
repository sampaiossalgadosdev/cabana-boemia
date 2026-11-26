import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acoesDoPagamento, restanteParaEstornar, ALERTAS_DE_PAGAMENTO } from '../src/lib/pagamentosAdmin.js';
import { readFileSync } from 'node:fs';

const pagamento = (status, pedidoStatus = 'CONFIRMADO', reembolsado = 0) => ({
  status,
  valorCentavos: 3000,
  valorReembolsadoCentavos: reembolsado,
  pedido: { status: pedidoStatus },
});

test('ações: aberto = cancelar com estorno; finalizado = só estornar; pendente = tentar ou resolver; contestado = nada', () => {
  assert.deepEqual(acoesDoPagamento(pagamento('APROVADO')), ['estornar', 'cancela']);
  assert.deepEqual(acoesDoPagamento(pagamento('APROVADO', 'FINALIZADO')), ['estornar']);
  assert.deepEqual(acoesDoPagamento(pagamento('REEMBOLSO_PARCIAL', 'FINALIZADO', 1000)), ['estornar']);
  assert.deepEqual(acoesDoPagamento(pagamento('REEMBOLSO_PARCIAL', 'FINALIZADO', 3000)), []);
  assert.deepEqual(acoesDoPagamento(pagamento('REEMBOLSO_PENDENTE', 'CANCELADO')), ['tentar', 'resolver']);
  assert.deepEqual(acoesDoPagamento(pagamento('CONTESTADO', 'FINALIZADO')), []);
  assert.deepEqual(acoesDoPagamento(pagamento('REEMBOLSADO', 'CANCELADO', 3000)), []);
  assert.equal(restanteParaEstornar(pagamento('REEMBOLSO_PARCIAL', 'FINALIZADO', 1200)), 1800);
});

test('a tela "Pagamentos online" é da plataforma e os alertas de pagamento levam até ela', () => {
  // rotas.js usa import.meta.env (Vite): conferido pelo texto.
  assert.match(readFileSync(new URL('../src/lib/rotas.js', import.meta.url), 'utf8'), /caminho: 'pagamentos', titulo: 'Pagamentos online'/);
  for (const tipo of ['REEMBOLSO_FALHOU', 'CHARGEBACK', 'ESTORNO_EXTERNO', 'PEDIDO_SEM_ACEITE']) assert.ok(ALERTAS_DE_PAGAMENTO.includes(tipo));
});
