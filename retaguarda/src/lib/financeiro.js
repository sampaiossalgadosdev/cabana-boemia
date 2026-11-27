/**
 * Telas "Financeiro" (ADMIN) e "Fechamento" (loja), Etapa 6 do pagamento online: textos do saldo
 * em linguagem simples, semana, status e o atalho do ajuste manual. Puro e testado.
 * Sinal do livro-razão: positivo = a loja deve ao Taaki; negativo = o Taaki deve à loja.
 */
import { formatarReais } from './dinheiro.js';

/** Saldo do ponto de vista da loja. */
export function textoDoSaldo(saldoCentavos) {
  if (saldoCentavos > 0) return `Você deve ao Taaki ${formatarReais(saldoCentavos)}`;
  if (saldoCentavos < 0) return `O Taaki deve a você ${formatarReais(-saldoCentavos)}`;
  return 'Nenhum valor a acertar com o Taaki';
}

/** Saldo do ponto de vista do ADMIN (com o nome da loja). */
export function textoDoSaldoAdmin(saldoCentavos, nomeLoja) {
  if (saldoCentavos > 0) return `${nomeLoja} deve ${formatarReais(saldoCentavos)} ao Taaki`;
  if (saldoCentavos < 0) return `O Taaki deve ${formatarReais(-saldoCentavos)} a ${nomeLoja}`;
  return 'Saldo zero';
}

/** Valor de um lançamento para a loja: "Você deve R$ 5,00" / "A receber R$ 5,00". */
export function valorParaLoja(valorCentavos) {
  return valorCentavos > 0 ? `Você deve ${formatarReais(valorCentavos)}` : `A receber ${formatarReais(-valorCentavos)}`;
}

/** Valor de um lançamento para o ADMIN: "+R$ 5,00" (loja deve) / "−R$ 5,00" (Taaki deve). */
export function valorComSinal(valorCentavos) {
  return valorCentavos > 0 ? `+${formatarReais(valorCentavos)}` : `−${formatarReais(-valorCentavos)}`;
}

const ddmm = (dia) => {
  const [, m, d] = dia.split('-');
  return `${d}/${m}`;
};

/** "2026-11-23" + "2026-11-29" → "23/11 a 29/11". */
export const nomeDaSemana = (inicio, domingo) => `${ddmm(inicio)} a ${ddmm(domingo)}`;

export const NOMES_STATUS_FECHAMENTO = {
  AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
  QUITADO: 'Quitado',
  ABERTO: 'Em aberto',
};

/** Pedido do lançamento: "nº 12 de 23/11" ou "código 345" (sem número). */
export function nomeDoPedido(pedido) {
  if (!pedido) return '—';
  return pedido.numeroDia ? `nº ${pedido.numeroDia} de ${ddmm(pedido.dataRef)}` : `código ${pedido.id}`;
}

/** Progresso da campanha contra o orçamento (0 a 100) e o texto "R$ X de R$ 700,00". */
export function progressoCampanha({ totalCentavos, orcamentoCentavos }) {
  const porcentagem = orcamentoCentavos > 0 ? Math.min(100, Math.round((totalCentavos / orcamentoCentavos) * 100)) : 100;
  return {
    porcentagem,
    texto: `${formatarReais(totalCentavos)} de ${formatarReais(orcamentoCentavos)}`,
    estourou: totalCentavos > orcamentoCentavos,
  };
}

/**
 * Ajuste manual: direção + valor positivo → valor com sinal do livro-razão.
 * 'LOJA_DEVE' = positivo; 'TAAKI_DEVE' = negativo.
 */
export const valorDoAjuste = (direcao, centavos) => (direcao === 'TAAKI_DEVE' ? -centavos : centavos);

/**
 * Estorno pelo ADMIN de pedido FINALIZADO com entrega pelo Taaki: o Mercado Pago devolve ao
 * cliente também a parte do Taaki na taxa, mas o entregador já entregou. O livro-razão não muda
 * sozinho (Decisão 3 da Etapa 6): a tela lembra disso e oferece o ajuste manual.
 */
export const pedeLembreteDeAjuste = (pedido) => pedido?.status === 'FINALIZADO' && pedido?.origemTaxaEntrega != null;

// Atalho "criar ajuste manual" de outra tela (Pagamentos online): guardado até o Financeiro abrir.
let ajustePedido = null;
export function pedirAjuste(dados) {
  ajustePedido = dados;
}
export function pegarAjustePedido() {
  const d = ajustePedido;
  ajustePedido = null;
  return d;
}

/** Texto do lembrete (estorno de pedido finalizado com entrega pelo Taaki). */
export const LEMBRETE_AJUSTE =
  'Pedido entregue pelos entregadores do Taaki: o Mercado Pago devolve ao cliente também a parte do Taaki na taxa de entrega, ' +
  'mas o entregador já fez a entrega e recebe os 95% dele. O fechamento da loja não muda sozinho: se for o caso, ' +
  'lance um ajuste manual (a loja arca ou o Taaki arca, conforme quem errou).';
