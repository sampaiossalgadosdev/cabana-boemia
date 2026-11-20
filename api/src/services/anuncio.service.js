/**
 * Anúncios do app (carrossel "Patrocinado" no Início), cadastrados pelo ADMIN.
 *
 * - Registro da veiculação: anunciante (nome e CPF/CNPJ), imagem, destino,
 *   período, valor pago e quem cadastrou. Não há exclusão pela API, e o banco
 *   recusa apagar um anúncio antes de 1 ano depois do `fim` (trigger da
 *   migration `anuncios_consentimentos`). Desativar tira do ar e mantém o registro.
 * - Destino: uma loja do app (abre a página dela) ou um link https.
 * - O ADMIN declara que a peça não é dirigida a crianças (obrigatório; CHECK).
 * - O app recebe só o que está no ar agora (ativo, dentro do período e, no
 *   destino LOJA, com a loja ativa), sem o documento nem o valor pago.
 * - Nada é medido no aparelho (sem impressões, cliques ou perfil): o mesmo
 *   carrossel para todos.
 */
import { ErroHttp } from '../lib/erros.js';
import { prisma } from '../lib/prisma.js';
import * as repo from '../repositories/anuncio.repository.js';
import * as lojaRepo from '../repositories/loja.repository.js';
import { tipoDaImagem } from './identidade.service.js';

export const MAX_IMAGEM_BYTES = 500 * 1024;
export const PREFIXO_IMAGEM_ANUNCIO = '/api/publico/anuncios/imagens/';
/** Quantos anúncios o carrossel mostra no máximo. */
export const LIMITE_NO_AR = 10;
/** Imagem enviada e não usada em nenhum anúncio depois disto é apagada. */
export const IMAGEM_SOLTA_MS = 24 * 60 * 60 * 1000;

export const urlDaImagem = (imagemId) => `${PREFIXO_IMAGEM_ANUNCIO}${imagemId}`;

/** Situação para a retaguarda: NO_AR | AGENDADO | ENCERRADO | DESATIVADO. */
export function situacao(a, agora = new Date()) {
  if (!a.ativo) return 'DESATIVADO';
  if (agora < a.inicio) return 'AGENDADO';
  if (agora >= a.fim) return 'ENCERRADO';
  return 'NO_AR';
}

/** Formato da retaguarda (tudo). */
export function anuncioDaPlataforma(a, agora = new Date()) {
  return {
    id: a.id,
    anuncianteNome: a.anuncianteNome,
    anuncianteDocumento: a.anuncianteDocumento,
    imagemId: a.imagemId,
    imagemUrl: urlDaImagem(a.imagemId),
    destino: a.destino,
    destinoLoja: a.destinoLoja ? { id: a.destinoLoja.id, slug: a.destinoLoja.slug, nome: a.destinoLoja.nome, ativa: a.destinoLoja.ativa } : null,
    destinoUrl: a.destinoUrl,
    inicio: a.inicio,
    fim: a.fim,
    valorPagoCentavos: a.valorPagoCentavos,
    ativo: a.ativo,
    ordem: a.ordem,
    naoDirigidoACriancas: a.naoDirigidoACriancas,
    situacao: situacao(a, agora),
    criadoEm: a.criadoEm,
    atualizadoEm: a.atualizadoEm,
  };
}

/** Formato do app: sem documento nem valor (não são do cliente). */
export function anuncioPublico(a) {
  return {
    id: a.id,
    anunciante: a.anuncianteNome,
    imagemUrl: urlDaImagem(a.imagemId),
    destino: a.destino === 'LOJA' ? { tipo: 'LOJA', slug: a.destinoLoja.slug, nome: a.destinoLoja.nome } : { tipo: 'LINK', url: a.destinoUrl },
  };
}

export async function listarParaPlataforma(agora = new Date()) {
  return (await repo.listar()).map((a) => anuncioDaPlataforma(a, agora));
}

/** No ar agora; destino LOJA só com a loja ativa (loja desativada tira o anúncio do carrossel). */
export async function noAr(agora = new Date()) {
  const lista = await repo.noAr(agora, LIMITE_NO_AR * 3);
  return lista
    .filter((a) => a.destino === 'LINK' || a.destinoLoja?.ativa)
    .slice(0, LIMITE_NO_AR)
    .map(anuncioPublico);
}

/** Recebe o arquivo (corpo cru), confere tipo (pelos bytes) e tamanho e guarda. */
export async function enviarImagem(arquivo, agora = new Date()) {
  if (!Buffer.isBuffer(arquivo) || arquivo.length === 0) {
    throw new ErroHttp(400, 'Envie a imagem do anúncio', { codigo: 'VALIDACAO' });
  }
  if (arquivo.length > MAX_IMAGEM_BYTES) {
    throw new ErroHttp(413, 'A imagem pode ter no máximo 500 KB', { codigo: 'IMAGEM_GRANDE' });
  }
  const mime = tipoDaImagem(arquivo);
  if (!mime) throw new ErroHttp(415, 'Use uma imagem PNG, JPEG ou WebP', { codigo: 'IMAGEM_INVALIDA' });
  // Faxina: imagens de formulários abandonados.
  await repo.apagarSoltas({ antesDe: new Date(agora.getTime() - IMAGEM_SOLTA_MS) });
  const { id } = await repo.criarImagem({ mime, dados: arquivo });
  return { imagemId: id, imagemUrl: urlDaImagem(id) };
}

export async function imagem(id) {
  const img = await repo.buscarImagem(id);
  if (!img) throw new ErroHttp(404, 'Imagem não encontrada', { codigo: 'NAO_ENCONTRADO' });
  return img;
}

const invalido = (campo, mensagem, codigo = 'VALIDACAO', status = 400) =>
  new ErroHttp(status, mensagem, { codigo, detalhes: [{ campo, mensagem }] });

/** Confere imagem, loja de destino e período (o que o zod não vê). */
async function conferir({ imagemId, destinoLojaId, inicio, fim }, db = prisma) {
  if (imagemId != null && !(await repo.imagemExiste(imagemId, db))) {
    throw invalido('imagemId', 'Envie a imagem de novo', 'IMAGEM_INVALIDA', 422);
  }
  if (destinoLojaId != null && !(await lojaRepo.buscarPorId(destinoLojaId, db))) {
    throw invalido('destinoLojaId', 'Loja não encontrada', 'LOJA_NAO_ENCONTRADA', 422);
  }
  if (inicio && fim && fim <= inicio) throw invalido('fim', 'O fim precisa ser depois do início');
}

/** Destino → colunas (o outro campo vai para null; o CHECK do banco exige um só). */
function colunasDoDestino({ destino, destinoLojaId, destinoUrl }) {
  if (destino === undefined) return {};
  if (destino === 'LOJA') {
    if (destinoLojaId == null) throw invalido('destinoLojaId', 'Escolha a loja');
    return { destino, destinoLojaId, destinoUrl: null };
  }
  if (!destinoUrl) throw invalido('destinoUrl', 'Informe o link');
  return { destino, destinoUrl, destinoLojaId: null };
}

export async function criar(dados, usuarioId, agora = new Date()) {
  const { destino, destinoLojaId, destinoUrl, ...resto } = dados;
  const colunas = colunasDoDestino({ destino, destinoLojaId, destinoUrl });
  await conferir({ ...dados, destinoLojaId: colunas.destinoLojaId });
  const a = await repo.criar({ ...resto, ...colunas, criadoPorId: usuarioId });
  return anuncioDaPlataforma(a, agora);
}

/** Alteração parcial. Trocou a imagem: a antiga é apagada (nenhum outro anúncio a usa). */
export async function alterar(id, dados, agora = new Date()) {
  const a = await prisma.$transaction(async (tx) => {
    const atual = await repo.buscar(id, tx);
    if (!atual) throw new ErroHttp(404, 'Anúncio não encontrado', { codigo: 'NAO_ENCONTRADO' });
    const { destino, destinoLojaId, destinoUrl, ...resto } = dados;
    const colunas = colunasDoDestino({ destino, destinoLojaId, destinoUrl });
    await conferir({
      imagemId: resto.imagemId,
      destinoLojaId: colunas.destinoLojaId,
      inicio: resto.inicio ?? atual.inicio,
      fim: resto.fim ?? atual.fim,
    }, tx);
    const salvo = await repo.atualizar(id, { ...resto, ...colunas }, tx);
    if (resto.imagemId != null && resto.imagemId !== atual.imagemId) await repo.apagarSoltas({ id: atual.imagemId }, tx);
    return salvo;
  });
  return anuncioDaPlataforma(a, agora);
}
