/**
 * Lojas da plataforma. Nesta etapa só existe a Cabana Boemia (criada pela
 * migration `multi_loja`): o site, o app e o ADMIN (que não tem loja) usam a
 * LOJA PADRÃO; DONO e ATENDENTE usam sempre a loja do próprio cadastro.
 * As rotas por loja (slug na URL, escolha da loja pelo ADMIN) vêm depois.
 */
import { ErroHttp } from '../lib/erros.js';
import * as lojaRepo from '../repositories/loja.repository.js';

/** Loja que o site atual (cabana.managerpix.com.br) e o app atendem por enquanto. */
export const SLUG_LOJA_PADRAO = 'cabana-boemia';

// O id da loja padrão não muda (a migration cria a Cabana uma vez): guardado
// depois da primeira leitura. Só o id: a configuração é lida a cada uso.
let idPadrao = null;

const semLoja = () =>
  new ErroHttp(503, 'Loja não configurada. Rode as migrations do banco.', { codigo: 'LOJA_NAO_CONFIGURADA' });

/** Id da loja padrão (Cabana Boemia). Sem a loja no banco = 503. */
export async function lojaPadraoId() {
  if (idPadrao != null) return idPadrao;
  const loja = await lojaRepo.buscarPorSlug(SLUG_LOJA_PADRAO);
  if (!loja) throw semLoja();
  idPadrao = loja.id;
  return idPadrao;
}

/**
 * Loja em que o usuário da equipe trabalha: DONO e ATENDENTE, a do cadastro;
 * ADMIN (sem loja), a padrão por enquanto.
 * @param {{ lojaId: number | null }} usuario
 */
export async function lojaDoUsuario(usuario) {
  return usuario.lojaId ?? lojaPadraoId();
}

/** Loja com a configuração; inexistente = 404. */
export async function buscar(lojaId, db) {
  const loja = await lojaRepo.buscarPorId(lojaId, db);
  if (!loja) throw new ErroHttp(404, 'Loja não encontrada', { codigo: 'NAO_ENCONTRADO' });
  return loja;
}
