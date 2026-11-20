/**
 * Regras puras do checkout do app (as mesmas do site: componentes
 * Finalizacao.jsx, FormEndereco.jsx e Checkout.jsx), testadas com node:test.
 */
import { formatarPreco } from './dinheiro.js';
import { mensagensDaConciliacao } from './carrinho.js';
import { aplicarPrecosNovos, erroDoTroco, lerReais } from './pedido.js';

export const ERRO_GENERICO_ENVIO = 'Não foi possível enviar agora. Confira sua conexão e tente de novo.';
export const ERRO_GENERICO = 'Não foi possível concluir agora. Confira sua conexão e tente de novo.';

/** Erros da API que significam "o cardápio mudou": recarregar e conciliar a sacola. */
export const CARDAPIO_MUDOU = new Set(['ESTOQUE_INSUFICIENTE', 'PRODUTO_INDISPONIVEL', 'LOJA_FECHADA']);

/** "Rua das Flores, 120 - Casa 2" */
export const textoEndereco = (e) => `${e.rua}, ${e.numero}${e.complemento ? ` - ${e.complemento}` : ''}`;

/** Endereço pré-selecionado: o principal com bairro ativo, senão o primeiro ativo. */
export function enderecoInicial(enderecos) {
  return enderecos.find((e) => e.principal && e.bairro.ativo) ?? enderecos.find((e) => e.bairro.ativo) ?? null;
}

/** Erros de validação da API ({ campo, mensagem }[]) por campo; sem eles, `{ geral }`. */
export function errosPorCampo(erro, generico = ERRO_GENERICO) {
  const porCampo = Object.fromEntries((Array.isArray(erro?.detalhes) ? erro.detalhes : []).map((d) => [d.campo, d.mensagem]));
  return Object.keys(porCampo).length ? porCampo : { geral: erro?.status ? erro.message : generico };
}

/** Formulário de endereço: rua, número e bairro obrigatórios. */
export function validarEndereco(dados) {
  const erros = {};
  if (!String(dados.rua ?? '').trim()) erros.rua = 'Informe a rua';
  if (!String(dados.numero ?? '').trim()) erros.numero = 'Informe o número';
  if (!dados.bairroId) erros.bairroId = 'Escolha o bairro';
  return erros;
}

/**
 * Troco: só em dinheiro e só se o cliente marcou "Preciso de troco".
 * @returns {{ trocoParaCentavos: number | null, erro: string | null }}
 */
export function trocoDoCheckout({ forma, precisaTroco, texto, totalCentavos }) {
  if (forma !== 'DINHEIRO' || !precisaTroco) return { trocoParaCentavos: null, erro: null };
  const centavos = lerReais(texto);
  if (centavos == null) return { trocoParaCentavos: null, erro: 'Informe o valor, ex.: 100' };
  return { trocoParaCentavos: centavos, erro: erroDoTroco(centavos, totalCentavos) };
}

/**
 * O que fazer com o erro do POST /cliente/pedidos.
 * - 'sair': sessão morta (401).
 * - 'preco' (409 PRECO_ALTERADO): nada foi criado; aplicar preços/taxa/frete
 *   novos e pedir para tocar em "Enviar pedido" de novo (mesma chave).
 * - 'cardapio': estoque, produto ou loja mudou; recarregar o cardápio.
 * - 'endereco' (422 BAIRRO_FORA_DA_AREA): a loja não entrega no endereço; mostrar a mensagem e trocar o endereço.
 * - 'mensagem': a API recusou (mostra o texto dela) ou rede (genérico; a
 *   mesma chave de idempotência garante que reenviar não duplica).
 * @param {{ itens: any[], taxaBairroCentavos: number, taxaEntregaCentavos: number }} ctx
 */
export function interpretarErroDoEnvio(erro, { itens, taxaBairroCentavos, taxaEntregaCentavos }) {
  if (erro?.status === 401) return { acao: 'sair' };
  if (erro?.codigo === 'PRECO_ALTERADO') {
    const d = erro.detalhes ?? {};
    const r = aplicarPrecosNovos(itens, d.itens);
    const linhas = mensagensDaConciliacao({ removidos: [], precosAlterados: r.alterados });
    const taxa = d.taxaEntregaCentavos;
    if (Number.isInteger(taxa) && taxa !== taxaEntregaCentavos) {
      linhas.push(taxa === 0 ? 'Seu pedido ganhou frete grátis.' : `A taxa de entrega mudou para ${formatarPreco(taxa)}.`);
    }
    return {
      acao: 'preco',
      itens: r.alterados.length ? r.itens : null,
      taxaBairroCentavos:
        Number.isInteger(d.taxaBairroCentavos) && d.taxaBairroCentavos !== taxaBairroCentavos ? d.taxaBairroCentavos : null,
      freteGratis: 'freteGratis' in d ? { valor: d.freteGratis } : null,
      mensagem: [...(linhas.length ? linhas : ['Os preços mudaram.']), 'Confira o novo total e toque em "Enviar pedido" para confirmar.'].join(' '),
    };
  }
  if (erro?.status && CARDAPIO_MUDOU.has(erro.codigo)) return { acao: 'cardapio', mensagem: erro.message };
  // A loja não entrega no bairro do endereço (a API manda "<Loja> não entrega no bairro X..."): trocar o endereço.
  if (erro?.codigo === 'BAIRRO_FORA_DA_AREA') return { acao: 'endereco', mensagem: erro.message };
  return { acao: 'mensagem', mensagem: erro?.status ? erro.message : ERRO_GENERICO_ENVIO };
}
