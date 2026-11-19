/**
 * Lógica pura do envio de pedido (cópia de site/src/pedido/pedido.js; UUID
 * pelo expo-crypto, ver uuid.js), testada com node:test.
 * O total mostrado aqui é só uma prévia: a API recalcula tudo com os preços
 * do banco e o pedido devolvido é a fonte da verdade.
 */
import { taxaDeEntrega } from '@restaurante/shared/frete';
import { adicionar, totalCentavos } from './carrinho.js';
import { formatarPreco } from './dinheiro.js';
import { novoUuid } from './uuid.js';

export const FORMAS_PAGAMENTO = [
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
  { valor: 'DEBITO', rotulo: 'Cartão de débito' },
  { valor: 'CREDITO', rotulo: 'Cartão de crédito' },
];

export const rotuloPagamento = (valor) => FORMAS_PAGAMENTO.find((f) => f.valor === valor)?.rotulo ?? valor;

/**
 * Prévia do total: itens da sacola + taxa do bairro escolhido, zerada pelo
 * frete grátis (`{ minimoCentavos }` do cardápio; null = desligado) com a
 * mesma regra da API. A taxa nunca vai no corpo do pedido.
 */
export function resumoDoPedido(itens, taxaBairroCentavos = 0, freteGratis = null) {
  const subtotal = totalCentavos(itens);
  const taxa = taxaDeEntrega(taxaBairroCentavos, subtotal, freteGratis);
  return { subtotalCentavos: subtotal, taxaEntregaCentavos: taxa, totalCentavos: subtotal + taxa };
}

/** Valor da linha "Entrega": "Grátis" quando não há taxa. */
export const textoTaxa = (centavos) => (centavos === 0 ? 'Grátis' : formatarPreco(centavos));

/** "2× X-Bacon, 1× Coca-Cola 1L e mais 2" (histórico de pedidos). */
export function resumoItens(itens, maximo = 3) {
  const partes = itens.slice(0, maximo).map((i) => `${i.quantidade}× ${i.nome}`);
  const resto = itens.length - maximo;
  return resto > 0 ? `${partes.join(', ')} e mais ${resto}` : partes.join(', ');
}

const formatoData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** ISO → "sáb., 14/11/2026 · 20:15" no horário de Brasília. */
export function dataDoPedido(iso) {
  const p = Object.fromEntries(formatoData.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day}/${p.month}/${p.year} · ${p.hour}:${p.minute}`;
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
 * "Repetir pedido" (o último ou um do histórico): joga na sacola só o que está no cardápio AGORA,
 * com o preço de agora (não o do pedido antigo) e a mesma observação. O
 * cardápio público já tira o que está inativo, sem saldo (bebidas, pão dos
 * lanches), fora do turno, fora de hoje ou fora do site: esses viram
 * `indisponiveis`.
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

export const AVISO_INDISPONIVEIS = 'Alguns itens não estão disponíveis e não foram adicionados';

/**
 * Avisos depois de repetir um pedido e se a sacola deve abrir: só abre se
 * algo entrou (nada disponível = só o aviso, sem sacola vazia).
 * @param {{ adicionados: number, indisponiveis: string[] }} r resultado de repetirPedido
 */
export function avisosDaRepeticao({ adicionados, indisponiveis }) {
  const mensagens = [];
  if (adicionados) mensagens.push(adicionados === 1 ? '1 item foi para a sacola.' : `${adicionados} itens foram para a sacola.`);
  if (indisponiveis.length) mensagens.push(`${AVISO_INDISPONIVEIS}: ${indisponiveis.join(', ')}.`);
  return { mensagens, abrirSacola: adicionados > 0 };
}

/** Uma chave por tentativa de pedido: reenviar (toque duplo, rede caiu) não duplica. */
export function novaChavePedido() {
  return novoUuid();
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
