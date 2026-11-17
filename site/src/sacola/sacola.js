/**
 * Lógica pura da tela da sacola (testada com node:test). Tudo aqui é prévia:
 * a API recalcula preços, taxa e frete grátis ao criar o pedido.
 */
import { ganhouFreteGratis, progressoFreteGratis } from '@restaurante/shared/frete';
import { QUANTIDADE_MAX, totalCentavos } from '../carrinho/carrinho.js';

export const MAX_SUGESTOES = 10;

export const rotuloItens = (n) => (n === 1 ? '1 item' : `${n} itens`);

const normalizar = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

/** Produtos do cardápio por id, com o nome da categoria (para o ícone). */
export function produtosDoCardapio(categorias) {
  return new Map((categorias ?? []).flatMap((c) => c.produtos.map((p) => [p.id, { ...p, categoria: c.nome }])));
}

/**
 * Até quanto a linha pode ir: `maxSacola` do produto (saldo, até 20) menos o
 * que outras linhas do MESMO produto já usam (observações diferentes viram
 * linhas separadas). Sem informação (loja fechada, produto fora do cardápio):
 * só o máximo por item.
 */
export function limiteDaLinha(item, itens, produto) {
  const max = produto?.maxSacola ?? QUANTIDADE_MAX;
  const outras = itens
    .filter((i) => i.produtoId === item.produtoId && i.id !== item.id)
    .reduce((s, i) => s + i.quantidade, 0);
  return Math.max(0, Math.min(QUANTIDADE_MAX, max - outras));
}

/**
 * "Peça também": os marcados "Sugerir na sacola" na retaguarda; nenhum
 * marcado no cardápio de agora = as bebidas. Só com a loja aberta (cardápio
 * do turno ativo, já sem os sem saldo), por unidade, com saldo e fora da sacola.
 * @param {{ aberto: boolean, categorias: any[] } | null} cardapio
 * @param {{ produtoId: number }[]} itens
 * @param {Set<number>} [manter] ids que ficam visíveis mesmo já na sacola (feedback do "+")
 */
export function sugestoes(cardapio, itens, manter = new Set(), max = MAX_SUGESTOES) {
  if (!cardapio?.aberto) return [];
  const produtos = [...produtosDoCardapio(cardapio.categorias).values()];
  const marcados = produtos.filter((p) => p.sugerirNaSacola);
  const base = marcados.length ? marcados : produtos.filter((p) => normalizar(p.categoria) === 'bebidas');
  const naSacola = new Set(itens.map((i) => i.produtoId));
  return base
    .filter((p) => (manter.has(p.id) || !naSacola.has(p.id)) && p.tipoPreco !== 'POR_KG' && (p.maxSacola ?? 1) > 0)
    .slice(0, max);
}

/** Endereço que define a taxa da prévia: o principal ativo, senão o primeiro ativo. */
export function enderecoDaTaxa(enderecos) {
  const ativos = (enderecos ?? []).filter((e) => e.bairro?.ativo);
  return ativos.find((e) => e.principal) ?? ativos[0] ?? null;
}

/**
 * Valores da sacola. `taxaBairroCentavos` null = ainda desconhecida (sem
 * login ou sem endereço). Frete grátis atingido vale mesmo sem saber o bairro.
 */
export function resumoDaSacola(itens, { taxaBairroCentavos = null, freteGratis = null } = {}) {
  const subtotal = totalCentavos(itens);
  const gratis = ganhouFreteGratis(subtotal, freteGratis);
  const taxa = gratis ? 0 : taxaBairroCentavos;
  return {
    subtotalCentavos: subtotal,
    taxaEntregaCentavos: taxa,
    gratis,
    totalCentavos: subtotal + (taxa ?? 0),
    rotuloTotal: gratis ? 'Total com entrega grátis' : taxa == null ? 'Subtotal' : 'Total com entrega',
    progresso: progressoFreteGratis(subtotal, freteGratis),
  };
}
