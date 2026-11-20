/**
 * Identidade visual de cada loja: logo e cor primária (retaguarda, PDV, app).
 *
 * - O ADMIN define o PADRÃO da loja (`corPrimariaPadrao`, `logoUrlPadrao`) ao
 *   criar ou editar; a loja começa nele.
 * - O DONO troca a cor e a logo em "Perfil da loja" (`corPrimaria`, `logoUrl`)
 *   e volta ao padrão quando quiser.
 * - A cor precisa ser legível (`avaliarCor` do shared: texto claro ou escuro
 *   por cima com 4,5:1 e 3:1 sobre a base clara); senão 422 COR_ILEGIVEL.
 * - A logo é enviada como arquivo (PNG, JPEG ou WebP, até 500 KB) e fica no
 *   banco (`ImagemLoja`), servida em `/api/publico/imagens/:id` com cache longo
 *   (cada envio é outro id). Imagens que nada usa mais são apagadas.
 */
import { avaliarCor, textoSobre, TEMA_PADRAO } from '@restaurante/shared/cores';
import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { avisarCardapioAtualizado } from '../lib/eventos.js';
import * as imagemRepo from '../repositories/imagem.repository.js';
import * as lojaRepo from '../repositories/loja.repository.js';

export const MAX_LOGO_BYTES = 500 * 1024;
export const PREFIXO_IMAGEM = '/api/publico/imagens/';
/** Caminho de uma imagem guardada no banco ("/api/publico/imagens/12"). */
export const ehImagemPropria = (url) => typeof url === 'string' && /^\/api\/publico\/imagens\/\d+$/.test(url);
const idDaImagem = (url) => (ehImagemPropria(url) ? Number(url.slice(PREFIXO_IMAGEM.length)) : null);

/** Tipo da imagem pelos primeiros bytes (não confia no Content-Type). SVG fica de fora (pode ter script). */
export function tipoDaImagem(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Cor primária válida e legível, senão null (o cliente usa o tema padrão). */
const corValida = (c) => (c && avaliarCor(c).ok ? avaliarCor(c).cor : null);

/** O que a equipe (PDV, retaguarda) e o app usam para montar o tema da loja. */
export function identidade(l) {
  const cor = corValida(l.corPrimaria);
  return {
    id: l.id,
    slug: l.slug,
    nome: l.nome,
    logoUrl: l.logoUrl ?? null,
    corPrimaria: cor,
    corTexto: textoSobre(cor ?? TEMA_PADRAO.corPrimaria),
  };
}

function perfil(l) {
  return {
    ...identidade(l),
    corPrimariaPadrao: l.corPrimariaPadrao ?? null,
    logoUrlPadrao: l.logoUrlPadrao ?? null,
    noPadrao: (l.corPrimaria ?? null) === (l.corPrimariaPadrao ?? null) && (l.logoUrl ?? null) === (l.logoUrlPadrao ?? null),
  };
}

async function buscarLoja(lojaId, db) {
  const l = await lojaRepo.buscarPorId(lojaId, db);
  if (!l) throw new ErroHttp(404, 'Loja não encontrada', { codigo: 'LOJA_NAO_ENCONTRADA' });
  return l;
}

export async function identidadeDaLoja(lojaId) {
  return identidade(await buscarLoja(lojaId));
}

export async function obterPerfil(lojaId) {
  return perfil(await buscarLoja(lojaId));
}

/** Confere a cor (normalizada); ilegível = 422 COR_ILEGIVEL com o motivo. */
export function exigirCorLegivel(valor, campo = 'corPrimaria') {
  const a = avaliarCor(valor);
  if (!a.ok) {
    throw new ErroHttp(422, a.motivo, {
      codigo: 'COR_ILEGIVEL',
      detalhes: [{ campo, mensagem: a.motivo, contrasteTexto: a.contrasteTexto, contrasteBase: a.contrasteBase }],
    });
  }
  return a.cor;
}

/** Apaga as imagens da loja que não são nem a logo atual nem a padrão. */
export async function limparImagensDaLoja(loja, db) {
  return limparImagens(loja, db);
}

async function limparImagens(loja, db) {
  const manter = [idDaImagem(loja.logoUrl), idDaImagem(loja.logoUrlPadrao)].filter((x) => x != null);
  await imagemRepo.apagarOutras(loja.id, manter, db);
}

function avisar(lojaId) {
  avisarCardapioAtualizado(lojaId, 'loja');
}

/** DONO: troca a cor primária. */
export async function definirCor(lojaId, corPrimaria) {
  const cor = exigirCorLegivel(corPrimaria);
  await buscarLoja(lojaId);
  const loja = await lojaRepo.atualizar(lojaId, { corPrimaria: cor });
  avisar(lojaId);
  return perfil(loja);
}

/** Confere e guarda o arquivo da logo; devolve o caminho público. */
async function guardarLogo(lojaId, arquivo, db) {
  if (!Buffer.isBuffer(arquivo) || arquivo.length === 0) {
    throw new ErroHttp(400, 'Envie a imagem da logo', { codigo: 'VALIDACAO' });
  }
  if (arquivo.length > MAX_LOGO_BYTES) {
    throw new ErroHttp(413, 'A logo pode ter no máximo 500 KB', { codigo: 'IMAGEM_GRANDE' });
  }
  const mime = tipoDaImagem(arquivo);
  if (!mime) throw new ErroHttp(415, 'Use uma imagem PNG, JPEG ou WebP', { codigo: 'IMAGEM_INVALIDA' });
  const { id } = await imagemRepo.criar({ lojaId, mime, dados: arquivo }, db);
  return `${PREFIXO_IMAGEM}${id}`;
}

/** DONO: troca a logo (arquivo). */
export async function definirLogo(lojaId, arquivo) {
  const loja = await prisma.$transaction(async (tx) => {
    await buscarLoja(lojaId, tx);
    const url = await guardarLogo(lojaId, arquivo, tx);
    const atualizada = await lojaRepo.atualizar(lojaId, { logoUrl: url }, tx);
    await limparImagens(atualizada, tx);
    return atualizada;
  });
  avisar(lojaId);
  return perfil(loja);
}

/** DONO: cor e logo voltam às definidas pelo ADMIN. */
export async function voltarAoPadrao(lojaId) {
  const loja = await prisma.$transaction(async (tx) => {
    const atual = await buscarLoja(lojaId, tx);
    const atualizada = await lojaRepo.atualizar(
      lojaId,
      { corPrimaria: atual.corPrimariaPadrao ?? null, logoUrl: atual.logoUrlPadrao ?? null },
      tx,
    );
    await limparImagens(atualizada, tx);
    return atualizada;
  });
  avisar(lojaId);
  return perfil(loja);
}

/**
 * ADMIN: troca a logo PADRÃO. Se a loja ainda usa a padrão antiga (o dono não
 * personalizou), a logo atual acompanha.
 */
export async function definirLogoPadrao(lojaId, arquivo) {
  const loja = await prisma.$transaction(async (tx) => {
    const atual = await buscarLoja(lojaId, tx);
    const url = await guardarLogo(lojaId, arquivo, tx);
    const dados = { logoUrlPadrao: url };
    if ((atual.logoUrl ?? null) === (atual.logoUrlPadrao ?? null)) dados.logoUrl = url;
    const atualizada = await lojaRepo.atualizar(lojaId, dados, tx);
    await limparImagens(atualizada, tx);
    return atualizada;
  });
  avisar(lojaId);
  return loja;
}

/** Imagem pública (logo). Inexistente = 404. */
export async function imagem(id) {
  const img = await imagemRepo.buscar(id);
  if (!img) throw new ErroHttp(404, 'Imagem não encontrada', { codigo: 'NAO_ENCONTRADO' });
  return img;
}
