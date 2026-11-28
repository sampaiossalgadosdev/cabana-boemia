/**
 * Cartão pelo app (Etapa 7 do pagamento online, Checkout Pro): funções puras.
 * - `mensagemDaRecusa`: o `status_detail` da recusa do Mercado Pago em português, para o app.
 * - `tipoDoPagamento`: o tipo real (`payment_type_id`) → `Pedido.tipoPagamentoOnline` e a
 *   `formaPagamento` gravada na aprovação (o enum da forma só tem PIX, DINHEIRO, DEBITO e CREDITO).
 */

export const MENSAGEM_RECUSA_PADRAO = 'O pagamento foi recusado. Tente outro cartão ou escolha outra forma de pagamento.';

const RECUSAS = {
  cc_rejected_insufficient_amount: 'Saldo ou limite insuficiente no cartão.',
  cc_rejected_bad_filled_security_code: 'O código de segurança do cartão está errado.',
  cc_rejected_bad_filled_date: 'A data de validade do cartão está errada.',
  cc_rejected_bad_filled_card_number: 'O número do cartão está errado.',
  cc_rejected_bad_filled_other: 'Confira os dados do cartão.',
  cc_rejected_call_for_authorize: 'O banco pediu autorização para este pagamento. Ligue para o banco do cartão ou use outro cartão.',
  cc_rejected_card_disabled: 'O cartão está desativado. Ative com o banco ou use outro cartão.',
  cc_rejected_duplicated_payment: 'Já existe um pagamento igual feito há pouco. Use outro cartão ou outra forma de pagamento.',
  cc_rejected_max_attempts: 'Muitas tentativas com este cartão. Use outro cartão ou outra forma de pagamento.',
  cc_rejected_high_risk: 'O pagamento foi recusado por segurança. Use outro cartão ou outra forma de pagamento.',
  rejected_high_risk: 'O pagamento foi recusado por segurança. Use outro cartão ou outra forma de pagamento.',
  cc_rejected_card_error: 'O cartão não pôde ser processado. Tente de novo ou use outro cartão.',
  cc_rejected_blacklist: 'Não foi possível pagar com este cartão. Use outro cartão ou outra forma de pagamento.',
  cc_rejected_insufficient_data: 'Faltaram dados para aprovar o pagamento. Confira os dados e tente de novo.',
};

/** @param {string | null | undefined} statusDetail */
export function mensagemDaRecusa(statusDetail) {
  return RECUSAS[statusDetail] ?? MENSAGEM_RECUSA_PADRAO;
}

const TIPOS = {
  credit_card: { tipo: 'CREDITO', forma: 'CREDITO' },
  debit_card: { tipo: 'DEBITO', forma: 'DEBITO' },
  prepaid_card: { tipo: 'PRE_PAGO', forma: 'DEBITO' },
  account_money: { tipo: 'SALDO_MERCADO_PAGO', forma: 'CREDITO' },
};

/**
 * Tipo real do pagamento com cartão (Etapa 7). Sem o tipo informado = crédito (é o caso comum
 * e o que o cliente escolheu na tela). Outro tipo (ex.: Linha de Crédito) = OUTRO.
 * A `forma` é só a mais próxima do enum de hoje: o relatório e o cupom usam o `tipo`.
 * @param {string | null | undefined} paymentTypeId
 * @returns {{ tipo: 'CREDITO' | 'DEBITO' | 'PRE_PAGO' | 'SALDO_MERCADO_PAGO' | 'OUTRO', forma: 'CREDITO' | 'DEBITO' }}
 */
export function tipoDoPagamento(paymentTypeId) {
  if (!paymentTypeId) return TIPOS.credit_card;
  return TIPOS[paymentTypeId] ?? { tipo: 'OUTRO', forma: 'CREDITO' };
}
