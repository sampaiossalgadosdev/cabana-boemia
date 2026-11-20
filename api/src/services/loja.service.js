/**
 * Lojas da plataforma.
 * - Site atual (cabana.managerpix.com.br), rotas antigas (/publico/cardapio etc.)
 *   (cardápio, bairros, config, pedido sem `lojaSlug`): a LOJA PADRÃO (Cabana Boemia, slug `cabana-boemia`).
 * - App e rotas novas: a loja do slug (/publico/lojas/:slug/..., `lojaSlug` no pedido).
 * - Equipe: DONO e ATENDENTE, a loja do cadastro; ADMIN (sem loja) informa a loja
 *   (cabeçalho X-Loja / `auth.loja` no socket); sem informar = 400 LOJA_OBRIGATORIA.
 */
import { prisma } from '../lib/prisma.js';
import { ErroHttp, ehDuplicado, ehInexistente } from '../lib/erros.js';
import * as lojaRepo from '../repositories/loja.repository.js';
import * as turnoRepo from '../repositories/turno.repository.js';
import { calcularTurnoAtivo, calcularProximaAbertura } from './turno.service.js';
import { identidade, limparImagensDaLoja } from './identidade.service.js';

/** Loja que o site atual atende (rotas sem slug). */
export const SLUG_LOJA_PADRAO = 'cabana-boemia';

// O id da loja padrão não muda (a migration cria a Cabana uma vez): guardado
// depois da primeira leitura. Só o id: a configuração é lida a cada uso.
let idPadrao = null;

const semLoja = () =>
  new ErroHttp(503, 'Loja não configurada. Rode as migrations do banco.', { codigo: 'LOJA_NAO_CONFIGURADA' });
const lojaObrigatoria = () =>
  new ErroHttp(400, 'Escolha a loja (cabeçalho X-Loja)', { codigo: 'LOJA_OBRIGATORIA' });
const lojaNaoEncontrada = () => new ErroHttp(404, 'Loja não encontrada', { codigo: 'LOJA_NAO_ENCONTRADA' });

/** Id da loja padrão (Cabana Boemia). Sem a loja no banco = 503. */
export async function lojaPadraoId() {
  if (idPadrao != null) return idPadrao;
  const loja = await lojaRepo.buscarPorSlug(SLUG_LOJA_PADRAO);
  if (!loja) throw semLoja();
  idPadrao = loja.id;
  return idPadrao;
}

/**
 * Loja em que o usuário da equipe trabalha: DONO e ATENDENTE, a do cadastro
 * (se informarem outra = 403 LOJA_PROIBIDA); ADMIN, a informada (slug ou id;
 * inexistente = 404; sem informar = 400 LOJA_OBRIGATORIA: o ADMIN não tem loja).
 * @param {{ lojaId: number | null, papel?: string }} usuario
 * @param {string | number | null} [informada] valor do X-Loja / auth.loja
 */
export async function lojaDoUsuario(usuario, informada = null) {
  const ref = informada == null ? '' : String(informada).trim();
  if (usuario.lojaId != null) {
    if (ref && ref !== String(usuario.lojaId) && (await lojaRepo.buscarPorSlug(ref))?.id !== usuario.lojaId) {
      throw new ErroHttp(403, 'Sem acesso a esta loja', { codigo: 'LOJA_PROIBIDA' });
    }
    return usuario.lojaId;
  }
  if (!ref) throw lojaObrigatoria();
  const loja = /^\d+$/.test(ref) ? await lojaRepo.buscarPorId(Number(ref)) : await lojaRepo.buscarPorSlug(ref);
  if (!loja) throw lojaNaoEncontrada();
  return loja.id;
}

/** Loja com a configuração; inexistente = 404. */
export async function buscar(lojaId, db) {
  const loja = await lojaRepo.buscarPorId(lojaId, db);
  if (!loja) throw new ErroHttp(404, 'Loja não encontrada', { codigo: 'NAO_ENCONTRADO' });
  return loja;
}

/** Loja ATIVA pelo slug (rotas públicas e pedido do cliente); inexistente ou inativa = 404. */
export async function buscarAtivaPorSlug(slug) {
  const loja = await lojaRepo.buscarPorSlug(String(slug ?? '').trim().toLowerCase());
  if (!loja?.ativa) throw lojaNaoEncontrada();
  return loja;
}

// ───────── Vitrine (público) ─────────

/** O que o cliente vê de uma loja (sem configuração interna). */
export const lojaResumo = (l) => ({ nome: l.nome, slug: l.slug, logoUrl: l.logoUrl ?? null });

/**
 * Lojas ativas para a escolha no app: identidade, se está aberta agora e a
 * próxima abertura (mesmo formato do cardápio: `{ turno, em, diaSemana, inicio }`).
 */
export async function listarPublicas(agora = new Date()) {
  const lojas = await lojaRepo.listarAtivas();
  return Promise.all(
    lojas.map(async (l) => {
      const turnos = await turnoRepo.listarAtivosComHorarios(l.id);
      const turno = calcularTurnoAtivo(turnos, agora);
      return {
        slug: l.slug,
        nome: l.nome,
        descricao: l.descricao ?? null,
        logoUrl: l.logoUrl ?? null,
        corPrimaria: identidade(l).corPrimaria,
        corTexto: identidade(l).corTexto,
        corFundo: l.corFundo ?? null,
        aberta: turno !== null,
        proximaAbertura: turno ? null : calcularProximaAbertura(turnos, agora),
      };
    }),
  );
}

// ───────── Plataforma (ADMIN) ─────────

const CAMPOS_EDITAVEIS = [
  'slug',
  'nome',
  'razaoSocial',
  'documento',
  'endereco',
  'whatsapp',
  'logoUrl',
  'corPrimaria',
  'corFundo',
  'corPrimariaPadrao',
  'logoUrlPadrao',
  'descricao',
  'ativa',
  'ordem',
];

/** Loja como o ADMIN vê (cadastro completo, sem a configuração do dia). */
function lojaDaPlataforma(l) {
  const saida = { id: l.id };
  for (const c of CAMPOS_EDITAVEIS) saida[c] = l[c] ?? null;
  saida.whatsapp = l.whatsapp ?? '';
  if (l._count) Object.assign(saida, { usuarios: l._count.usuarios, pedidos: l._count.pedidos });
  saida.criadoEm = l.criadoEm;
  return saida;
}

const slugEmUso = () => new ErroHttp(409, 'Já existe uma loja com este endereço (slug)', { codigo: 'SLUG_EM_USO' });

export async function listarParaPlataforma() {
  return (await lojaRepo.listarTodas()).map(lojaDaPlataforma);
}

/**
 * Cria a loja (sem cardápio; o dono cadastra na retaguarda) e, se vierem, os
 * turnos iniciais (sem horários: o dono define em Turnos e horários).
 * @param {object} dados já validados
 * @param {string[]} [turnos] nomes
 */
export async function criarLoja(dados, turnos = []) {
  // O que o ADMIN escolhe na criação é o padrão da loja (o dono personaliza depois).
  dados = {
    ...dados,
    corPrimariaPadrao: dados.corPrimariaPadrao ?? dados.corPrimaria ?? null,
    logoUrlPadrao: dados.logoUrlPadrao ?? dados.logoUrl ?? null,
  };
  dados.corPrimaria ??= dados.corPrimariaPadrao;
  dados.logoUrl ??= dados.logoUrlPadrao;
  try {
    const loja = await prisma.$transaction(async (tx) => {
      const criada = await lojaRepo.criar(dados, tx);
      for (const nome of [...new Set(turnos)]) await tx.turno.create({ data: { lojaId: criada.id, nome } });
      return criada;
    });
    return lojaDaPlataforma(loja);
  } catch (err) {
    if (ehDuplicado(err)) throw slugEmUso();
    throw err;
  }
}

/** O slug da loja padrão é fixo: é por ele que o site atual acha a Cabana. */
export async function editarLoja(id, dados) {
  if (dados.slug !== undefined && dados.slug !== SLUG_LOJA_PADRAO && id === (await lojaPadraoId())) {
    throw new ErroHttp(422, 'O endereço (slug) da loja padrão não muda: o site atual depende dele', {
      codigo: 'SLUG_FIXO',
      detalhes: [{ campo: 'slug', mensagem: 'Não muda na loja padrão' }],
    });
  }
  // Padrão novo: a loja que ainda usa o padrão antigo (o dono não personalizou) acompanha.
  const atual = await lojaRepo.buscarPorId(id);
  if (!atual) throw lojaNaoEncontrada();
  dados = { ...dados };
  if (dados.corPrimariaPadrao !== undefined && dados.corPrimaria === undefined && (atual.corPrimaria ?? null) === (atual.corPrimariaPadrao ?? null)) {
    dados.corPrimaria = dados.corPrimariaPadrao;
  }
  if (dados.logoUrlPadrao !== undefined && dados.logoUrl === undefined && (atual.logoUrl ?? null) === (atual.logoUrlPadrao ?? null)) {
    dados.logoUrl = dados.logoUrlPadrao;
  }
  try {
    const loja = await lojaRepo.atualizar(id, dados);
    await limparImagensDaLoja(loja);
    return lojaDaPlataforma(loja);
  } catch (err) {
    if (ehDuplicado(err)) throw slugEmUso();
    if (ehInexistente(err)) throw lojaNaoEncontrada();
    throw err;
  }
}
