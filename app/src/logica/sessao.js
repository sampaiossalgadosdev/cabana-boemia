import { lerTexto, gravarTexto, removerTexto } from './armazenamento.js';

/**
 * Sessão do cliente (cópia de site/src/cliente/sessao.js): só o JWT de cliente
 * fica no aparelho (AsyncStorage por enquanto; ver CLAUDE.md › App). Os dados
 * (nome, telefone, endereços) ficam na API e são buscados com ele.
 */
export const CHAVE_SESSAO = 'delivery-abatia:cliente:v1';

/** @returns {Promise<string | null>} */
export async function carregarToken(storage) {
  const t = await lerTexto(CHAVE_SESSAO, storage);
  // Formato JWT (3 partes); qualquer outra coisa é lixo e vira "sem sessão".
  return t && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t) ? t : null;
}

/** @returns {Promise<boolean>} */
export function salvarToken(token, storage) {
  return gravarTexto(CHAVE_SESSAO, token, storage);
}

export function apagarToken(storage) {
  return removerTexto(CHAVE_SESSAO, storage);
}

/**
 * Qual passo do checkout mostrar.
 * @param {{ status: 'anonimo' | 'carregando' | 'logado', cliente: { precisaTelefone: boolean } | null }} sessao
 * @returns {'carregando' | 'login' | 'telefone' | 'pronto'}
 */
export function etapaCheckout({ status, cliente }) {
  if (status === 'carregando') return 'carregando';
  if (status !== 'logado' || !cliente) return 'login';
  if (cliente.precisaTelefone || !cliente.telefone) return 'telefone';
  return 'pronto';
}

/** 401 da API = sessão morta (token expirado, inválido ou cliente apagado). */
export const sessaoExpirou = (erro) => erro?.status === 401;
