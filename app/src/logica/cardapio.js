/**
 * Regras puras do cardápio no app (testadas com node:test): o que aparece,
 * quanto dá para pôr na sacola e o cardápio salvo no aparelho para abrir sem
 * internet.
 */
import { QUANTIDADE_MAX } from './carrinho.js';
import { lerTexto, gravarTexto } from './armazenamento.js';

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
export function salvarCardapio(dados, agora = Date.now(), storage) {
  return gravarTexto(CHAVE_CARDAPIO, JSON.stringify({ salvoEm: agora, dados }), storage);
}

/** @returns {Promise<{ dados: any, salvoEm: number } | null>} null = nada salvo ou dado corrompido */
export async function lerCardapioSalvo(storage) {
  const texto = await lerTexto(CHAVE_CARDAPIO, storage);
  if (!texto) return null;
  try {
    const { salvoEm, dados } = JSON.parse(texto);
    return Number.isFinite(salvoEm) && pareceCardapio(dados) ? { dados, salvoEm } : null;
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
