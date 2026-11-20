import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import * as enderecoRepo from '../repositories/endereco.repository.js';
import { bairroParaLoja } from './bairro.service.js';

export const ENDERECOS_MAX = 10;

const naoEncontrado = () =>
  new ErroHttp(404, 'Endereço não encontrado', { codigo: 'NAO_ENCONTRADO' });

/**
 * O endereço é do cliente (cadastro único entre lojas) e aponta para um bairro
 * da CIDADE: vale para qualquer loja. Só recusa bairro inexistente ou desativado
 * na cidade; se a loja entrega lá, é conferido no pedido (BAIRRO_FORA_DA_AREA).
 */
export async function garantirBairroAtivo(bairroId, db) {
  const bairro = await enderecoRepo.buscarBairro(bairroId, db);
  if (!bairro || !bairro.ativo) {
    throw new ErroHttp(422, 'Bairro não encontrado', { codigo: 'BAIRRO_INVALIDO' });
  }
}

/** Endereço com o bairro visto pela loja (`ativo` = a loja entrega lá; taxa da loja). */
export const enderecoParaLoja = (e, lojaId) => ({ ...e, bairro: bairroParaLoja(e.bairro, lojaId) });

export async function listar(clienteId, { lojaId } = {}) {
  return (await enderecoRepo.listarDoCliente(clienteId)).map((e) => enderecoParaLoja(e, lojaId));
}

/**
 * O primeiro endereço vira principal. Marcar um como principal desmarca os
 * outros: no máximo um principal por cliente (regra sem suporte no schema).
 */
export async function criar(clienteId, { principal, ...dados }, { lojaId = null } = {}) {
  const endereco = await prisma.$transaction(async (tx) => {
    await garantirBairroAtivo(dados.bairroId, tx);
    const total = await enderecoRepo.contarDoCliente(clienteId, tx);
    if (total >= ENDERECOS_MAX) {
      throw new ErroHttp(409, `Limite de ${ENDERECOS_MAX} endereços. Apague um para cadastrar outro.`, {
        codigo: 'LIMITE_ENDERECOS',
      });
    }
    const ehPrincipal = principal === true || total === 0;
    if (ehPrincipal) await enderecoRepo.desmarcarPrincipais(clienteId, null, tx);
    return enderecoRepo.criar({ ...dados, clienteId, principal: ehPrincipal }, tx);
  });
  return enderecoParaLoja(endereco, lojaId);
}

export async function atualizar(clienteId, id, { principal, ...dados }, { lojaId = null } = {}) {
  const endereco = await prisma.$transaction(async (tx) => {
    if (!(await enderecoRepo.buscarDoCliente(clienteId, id, tx))) throw naoEncontrado();
    await garantirBairroAtivo(dados.bairroId, tx);
    if (principal === true) await enderecoRepo.desmarcarPrincipais(clienteId, id, tx);
    const campos = principal === undefined ? dados : { ...dados, principal };
    return enderecoRepo.atualizar(id, campos, tx);
  });
  return enderecoParaLoja(endereco, lojaId);
}

/** Apagar o principal promove o endereço mais recente que sobrou. */
export function remover(clienteId, id) {
  return prisma.$transaction(async (tx) => {
    const endereco = await enderecoRepo.buscarDoCliente(clienteId, id, tx);
    if (!endereco) throw naoEncontrado();
    await enderecoRepo.remover(id, tx);
    if (endereco.principal) {
      const proximo = await enderecoRepo.maisRecente(clienteId, tx);
      if (proximo) await enderecoRepo.atualizar(proximo.id, { principal: true }, tx);
    }
  });
}
