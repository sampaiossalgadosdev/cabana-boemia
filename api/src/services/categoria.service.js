/**
 * Categorias do cardápio (retaguarda). Não se exclui: desativar tira a
 * categoria (e seus produtos) do site e do PDV, e os pedidos antigos continuam
 * apontando para ela. Toda mudança avisa o PDV (`cardapio:atualizado`).
 */
import { ErroHttp, ehDuplicado, ehInexistente } from '../lib/erros.js';
import { avisarCardapioAtualizado } from '../lib/eventos.js';
import * as categoriaRepo from '../repositories/categoria.repository.js';

const nomeEmUso = () => new ErroHttp(409, 'Já existe uma categoria com este nome', { codigo: 'NOME_EM_USO' });
const naoEncontrada = () => new ErroHttp(404, 'Categoria não encontrada', { codigo: 'NAO_ENCONTRADO' });

const publica = ({ _count, ...c }) => ({ ...c, quantidadeProdutos: _count.produtos });

export async function listar(lojaId) {
  return (await categoriaRepo.listar(lojaId)).map(publica);
}

/** @param {{ nome: string, ordem?: number, ativo?: boolean }} dados */
export async function criar(lojaId, dados) {
  try {
    const categoria = await categoriaRepo.criar(lojaId, dados);
    avisarCardapioAtualizado(lojaId, 'categorias');
    return publica(categoria);
  } catch (err) {
    if (ehDuplicado(err)) throw nomeEmUso();
    throw err;
  }
}

/** @param {{ nome?: string, ordem?: number, ativo?: boolean }} dados */
export async function atualizar(lojaId, id, dados) {
  try {
    const categoria = await categoriaRepo.atualizar(lojaId, id, dados);
    avisarCardapioAtualizado(lojaId, 'categorias');
    return publica(categoria);
  } catch (err) {
    if (ehDuplicado(err)) throw nomeEmUso();
    if (ehInexistente(err)) throw naoEncontrada();
    throw err;
  }
}
