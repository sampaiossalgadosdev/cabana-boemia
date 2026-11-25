import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import * as enderecoRepo from '../repositories/endereco.repository.js';
import { bairroParaLoja } from './bairro.service.js';
import { dentroDoRaio, mapasPadrao } from './mapa.service.js';

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

/**
 * Pino do corpo: `undefined` (nenhum dos dois veio), `null` (os dois null = apagar)
 * ou `{ latitude, longitude }` dentro do raio da cidade. Só um dos dois = 400;
 * longe da cidade (lat/lng trocadas, 0,0) = 422 PINO_INVALIDO.
 */
export function pinoDoCorpo({ latitude, longitude }, config = mapasPadrao().config) {
  if (latitude === undefined && longitude === undefined) return undefined;
  if (latitude == null && longitude == null) return null;
  if (latitude == null || longitude == null) {
    throw new ErroHttp(400, 'Informe a latitude e a longitude do pino', { codigo: 'VALIDACAO' });
  }
  // 6 casas (~0,1 m): mais que isso é ruído do GPS/arrasto.
  const pin = { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
  if (!dentroDoRaio(pin, config)) {
    throw new ErroHttp(422, 'O pino está longe da cidade. Confira a posição no mapa.', { codigo: 'PINO_INVALIDO' });
  }
  return pin;
}

const camposDoPino = (pin) => (pin === undefined ? {} : { latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null });

/** Rua, número ou bairro mudaram? (o pino antigo deixa de valer) */
const mudouOLugar = (antes, depois) =>
  antes.rua.trim() !== depois.rua.trim() || antes.numero.trim() !== depois.numero.trim() || antes.bairro.id !== depois.bairroId;

/** Endereço com o bairro visto pela loja (`ativo` = a loja entrega lá; taxa da loja). */
export const enderecoParaLoja = (e, lojaId) => ({ ...e, bairro: bairroParaLoja(e.bairro, lojaId) });

export async function listar(clienteId, { lojaId } = {}) {
  return (await enderecoRepo.listarDoCliente(clienteId)).map((e) => enderecoParaLoja(e, lojaId));
}

/**
 * O primeiro endereço vira principal. Marcar um como principal desmarca os
 * outros: no máximo um principal por cliente (regra sem suporte no schema).
 */
export async function criar(clienteId, { principal, latitude, longitude, ...dados }, { lojaId = null } = {}) {
  const pin = pinoDoCorpo({ latitude, longitude });
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
    return enderecoRepo.criar({ ...dados, ...camposDoPino(pin), clienteId, principal: ehPrincipal }, tx);
  });
  return enderecoParaLoja(endereco, lojaId);
}

/**
 * Pino ausente no corpo não mexe no salvo, MENOS quando rua, número ou bairro
 * mudam: aí o pino antigo é apagado (apontaria para o lugar antigo). Site, PDV
 * e o app sem mapa não mandam pino.
 */
export async function atualizar(clienteId, id, { principal, latitude, longitude, ...dados }, { lojaId = null } = {}) {
  let pin = pinoDoCorpo({ latitude, longitude });
  const endereco = await prisma.$transaction(async (tx) => {
    const antes = await enderecoRepo.buscarDoCliente(clienteId, id, tx);
    if (!antes) throw naoEncontrado();
    await garantirBairroAtivo(dados.bairroId, tx);
    if (pin === undefined && mudouOLugar(antes, dados)) pin = null;
    if (principal === true) await enderecoRepo.desmarcarPrincipais(clienteId, id, tx);
    const base = { ...dados, ...camposDoPino(pin) };
    const campos = principal === undefined ? base : { ...base, principal };
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
