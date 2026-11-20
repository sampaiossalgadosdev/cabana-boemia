/**
 * Regras puras do cardápio no app (testadas com node:test): o que aparece,
 * quanto dá para pôr na sacola e o cardápio salvo no aparelho para abrir sem
 * internet.
 */
import { QUANTIDADE_MAX, adicionar } from './carrinho.js';
import { lerTexto, gravarTexto } from './armazenamento.js';
import { avisosDaRepeticao } from './pedido.js';

export const CHAVE_CARDAPIO = 'delivery-abatia:cardapio:v1';

/**
 * Cardápio salvo vale para montar a sacola por este tempo; depois disso, sem
 * internet, ele aparece só como prévia (a loja pode ter fechado, o preço pode
 * ter mudado). A API confere tudo de novo no envio.
 */
export const VALIDADE_PEDIDO_MS = 30 * 60_000;

/**
 * Categorias que aparecem. A API já não devolve produto sem saldo com a loja
 * aberta; o filtro aqui é defesa extra (maxSacola 0) e tira categoria vazia.
 * Fechada (prévia), `maxSacola` vem null e nada é filtrado.
 */
export function categoriasVisiveis(cardapio) {
  if (!cardapio?.categorias) return [];
  return cardapio.categorias
    .map((c) => ({
      ...c,
      produtos: cardapio.aberto ? c.produtos.filter((p) => p.maxSacola == null || p.maxSacola > 0) : c.produtos,
    }))
    .filter((c) => c.produtos.length > 0);
}

/**
 * Quantas unidades ainda cabem ao adicionar o produto: `maxSacola` (saldo,
 * nunca acima de 20) menos o que já está na sacola em qualquer linha dele.
 */
export function limiteParaAdicionar(itens, produto) {
  const max = produto?.maxSacola ?? QUANTIDADE_MAX;
  const naSacola = itens.filter((i) => i.produtoId === produto?.id).reduce((s, i) => s + i.quantidade, 0);
  return Math.max(0, Math.min(QUANTIDADE_MAX, max - naSacola));
}

/**
 * "Repetir pedido" no app: como o `repetirPedido` do site (só o que está no
 * cardápio agora, com o preço de agora e a mesma observação), mas sem passar
 * do saldo (`maxSacola`): o site deixa passar e a API recusa no envio. O que
 * coube só em parte vai em `limitados`; o que não coube nada, em `indisponiveis`.
 * @returns {{ itens: any[], adicionados: number, indisponiveis: string[], limitados: string[] }}
 */
export function repetirComSaldo(itensCarrinho, pedido, categorias) {
  const porId = new Map((categorias ?? []).flatMap((c) => c.produtos).map((p) => [p.id, p]));
  let itens = itensCarrinho;
  let adicionados = 0;
  const indisponiveis = [];
  const limitados = [];
  const anotar = (lista, nome) => !lista.includes(nome) && lista.push(nome);
  for (const item of pedido?.itens ?? []) {
    const produto = porId.get(item.produtoId);
    const cabe = produto ? limiteParaAdicionar(itens, produto) : 0;
    if (!cabe) {
      anotar(indisponiveis, produto?.nome ?? item.nome);
      continue;
    }
    const quantidade = Math.min(item.quantidade, cabe);
    if (quantidade < item.quantidade) anotar(limitados, produto.nome);
    itens = adicionar(itens, produto, quantidade, item.observacao ?? '');
    adicionados += quantidade;
  }
  return { itens, adicionados, indisponiveis, limitados };
}

/** Avisos do "repetir" (os do site + quem entrou com menos por causa do saldo). */
export function avisosDaRepeticaoComSaldo(r) {
  const { mensagens, abrirSacola } = avisosDaRepeticao(r);
  if (r.limitados?.length) mensagens.push(`Entrou só a quantidade disponível de: ${r.limitados.join(', ')}.`);
  return { mensagens, abrirSacola };
}

/** Formato mínimo de uma resposta de GET /publico/cardapio. */
function pareceCardapio(d) {
  return (
    d &&
    typeof d === 'object' &&
    typeof d.aberto === 'boolean' &&
    Array.isArray(d.categorias) &&
    d.categorias.every((c) => c && Number.isInteger(c.id) && typeof c.nome === 'string' && Array.isArray(c.produtos))
  );
}

/** Guarda a última resposta boa da API. @returns {Promise<boolean>} */
export function salvarCardapio(dados, agora = Date.now(), storage, chave = CHAVE_CARDAPIO) {
  return gravarTexto(chave, JSON.stringify({ salvoEm: agora, dados }), storage);
}

/** @returns {Promise<{ dados: any, salvoEm: number } | null>} null = nada salvo ou dado corrompido */
export async function lerCardapioSalvo(storage, chave = CHAVE_CARDAPIO) {
  const texto = await lerTexto(chave, storage);
  if (!texto) return null;
  try {
    const { salvoEm, dados } = JSON.parse(texto);
    return Number.isFinite(salvoEm) && pareceCardapio(dados) ? { dados, salvoEm } : null;
  } catch {
    return null;
  }
}

// ───────── Por loja (multi-loja) ─────────

/** Cada loja tem o seu cardápio salvo (e a configuração dela: nome, cor, logo, WhatsApp, dados legais). */
export const chaveCardapioDaLoja = (slug) => `delivery-abatia:cardapio:v2:${slug}`;

/** @param {{ cardapio: any, config: any }} dados */
export function salvarCardapioDaLoja(slug, { cardapio, config }, agora = Date.now(), storage) {
  return gravarTexto(chaveCardapioDaLoja(slug), JSON.stringify({ salvoEm: agora, dados: cardapio, config }), storage);
}

/** @returns {Promise<{ dados: any, config: any, salvoEm: number } | null>} */
export async function lerCardapioDaLoja(slug, storage) {
  const texto = await lerTexto(chaveCardapioDaLoja(slug), storage);
  if (!texto) return null;
  try {
    const { salvoEm, dados, config } = JSON.parse(texto);
    return Number.isFinite(salvoEm) && pareceCardapio(dados) && config && typeof config === 'object' ? { dados, config, salvoEm } : null;
  } catch {
    return null;
  }
}

/**
 * Dá para pôr na sacola? Com o cardápio vindo da rede agora: se a loja está
 * aberta. Com o salvo no aparelho (sem internet): só se estava aberta e foi
 * salvo há pouco (VALIDADE_PEDIDO_MS).
 * @param {{ dados: any, origem: 'rede' | 'aparelho', salvoEm: number } | null} estado
 */
export function podePedir(estado, agora = Date.now()) {
  if (!estado?.dados?.aberto) return false;
  if (estado.origem === 'rede') return true;
  return agora - estado.salvoEm < VALIDADE_PEDIDO_MS;
}

const hora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "Mostrando o cardápio das 19:42." para a faixa sem conexão (horário de Brasília). */
export const textoCardapioSalvo = (salvoEm) => `Mostrando o cardápio das ${hora.format(new Date(salvoEm))}.`;
