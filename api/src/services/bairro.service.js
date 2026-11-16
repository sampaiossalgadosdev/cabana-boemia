/**
 * Bairros e taxas de entrega (retaguarda). Não se exclui: endereços de
 * clientes apontam para o bairro; desativar tira o bairro do site e do PDV.
 * A taxa vale para pedidos novos (o pedido grava o snapshot da taxa).
 */
import { ErroHttp, ehDuplicado, ehInexistente } from '../lib/erros.js';
import { avisarCardapioAtualizado } from '../lib/eventos.js';
import * as bairroRepo from '../repositories/bairro.repository.js';

const nomeEmUso = () => new ErroHttp(409, 'Já existe um bairro com este nome', { codigo: 'NOME_EM_USO' });

export function listar() {
  return bairroRepo.listar();
}

async function gravar(fn) {
  try {
    const bairro = await fn();
    avisarCardapioAtualizado('bairros');
    return bairro;
  } catch (err) {
    if (ehDuplicado(err)) throw nomeEmUso();
    if (ehInexistente(err)) throw new ErroHttp(404, 'Bairro não encontrado', { codigo: 'NAO_ENCONTRADO' });
    throw err;
  }
}

/** @param {{ nome: string, taxaCentavos: number, ativo?: boolean }} dados */
export function criar(dados) {
  return gravar(() => bairroRepo.criar(dados));
}

/** @param {{ nome?: string, taxaCentavos?: number, ativo?: boolean }} dados */
export function atualizar(id, dados) {
  return gravar(() => bairroRepo.atualizar(id, dados));
}
