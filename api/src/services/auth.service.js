import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { compararSenha, obterHashFicticio } from '../lib/senha.js';
import { gerarAccessToken, gerarRefreshToken, hashRefreshToken } from '../lib/tokens.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';
import * as refreshRepo from '../repositories/refreshToken.repository.js';
import { identidadeDaLoja } from './identidade.service.js';

export function normalizarEmail(email) {
  return email.trim().toLowerCase();
}

export function usuarioPublico(u) {
  return { id: u.id, nome: u.nome, email: u.email, papel: u.papel };
}

/**
 * O usuário + a identidade da loja dele (nome, logo, cor) para o PDV e a
 * retaguarda montarem o tema. ADMIN não tem loja: `loja: null` (escolhe depois).
 */
export async function usuarioComLoja(u) {
  return { ...usuarioPublico(u), loja: u.lojaId ? await identidadeDaLoja(u.lojaId) : null };
}

const credenciaisInvalidas = () =>
  new ErroHttp(401, 'Email ou senha inválidos', { codigo: 'CREDENCIAIS_INVALIDAS' });
const refreshInvalido = () =>
  new ErroHttp(401, 'Sessão inválida. Faça login novamente.', { codigo: 'REFRESH_INVALIDO' });

async function emitirSessao(usuario, db = prisma) {
  const refresh = gerarRefreshToken();
  await refreshRepo.criar({ usuarioId: usuario.id, hash: refresh.hash, expiraEm: refresh.expiraEm }, db);
  return { accessToken: gerarAccessToken(usuario), refreshToken: refresh.token };
}

export async function login({ email, senha }) {
  const usuario = await usuarioRepo.buscarPorEmail(normalizarEmail(email));
  // Compara mesmo sem usuário, para o tempo de resposta não revelar emails.
  const senhaOk = await compararSenha(senha, usuario?.senhaHash ?? (await obterHashFicticio()));

  if (!usuario || !senhaOk) throw credenciaisInvalidas();
  if (!usuario.ativo) {
    throw new ErroHttp(403, 'Usuário desativado. Fale com o dono.', { codigo: 'USUARIO_INATIVO' });
  }

  const tokens = await emitirSessao(usuario);
  return { ...tokens, usuario: await usuarioComLoja(usuario) };
}

export async function renovar({ refreshToken }) {
  const registro = await refreshRepo.buscarPorHash(hashRefreshToken(refreshToken));
  if (!registro) throw refreshInvalido();

  // Token já rotacionado/revogado apresentado de novo: possível roubo.
  if (registro.revogadoEm) {
    await refreshRepo.revogarTodosDoUsuario(registro.usuarioId);
    throw new ErroHttp(401, 'Sessão encerrada por segurança. Faça login novamente.', {
      codigo: 'REFRESH_REUTILIZADO',
    });
  }
  if (registro.expiraEm <= new Date()) throw refreshInvalido();
  if (!registro.usuario.ativo) {
    await refreshRepo.revogarTodosDoUsuario(registro.usuarioId);
    throw refreshInvalido();
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const revogados = await refreshRepo.revogarSeAtivo(registro.id, tx);
    if (revogados === 0) return null; // outra requisição rotacionou primeiro
    return emitirSessao(registro.usuario, tx);
  });

  if (!resultado) {
    await refreshRepo.revogarTodosDoUsuario(registro.usuarioId);
    throw new ErroHttp(401, 'Sessão encerrada por segurança. Faça login novamente.', {
      codigo: 'REFRESH_REUTILIZADO',
    });
  }
  return resultado;
}

/** Idempotente: token desconhecido ou já revogado também resulta em sucesso. */
export async function logout({ refreshToken }) {
  await refreshRepo.revogarPorHash(hashRefreshToken(refreshToken));
}
