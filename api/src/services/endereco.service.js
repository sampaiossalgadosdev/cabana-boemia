import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import * as enderecoRepo from '../repositories/endereco.repository.js';

export const ENDERECOS_MAX = 10;

const naoEncontrado = () =>
  new ErroHttp(404, 'Endereço não encontrado', { codigo: 'NAO_ENCONTRADO' });

/**
 * O endereço é do cliente (cadastro único entre lojas), mas o bairro é de uma
 * loja: com `lojaId`, o bairro precisa ser atendido por ela.
 */
async function garantirBairroAtivo(bairroId, lojaId, db) {
  const bairro = await enderecoRepo.buscarBairro(bairroId, db);
  if (!bairro || !bairro.ativo || (lojaId != null && bairro.lojaId !== lojaId)) {
    throw new ErroHttp(422, 'Não entregamos neste bairro', { codigo: 'BAIRRO_INVALIDO' });
  }
}

export function listar(clienteId) {
  return enderecoRepo.listarDoCliente(clienteId);
}

/**
 * O primeiro endereço vira principal. Marcar um como principal desmarca os
 * outros: no máximo um principal por cliente (regra sem suporte no schema).
 */
export function criar(clienteId, { principal, ...dados }, { lojaId = null } = {}) {
  return prisma.$transaction(async (tx) => {
    await garantirBairroAtivo(dados.bairroId, lojaId, tx);
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
}

export function atualizar(clienteId, id, { principal, ...dados }, { lojaId = null } = {}) {
  return prisma.$transaction(async (tx) => {
    if (!(await enderecoRepo.buscarDoCliente(clienteId, id, tx))) throw naoEncontrado();
    await garantirBairroAtivo(dados.bairroId, lojaId, tx);
    if (principal === true) await enderecoRepo.desmarcarPrincipais(clienteId, id, tx);
    const campos = principal === undefined ? dados : { ...dados, principal };
    return enderecoRepo.atualizar(id, campos, tx);
  });
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
