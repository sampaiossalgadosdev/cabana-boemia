/**
 * Lógica pura do envio de pedido no site (testada com node:test).
 * O total mostrado aqui é só uma prévia: a API recalcula tudo com os preços
 * do banco e o pedido devolvido é a fonte da verdade.
 */
import { adicionar, totalCentavos } from '../carrinho/carrinho.js';

export const FORMAS_PAGAMENTO = [
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
  { valor: 'DEBITO', rotulo: 'Cartão de débito' },
  { valor: 'CREDITO', rotulo: 'Cartão de crédito' },
];

export const rotuloPagamento = (valor) => FORMAS_PAGAMENTO.find((f) => f.valor === valor)?.rotulo ?? valor;

/** Prévia do total: itens do carrinho + taxa do bairro escolhido. */
export function resumoDoPedido(itens, taxaEntregaCentavos = 0) {
  const subtotal = totalCentavos(itens);
  return { subtotalCentavos: subtotal, taxaEntregaCentavos, totalCentavos: subtotal + taxaEntregaCentavos };
}

/**
 * Corpo do POST /cliente/pedidos. Itens NUNCA levam preço: só produto,
 * quantidade e observação. `totalEsperadoCentavos` é o total que o cliente
 * viu: a API recalcula e, se for diferente, responde 409 PRECO_ALTERADO.
 */
export function corpoDoPedido(itens, { enderecoId, formaPagamento, trocoParaCentavos, chaveIdempotencia, totalEsperadoCentavos }) {
  return {
    itens: itens.map((i) => ({
      produtoId: i.produtoId,
      quantidade: i.quantidade,
      ...(i.observacao ? { observacao: i.observacao } : {}),
    })),
    enderecoId,
    formaPagamento,
    ...(totalEsperadoCentavos != null ? { totalEsperadoCentavos } : {}),
    ...(formaPagamento === 'DINHEIRO' && trocoParaCentavos ? { trocoParaCentavos } : {}),
    ...(chaveIdempotencia ? { chaveIdempotencia } : {}),
  };
}

/** "50" → 5000, "50,5" → 5050, "R$ 1.234,56" → 123456; inválido → null. */
export function lerReais(texto) {
  const limpo = String(texto ?? '').replace(/[R$\s.]/g, '');
  const m = /^(\d{1,6})(?:,(\d{1,2}))?$/.exec(limpo);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

/** Mensagem de erro do troco, ou null se está ok (sem troco também é ok). */
export function erroDoTroco(trocoParaCentavos, totalCentavos) {
  if (trocoParaCentavos == null) return null;
  if (!(trocoParaCentavos > totalCentavos)) return 'O troco precisa ser para um valor maior que o total.';
  return null;
}

/**
 * Link do WhatsApp para pedir o cancelamento (único jeito de cancelar).
 * @returns {string | null} null se o restaurante não cadastrou o WhatsApp
 */
export function linkCancelamento(whatsapp, numeroPedido, nome) {
  const numero = String(whatsapp ?? '').replace(/\D/g, '');
  if (!numero) return null;
  const texto = `Olá, gostaria de cancelar o pedido ${numeroPedido}, em nome de ${nome}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/**
 * "Repetir último pedido": joga no carrinho só o que está no cardápio AGORA,
 * com o preço de agora (não o do pedido antigo).
 * @returns {{ itens: any[], adicionados: number, indisponiveis: string[] }}
 */
export function repetirPedido(itensCarrinho, ultimoPedido, categorias) {
  const porId = new Map(categorias.flatMap((c) => c.produtos).map((p) => [p.id, p]));
  let itens = itensCarrinho;
  let adicionados = 0;
  const indisponiveis = [];
  for (const item of ultimoPedido?.itens ?? []) {
    const produto = porId.get(item.produtoId);
    if (!produto) {
      if (!indisponiveis.includes(item.nome)) indisponiveis.push(item.nome);
      continue;
    }
    itens = adicionar(itens, produto, item.quantidade, item.observacao ?? '');
    adicionados += item.quantidade;
  }
  return { itens, adicionados, indisponiveis };
}

/** Uma chave por tentativa de pedido: reenviar (toque duplo, rede caiu) não duplica. */
export function novaChavePedido() {
  return globalThis.crypto.randomUUID();
}

/**
 * 409 PRECO_ALTERADO: aplica os preços novos que a API devolveu ao carrinho.
 * @param {{ produtoId: number, nome: string, precoUnitarioCentavos: number }[]} precosNovos
 * @returns {{ itens: any[], alterados: { nome: string, de: number, para: number }[] }}
 */
export function aplicarPrecosNovos(itens, precosNovos) {
  const porId = new Map((precosNovos ?? []).map((p) => [p.produtoId, p]));
  const alterados = new Map();
  const novos = itens.map((item) => {
    const novo = porId.get(item.produtoId);
    if (!novo || novo.precoUnitarioCentavos === item.precoCentavos) return item;
    alterados.set(item.produtoId, { nome: novo.nome, de: item.precoCentavos, para: novo.precoUnitarioCentavos });
    return { ...item, nome: novo.nome, precoCentavos: novo.precoUnitarioCentavos };
  });
  return { itens: novos, alterados: [...alterados.values()] };
}
