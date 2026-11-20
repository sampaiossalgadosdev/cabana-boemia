/**
 * Bairros e taxas de entrega (retaguarda). Não se exclui: endereços de
 * clientes apontam para o bairro; desativar tira o bairro do site e do PDV.
 * A taxa vale para pedidos novos (o pedido grava o snapshot da taxa).
 */
import { ErroHttp, ehDuplicado, ehInexistente } from '../lib/erros.js';
import { avisarCardapioAtualizado } from '../lib/eventos.js';
import * as bairroRepo from '../repositories/bairro.repository.js';

const nomeEmUso = () => new ErroHttp(409, 'Já existe um bairro com este nome', { codigo: 'NOME_EM_USO' });

export function listar(lojaId) {
  return bairroRepo.listar(lojaId);
}

async function gravar(lojaId, fn) {
  try {
    const bairro = await fn();
    avisarCardapioAtualizado(lojaId, 'bairros');
    return bairro;
  } catch (err) {
    if (ehDuplicado(err)) throw nomeEmUso();
    if (ehInexistente(err)) throw new ErroHttp(404, 'Bairro não encontrado', { codigo: 'NAO_ENCONTRADO' });
    throw err;
  }
}

/** @param {{ nome: string, taxaCentavos: number, ativo?: boolean }} dados */
export function criar(lojaId, dados) {
  return gravar(lojaId, () => bairroRepo.criar(lojaId, dados));
}

/** @param {{ nome?: string, taxaCentavos?: number, ativo?: boolean }} dados */
export function atualizar(lojaId, id, dados) {
  return gravar(lojaId, () => bairroRepo.atualizar(lojaId, id, dados));
}
