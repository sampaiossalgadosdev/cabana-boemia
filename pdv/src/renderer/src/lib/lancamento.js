/**
 * Lançamento de delivery do WhatsApp no PDV: carrinho, estado dos botões da
 * grade e pagamento. Lógica pura (testada com node:test). Os valores aqui são
 * só para mostrar: o preço e o total oficiais saem da API.
 */

/** Limite da API por linha (itemPedidoSchema). */
export const MAX_POR_LINHA = 20;

let seq = 0;
const novaChave = () => `l${Date.now().toString(36)}${(seq += 1)}`;

const normalizarObs = (obs) => String(obs ?? '').trim().slice(0, 140);

/** Unidades do produto somando todas as linhas. */
export const quantidadeNoCarrinho = (linhas, produtoId) =>
  linhas.filter((l) => l.produtoId === produtoId).reduce((s, l) => s + l.quantidade, 0);

/**
 * Estado do botão do produto na grade.
 * Esgotado (sem saldo agora) = desabilitado. Saldo já todo no carrinho =
 * desabilitado. Fora de "disponível hoje" só ganha um aviso (a equipe pode lançar).
 */
export function estadoDoProduto(produto, linhas = []) {
  if (produto.esgotado) return { desabilitado: true, motivo: 'Esgotado', foraDeHoje: !produto.disponivelHoje };
  const noCarrinho = quantidadeNoCarrinho(linhas, produto.id);
  if (produto.saldo != null && noCarrinho >= produto.saldo) {
    return { desabilitado: true, motivo: 'Sem mais saldo', foraDeHoje: !produto.disponivelHoje };
  }
  const restam = produto.saldo == null ? null : produto.saldo - noCarrinho;
  return { desabilitado: false, motivo: null, foraDeHoje: !produto.disponivelHoje, restam };
}

/**
 * Toque no produto: +1 na linha sem observação daquele produto (ou linha
 * nova). Linhas com observação ficam separadas. Respeita saldo e limite.
 */
export function adicionarProduto(linhas, produto) {
  if (estadoDoProduto(produto, linhas).desabilitado) return linhas;
  const i = linhas.findIndex((l) => l.produtoId === produto.id && l.observacao === '');
  if (i >= 0) {
    if (linhas[i].quantidade >= MAX_POR_LINHA) return linhas;
    return linhas.map((l, j) => (j === i ? { ...l, quantidade: l.quantidade + 1 } : l));
  }
  return [
    ...linhas,
    { chave: novaChave(), produtoId: produto.id, nome: produto.nome, precoCentavos: produto.precoCentavos, quantidade: 1, observacao: '' },
  ];
}

/** +1/−1 numa linha; chegar a 0 remove. O +1 respeita saldo e limite. */
export function alterarQuantidade(linhas, chave, delta, produto) {
  const linha = linhas.find((l) => l.chave === chave);
  if (!linha) return linhas;
  if (delta > 0) {
    if (linha.quantidade >= MAX_POR_LINHA) return linhas;
    if (produto && estadoDoProduto(produto, linhas).desabilitado) return linhas;
  }
  const quantidade = linha.quantidade + delta;
  if (quantidade <= 0) return linhas.filter((l) => l.chave !== chave);
  return linhas.map((l) => (l.chave === chave ? { ...l, quantidade } : l));
}

export const removerLinha = (linhas, chave) => linhas.filter((l) => l.chave !== chave);

/** Observação digitada (sem juntar enquanto digita). */
export function definirObservacao(linhas, chave, observacao) {
  return linhas.map((l) => (l.chave === chave ? { ...l, observacao: String(observacao ?? '').slice(0, 140) } : l));
}

/**
 * Ao sair do campo: normaliza e junta linhas do mesmo produto com a mesma
 * observação (como no carrinho do site), sem passar do limite por linha.
 */
export function consolidar(linhas) {
  const saida = [];
  for (const l of linhas) {
    const obs = normalizarObs(l.observacao);
    const igual = saida.find(
      (s) => s.produtoId === l.produtoId && s.observacao === obs && s.quantidade + l.quantidade <= MAX_POR_LINHA,
    );
    if (igual) igual.quantidade += l.quantidade;
    else saida.push({ ...l, observacao: obs });
  }
  return saida;
}

/**
 * Atualiza nome/preço com o cardápio recarregado. Não remove o que não veio:
 * o cardápio é de um turno só (trocar de turno não pode esvaziar o carrinho);
 * produto que saiu de fato é recusado pela API (PRODUTO_INDISPONIVEL, com o nome).
 */
export function atualizarPrecos(linhas, produtosPorId) {
  return linhas.map((l) => {
    const p = produtosPorId.get(l.produtoId);
    return p ? { ...l, nome: p.nome, precoCentavos: p.precoCentavos } : l;
  });
}

export function totais(linhas, taxaEntregaCentavos = 0) {
  const subtotalCentavos = linhas.reduce((s, l) => s + l.precoCentavos * l.quantidade, 0);
  return { subtotalCentavos, taxaEntregaCentavos, totalCentavos: subtotalCentavos + taxaEntregaCentavos };
}

export const itensParaApi = (linhas) =>
  consolidar(linhas).map((l) => ({ produtoId: l.produtoId, quantidade: l.quantidade, observacao: l.observacao || null }));

/** "50" / "50,00" / "R$ 50,5" → centavos (Int) ou null se vazio/ inválido. */
export function lerReais(texto) {
  const t = String(texto ?? '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

/**
 * Troco: só em dinheiro; vazio = não precisa; senão tem que ser maior que o total.
 * @returns {{ trocoParaCentavos: number | null, erro: string | null, levarCentavos: number | null }}
 */
export function avaliarTroco(forma, texto, totalCentavos) {
  if (forma !== 'DINHEIRO') return { trocoParaCentavos: null, erro: null, levarCentavos: null };
  const centavos = lerReais(texto);
  if (centavos == null) return { trocoParaCentavos: null, erro: null, levarCentavos: null };
  if (Number.isNaN(centavos)) return { trocoParaCentavos: null, erro: 'Valor inválido', levarCentavos: null };
  if (centavos <= totalCentavos) {
    return { trocoParaCentavos: null, erro: 'O troco precisa ser para um valor maior que o total', levarCentavos: null };
  }
  return { trocoParaCentavos: centavos, erro: null, levarCentavos: centavos - totalCentavos };
}

/** Texto do endereço para confirmar com o cliente. */
export function textoEndereco(e) {
  let t = `${e.rua}, ${e.numero}`;
  if (e.complemento) t += ` - ${e.complemento}`;
  if (e.referencia) t += ` (Ref.: ${e.referencia})`;
  return t;
}

/** A busca parece um telefone? (para pré-preencher o cadastro rápido) */
export const pareceTelefone = (busca) => {
  const t = String(busca ?? '').trim();
  return /^[\d\s()+.-]+$/.test(t) && t.replace(/\D/g, '').length >= 4;
};
