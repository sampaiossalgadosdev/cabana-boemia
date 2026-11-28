/**
 * Tela "Pagamento online" (lógica pura, testada): situação da conta Mercado Pago da loja,
 * mensagem de volta do Mercado Pago e quando o interruptor fica liberado.
 */

/** Texto e estilo da situação (`situacao` de GET /retaguarda/pagamento-online). */
export function descreverSituacao(s) {
  if (s.situacao === 'CONECTADA') return { rotulo: 'Conectada', classe: 'etiqueta--ok', texto: `Conta Mercado Pago ${s.conta}.` };
  if (s.situacao === 'EXPIRADA') {
    return {
      rotulo: 'Expirada',
      classe: 'etiqueta--alerta',
      texto: `A conexão com a conta ${s.conta} venceu e o pagamento online foi desligado. Conecte de novo.`,
    };
  }
  return { rotulo: 'Não conectada', classe: '', texto: 'A loja ainda não conectou uma conta Mercado Pago.' };
}

/** O interruptor só liga com a conta conectada e a flag global da plataforma ligada. */
export function motivoInterruptorTravado(s) {
  if (s.situacao !== 'CONECTADA') return 'Conecte a conta Mercado Pago para ligar o pagamento online.';
  if (!s.flagGlobal) return 'O pagamento online ainda não foi liberado pelo Taaki Delivery.';
  return null;
}

const MOTIVOS = {
  STATE_INVALIDO: 'O link de conexão não é válido. Tente conectar de novo.',
  STATE_EXPIRADO: 'A conexão levou mais de 10 minutos. Tente conectar de novo.',
  AUTORIZACAO_NEGADA: 'A autorização foi cancelada no Mercado Pago.',
  TROCA_FALHOU: 'O Mercado Pago não confirmou a conexão. Tente de novo em alguns minutos.',
  CONTA_EM_OUTRA_LOJA: 'Esta conta Mercado Pago já está conectada a outra loja do Taaki Delivery. Entre com a conta da sua loja.',
  SEM_PERMISSAO: 'Você não tem permissão para conectar esta loja.',
  NAO_CONFIGURADO: 'O pagamento online ainda não está configurado no servidor. Fale com o Taaki Delivery.',
};

/**
 * Mensagem da volta do Mercado Pago (`?mp=conectada` ou `?mp=erro&motivo=…`), ou null.
 * @param {string} search `window.location.search`
 * @returns {{ tipo: 'ok' | 'erro', texto: string } | null}
 */
export function mensagemDoRetorno(search) {
  const p = new URLSearchParams(search);
  if (p.get('mp') === 'conectada') return { tipo: 'ok', texto: 'Conta Mercado Pago conectada.' };
  if (p.get('mp') === 'erro') return { tipo: 'erro', texto: MOTIVOS[p.get('motivo')] ?? 'Não foi possível conectar a conta Mercado Pago. Tente de novo.' };
  return null;
}

/** Texto do aviso antes de desconectar (Decisão 17). */
/**
 * Pedidos pagos online ainda abertos (nem finalizados nem cancelados): enquanto houver, a loja não
 * desconecta (sem a conexão não haveria como devolver o dinheiro). Zero = null (pode desconectar).
 */
export function avisoPedidosPagosAbertos(quantidade) {
  if (!quantidade) return null;
  const n = quantidade === 1 ? '1 pedido pago online em aberto' : `${quantidade} pedidos pagos online em aberto`;
  return `A loja tem ${n}. Finalize ou cancele ${quantidade === 1 ? 'o pedido' : 'os pedidos'} no PDV antes de desconectar o Mercado Pago.`;
}

export function avisoDesconectar(pendentes) {
  const base = 'A loja deixa de receber pagamento online até conectar de novo.';
  if (!pendentes) return base;
  const n = pendentes === 1 ? '1 pagamento pendente' : `${pendentes} pagamentos pendentes`;
  return `Há ${n}: ${pendentes === 1 ? 'ele será cancelado' : 'eles serão cancelados'} e os pedidos que aguardam pagamento não seguem para a loja. ${base}`;
}
