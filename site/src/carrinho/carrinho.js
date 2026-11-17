/**
 * Lógica pura do carrinho (sem React), testada com node:test.
 *
 * Cada linha é { id, produtoId, nome, precoCentavos, quantidade, observacao }.
 * O id da linha = produto + observação normalizada: o mesmo produto com a mesma
 * observação soma na mesma linha; com observação diferente vira outra linha.
 */
import { formatarPreco } from '../lib/dinheiro.js';
import { lerTexto, gravarTexto } from '../lib/armazenamento.js';

export const CHAVE_STORAGE = 'cabana-boemia:carrinho:v1';
export const OBSERVACAO_MAX = 140;
export const QUANTIDADE_MAX = 20;

export function normalizarObservacao(texto = '') {
  return String(texto).replace(/\s+/g, ' ').trim().slice(0, OBSERVACAO_MAX);
}

export function idLinha(produtoId, observacao) {
  return `${produtoId}:${normalizarObservacao(observacao).toLocaleLowerCase('pt-BR')}`;
}

export function limitarQuantidade(q) {
  const n = Math.trunc(Number(q));
  return Number.isFinite(n) ? Math.min(QUANTIDADE_MAX, Math.max(1, n)) : 1;
}

/** @param {{ id: number, nome: string, precoCentavos: number }} produto */
export function adicionar(itens, produto, quantidade = 1, observacao = '') {
  const obs = normalizarObservacao(observacao);
  const id = idLinha(produto.id, obs);
  if (itens.some((i) => i.id === id)) {
    return itens.map((i) =>
      i.id === id
        ? {
            ...i,
            nome: produto.nome,
            precoCentavos: produto.precoCentavos,
            quantidade: limitarQuantidade(i.quantidade + quantidade),
          }
        : i,
    );
  }
  return [
    ...itens,
    {
      id,
      produtoId: produto.id,
      nome: produto.nome,
      precoCentavos: produto.precoCentavos,
      quantidade: limitarQuantidade(quantidade),
      observacao: obs,
    },
  ];
}

/**
 * Muda quantidade/observação de uma linha. Se a nova observação coincidir com
 * a de outra linha do mesmo produto, as duas se juntam.
 */
export function editar(itens, id, { quantidade, observacao }) {
  const atual = itens.find((i) => i.id === id);
  if (!atual) return itens;
  const obs = normalizarObservacao(observacao);
  const novoId = idLinha(atual.produtoId, obs);
  const qtd = limitarQuantidade(quantidade);

  if (novoId !== id && itens.some((i) => i.id === novoId)) {
    return itens
      .filter((i) => i.id !== id)
      .map((i) => (i.id === novoId ? { ...i, quantidade: limitarQuantidade(i.quantidade + qtd) } : i));
  }
  return itens.map((i) => (i.id === id ? { ...i, id: novoId, observacao: obs, quantidade: qtd } : i));
}

export function remover(itens, id) {
  return itens.filter((i) => i.id !== id);
}

export const subtotal = (item) => item.precoCentavos * item.quantidade;
export const totalCentavos = (itens) => itens.reduce((s, i) => s + subtotal(i), 0);
export const totalItens = (itens) => itens.reduce((s, i) => s + i.quantidade, 0);

/**
 * Confronta o carrinho com o cardápio recém-buscado: tira o que sumiu e
 * atualiza nome/preço. Só chamar com uma resposta bem-sucedida da API.
 * @returns {{ itens: any[], removidos: string[], precosAlterados: { nome: string, de: number, para: number }[], mudou: boolean }}
 */
export function conciliar(itens, categorias) {
  const porId = new Map(categorias.flatMap((c) => c.produtos).map((p) => [p.id, p]));
  const removidos = new Set();
  const precos = new Map();
  const novos = [];

  for (const item of itens) {
    const p = porId.get(item.produtoId);
    if (!p) {
      removidos.add(item.nome);
      continue;
    }
    if (p.precoCentavos !== item.precoCentavos) {
      precos.set(p.nome, { nome: p.nome, de: item.precoCentavos, para: p.precoCentavos });
    }
    novos.push(
      p.nome === item.nome && p.precoCentavos === item.precoCentavos
        ? item
        : { ...item, nome: p.nome, precoCentavos: p.precoCentavos },
    );
  }

  const mudou = novos.length !== itens.length || novos.some((n, i) => n !== itens[i]);
  return { itens: mudou ? novos : itens, removidos: [...removidos], precosAlterados: [...precos.values()], mudou };
}

/** Textos para avisar o cliente sobre o que a conciliação mudou. */
export function mensagensDaConciliacao({ removidos, precosAlterados }) {
  const msgs = [];
  if (removidos.length === 1) {
    msgs.push(`${removidos[0]} saiu do cardápio e foi removido da sua sacola.`);
  } else if (removidos.length > 1) {
    const lista = `${removidos.slice(0, -1).join(', ')} e ${removidos.at(-1)}`;
    msgs.push(`${lista} saíram do cardápio e foram removidos da sua sacola.`);
  }
  for (const p of precosAlterados) {
    msgs.push(`O preço de ${p.nome} mudou de ${formatarPreco(p.de)} para ${formatarPreco(p.para)}.`);
  }
  return msgs;
}

// ───────────── Persistência ─────────────

const ehInteiroPositivo = (n) => Number.isInteger(n) && n > 0;

/** Lê o carrinho salvo. Qualquer coisa inválida vira carrinho vazio (ou some a linha ruim). */
export function carregarCarrinho(storage) {
  const texto = lerTexto(CHAVE_STORAGE, storage);
  if (!texto) return [];
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    return [];
  }
  if (!Array.isArray(dados)) return [];

  let itens = [];
  for (const i of dados) {
    if (
      i &&
      ehInteiroPositivo(i.produtoId) &&
      typeof i.nome === 'string' &&
      Number.isInteger(i.precoCentavos) &&
      i.precoCentavos >= 0
    ) {
      // Reconstrói pela mesma regra de adicionar(): normaliza e junta duplicatas.
      itens = adicionar(
        itens,
        { id: i.produtoId, nome: i.nome, precoCentavos: i.precoCentavos },
        limitarQuantidade(i.quantidade),
        typeof i.observacao === 'string' ? i.observacao : '',
      );
    }
  }
  return itens;
}

export function salvarCarrinho(itens, storage) {
  return gravarTexto(CHAVE_STORAGE, JSON.stringify(itens), storage);
}
