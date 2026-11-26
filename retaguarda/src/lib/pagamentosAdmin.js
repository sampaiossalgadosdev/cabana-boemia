/**
 * Tela "Pagamentos online" do ADMIN (Etapa 5): nomes e quais ações cada pagamento aceita.
 * Puro e testado (a API confere tudo de novo).
 */

export const NOMES_STATUS_PAGAMENTO = {
  APROVADO: 'Pago',
  REEMBOLSADO: 'Estornado',
  REEMBOLSO_PARCIAL: 'Estornado em parte',
  REEMBOLSO_PENDENTE: 'Reembolso pendente',
  A_ESTORNAR: 'Pago depois de expirar (estornando)',
  CONTESTADO: 'Contestado no Mercado Pago',
};

export const NOMES_STATUS_ESTORNO = {
  PROCESSANDO: 'processando',
  CONCLUIDO: 'feito',
  FALHOU: 'recusado',
  RESOLVIDO_POR_FORA: 'resolvido por fora',
};

export const NOMES_ORIGEM_ESTORNO = { AUTOMATICO: 'automático', ADMIN: 'pelo ADMIN', MERCADO_PAGO: 'no Mercado Pago' };

const PEDIDO_ABERTO = ['ABERTO', 'CONFIRMADO', 'EM_PREPARO', 'SAIU_ENTREGA'];

/** Quanto ainda pode voltar ao cliente. */
export const restanteParaEstornar = (p) => Math.max(0, p.valorCentavos - p.valorReembolsadoCentavos);

/**
 * Ações do pagamento: 'estornar' (+ 'cancela' quando o pedido ainda está aberto), ou 'tentar' e
 * 'resolver' no reembolso pendente. Contestado: nenhuma (o Mercado Pago decide a disputa).
 */
export function acoesDoPagamento(p) {
  if (p.status === 'REEMBOLSO_PENDENTE') return ['tentar', 'resolver'];
  if (['APROVADO', 'REEMBOLSO_PARCIAL'].includes(p.status) && restanteParaEstornar(p) > 0) {
    return PEDIDO_ABERTO.includes(p.pedido.status) ? ['estornar', 'cancela'] : ['estornar'];
  }
  return [];
}

/** Alertas que levam à tela "Pagamentos online". */
export const ALERTAS_DE_PAGAMENTO = ['REEMBOLSO_FALHOU', 'CHARGEBACK', 'ESTORNO_EXTERNO', 'PAGO_APOS_EXPIRAR', 'PAGAMENTO_DIVERGENTE', 'PEDIDO_SEM_ACEITE'];
