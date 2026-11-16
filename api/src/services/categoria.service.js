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

export async function listar() {
  return (await categoriaRepo.listar()).map(publica);
}

/** @param {{ nome: string, ordem?: number, ativo?: boolean }} dados */
export async function criar(dados) {
  try {
    const categoria = await categoriaRepo.criar(dados);
    avisarCardapioAtualizado('categorias');
    return publica(categoria);
  } catch (err) {
    if (ehDuplicado(err)) throw nomeEmUso();
    throw err;
  }
}

/** @param {{ nome?: string, ordem?: number, ativo?: boolean }} dados */
export async function atualizar(id, dados) {
  try {
    const categoria = await categoriaRepo.atualizar(id, dados);
    avisarCardapioAtualizado('categorias');
    return publica(categoria);
  } catch (err) {
    if (ehDuplicado(err)) throw nomeEmUso();
    if (ehInexistente(err)) throw naoEncontrada();
    throw err;
  }
}
