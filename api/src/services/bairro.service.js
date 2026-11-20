/**
 * Bairros: lista única da CIDADE (cadastrada pelo ADMIN) + ÁREA DE ENTREGA de
 * cada loja (bairro, taxa e ativo; editada pelo DONO na retaguarda).
 *
 * - O endereço do cliente aponta para o bairro da cidade e vale para qualquer loja.
 * - A taxa sai da área da loja do pedido; fora da área = 422 BAIRRO_FORA_DA_AREA.
 * - Não se exclui (endereços e pedidos apontam para o bairro): desativa-se.
 *   Bairro desativado na cidade = nenhuma loja entrega lá; área desativada = só aquela loja.
 * - A taxa vale para pedidos novos (o pedido grava o snapshot).
 */
import { ErroHttp, ehDuplicado, ehInexistente } from '../lib/erros.js';
import { avisarCardapioAtualizado } from '../lib/eventos.js';
import * as bairroRepo from '../repositories/bairro.repository.js';

/**
 * Função pura: o bairro de um endereço visto por uma loja, no formato de sempre
 * do site, do app e do PDV: `{ id, nome, taxaCentavos, ativo }`. `ativo` = a loja
 * entrega lá agora; fora da área, `taxaCentavos` = null.
 * @param {{ id: number, nome: string, ativo: boolean, areas?: { lojaId: number, taxaCentavos: number, ativo: boolean }[] }} bairro
 */
export function bairroParaLoja(bairro, lojaId) {
  const area = bairro.areas?.find((a) => a.lojaId === lojaId);
  const entrega = Boolean(bairro.ativo && area?.ativo);
  return { id: bairro.id, nome: bairro.nome, taxaCentavos: entrega ? area.taxaCentavos : null, ativo: entrega };
}

/** Select do bairro de um endereço com as áreas, para `bairroParaLoja`. */
export const SELECT_BAIRRO_ENDERECO = {
  select: { id: true, nome: true, ativo: true, areas: { select: { lojaId: true, taxaCentavos: true, ativo: true } } },
};

const naoEntrega = (lojaNome, bairroNome) =>
  new ErroHttp(422, `${lojaNome ?? 'A loja'} não entrega no bairro ${bairroNome}. Escolha outro endereço.`, {
    codigo: 'BAIRRO_FORA_DA_AREA',
    detalhes: { bairro: bairroNome },
  });

/**
 * Taxa da loja para o bairro, dentro da transação do pedido. Fora da área (ou
 * área/bairro desativado) = 422 BAIRRO_FORA_DA_AREA. Bairro inexistente = 422 BAIRRO_INVALIDO.
 * @returns {Promise<{ id: number, nome: string, taxaCentavos: number }>}
 */
export async function taxaDaLoja(lojaId, bairroId, { lojaNome } = {}, db) {
  const area = await bairroRepo.buscarArea(lojaId, bairroId, db);
  if (area?.ativo && area.bairro.ativo) return { id: bairroId, nome: area.bairro.nome, taxaCentavos: area.taxaCentavos };
  const bairro = area?.bairro ?? (await bairroRepo.buscarCidade(bairroId, db));
  if (!bairro) throw new ErroHttp(422, 'Bairro não encontrado', { codigo: 'BAIRRO_INVALIDO' });
  throw naoEntrega(lojaNome, bairro.nome);
}

// ───────── Público (site/app/PDV): onde a loja entrega ─────────

export async function listarOndeEntrega(lojaId) {
  return (await bairroRepo.listarAreaAtiva(lojaId)).map((a) => ({ id: a.bairroId, nome: a.bairro.nome, taxaCentavos: a.taxaCentavos }));
}

// ───────── Retaguarda (DONO): área de entrega da loja ─────────

/** Formato de sempre da retaguarda (`id` = id do bairro) + se o bairro está ativo na cidade. */
const areaPublica = (a) => ({
  id: a.bairroId,
  nome: a.bairro.nome,
  taxaCentavos: a.taxaCentavos,
  ativo: a.ativo,
  ativoNaCidade: a.bairro.ativo,
});

export async function listar(lojaId) {
  return (await bairroRepo.listarArea(lojaId)).map(areaPublica);
}

/** Bairros da cidade (ativos) que a loja ainda não tem na área: as opções do "Adicionar bairro". */
export async function disponiveisParaLoja(lojaId) {
  const naArea = new Set((await bairroRepo.listarArea(lojaId)).map((a) => a.bairroId));
  return (await bairroRepo.listarCidade()).filter((b) => b.ativo && !naArea.has(b.id)).map((b) => ({ id: b.id, nome: b.nome }));
}

async function gravarArea(lojaId, fn) {
  try {
    const area = await fn();
    avisarCardapioAtualizado(lojaId, 'bairros');
    return areaPublica(area);
  } catch (err) {
    if (ehDuplicado(err)) throw new ErroHttp(409, 'Este bairro já está na área de entrega', { codigo: 'BAIRRO_JA_NA_AREA' });
    if (ehInexistente(err)) throw new ErroHttp(404, 'Bairro não está na área de entrega', { codigo: 'NAO_ENCONTRADO' });
    throw err;
  }
}

/** @param {{ bairroId: number, taxaCentavos: number, ativo?: boolean }} dados */
export async function criar(lojaId, dados) {
  const bairro = await bairroRepo.buscarCidade(dados.bairroId);
  if (!bairro?.ativo) {
    throw new ErroHttp(422, 'Escolha um bairro da lista da cidade', {
      codigo: 'BAIRRO_INVALIDO',
      detalhes: [{ campo: 'bairroId', mensagem: 'Escolha um bairro da lista da cidade' }],
    });
  }
  return gravarArea(lojaId, () => bairroRepo.criarArea(lojaId, dados));
}

/** Só taxa e ativo: o nome é da lista da cidade (ADMIN). @param {{ taxaCentavos?: number, ativo?: boolean }} dados */
export function atualizar(lojaId, bairroId, dados) {
  return gravarArea(lojaId, () => bairroRepo.atualizarArea(lojaId, bairroId, dados));
}

// ───────── Plataforma (ADMIN): bairros da cidade ─────────

const cidadePublica = ({ _count, ...b }) => ({ ...b, lojas: _count.areas, enderecos: _count.enderecos });

export async function listarCidade() {
  return (await bairroRepo.listarCidade()).map(cidadePublica);
}

async function gravarCidade(fn) {
  try {
    const bairro = await fn();
    // Nome/ativo mudam o que o PDV de cada loja que entrega lá mostra.
    for (const lojaId of await bairroRepo.lojasDoBairro(bairro.id)) avisarCardapioAtualizado(lojaId, 'bairros');
    return cidadePublica(bairro);
  } catch (err) {
    if (ehDuplicado(err)) throw new ErroHttp(409, 'Já existe um bairro com este nome', { codigo: 'NOME_EM_USO' });
    if (ehInexistente(err)) throw new ErroHttp(404, 'Bairro não encontrado', { codigo: 'NAO_ENCONTRADO' });
    throw err;
  }
}

/** @param {{ nome: string, ativo?: boolean }} dados */
export function criarCidade(dados) {
  return gravarCidade(() => bairroRepo.criarCidade(dados));
}

/** @param {{ nome?: string, ativo?: boolean }} dados */
export function atualizarCidade(id, dados) {
  return gravarCidade(() => bairroRepo.atualizarCidade(id, dados));
}
