import { lerTexto, gravarTexto, removerTexto } from '../lib/armazenamento.js';

/**
 * Sessão do cliente do site: só o JWT de cliente fica no navegador. Os dados
 * (nome, telefone, endereços) ficam na API e são buscados com ele.
 */
export const CHAVE_SESSAO = 'cabana-boemia:cliente:v1';

/** @returns {string | null} */
export function carregarToken(storage) {
  const t = lerTexto(CHAVE_SESSAO, storage);
  // Formato JWT (3 partes); qualquer outra coisa é lixo e vira "sem sessão".
  return t && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t) ? t : null;
}

export function salvarToken(token, storage) {
  return gravarTexto(CHAVE_SESSAO, token, storage);
}

export function apagarToken(storage) {
  removerTexto(CHAVE_SESSAO, storage);
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
