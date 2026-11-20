import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { gerarHashSenha } from '../lib/senha.js';
import { emitirInterno } from '../lib/eventos.js';
import { normalizarEmail } from './auth.service.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';
import * as refreshRepo from '../repositories/refreshToken.repository.js';
import { lojaPadraoId } from './loja.service.js';

/** ADMIN não tem loja; DONO e ATENDENTE têm (CHECK no banco). */
async function criarUsuario({ nome, email, senha }, papel, lojaId) {
  const emailNorm = normalizarEmail(email);
  if (await usuarioRepo.buscarPorEmail(emailNorm)) {
    throw new ErroHttp(409, 'Já existe um usuário com este email', { codigo: 'EMAIL_EM_USO' });
  }
  return usuarioRepo.criar({
    nome: nome.trim(),
    email: emailNorm,
    senhaHash: await gerarHashSenha(senha),
    papel,
    lojaId: papel === 'ADMIN' ? null : lojaId,
  });
}

/**
 * Usado pelo script `npm run criar-dono` (e pelos testes). Sem `lojaId`: a loja
 * padrão (Cabana Boemia).
 */
export async function criarDono({ lojaId, ...dados }) {
  return criarUsuario(dados, 'DONO', lojaId ?? (await lojaPadraoId()));
}

/** Atendente da loja (a rota passa a loja do dono; sem `lojaId`, a padrão). */
export async function criarAtendente({ lojaId, ...dados }) {
  return criarUsuario(dados, 'ATENDENTE', lojaId ?? (await lojaPadraoId()));
}

export function listar(lojaId) {
  return usuarioRepo.listar(lojaId);
}

/**
 * Garante que o alvo existe, é da loja e é ATENDENTE (o dono não gerencia
 * outros donos por aqui). De outra loja = 404, como inexistente.
 */
async function buscarAtendente(lojaId, id) {
  const usuario = await usuarioRepo.buscarPorId(id);
  if (!usuario || usuario.lojaId !== lojaId) {
    throw new ErroHttp(404, 'Usuário não encontrado', { codigo: 'NAO_ENCONTRADO' });
  }
  if (usuario.papel !== 'ATENDENTE') {
    throw new ErroHttp(403, 'Só é possível gerenciar usuários atendentes', {
      codigo: 'SOMENTE_ATENDENTE',
    });
  }
  return usuario;
}

export async function desativar(lojaId, id) {
  await buscarAtendente(lojaId, id);
  const usuario = await prisma.$transaction(async (tx) => {
    await refreshRepo.revogarTodosDoUsuario(id, tx);
    return usuarioRepo.atualizar(id, { ativo: false }, tx);
  });
  // Depois do commit: derruba os sockets dele (PDV aberto deixa de receber pedidos).
  emitirInterno('usuario:desativado', { usuarioId: id });
  return usuario;
}

export async function reativar(lojaId, id) {
  await buscarAtendente(lojaId, id);
  return usuarioRepo.atualizar(id, { ativo: true });
}

export async function trocarSenha(lojaId, id, senha) {
  await buscarAtendente(lojaId, id);
  const senhaHash = await gerarHashSenha(senha);
  return prisma.$transaction(async (tx) => {
    await refreshRepo.revogarTodosDoUsuario(id, tx);
    return usuarioRepo.atualizar(id, { senhaHash }, tx);
  });
}

// ───────── Papel ADMIN (plataforma), só por script ─────────

const usuarioNaoEncontrado = () => new ErroHttp(404, 'Usuário não encontrado', { codigo: 'NAO_ENCONTRADO' });

/**
 * Promove o usuário a ADMIN (acima do DONO, sem loja). Usado só pelo script
 * `npm run promover-admin`. Já ADMIN: devolve como está.
 */
export async function promoverAAdmin(email) {
  const usuario = await usuarioRepo.buscarPorEmail(normalizarEmail(email));
  if (!usuario) throw usuarioNaoEncontrado();
  if (usuario.papel === 'ADMIN') return usuarioRepo.atualizar(usuario.id, {});
  return usuarioRepo.atualizar(usuario.id, { papel: 'ADMIN', lojaId: null });
}

/** Desfaz a promoção: o ADMIN volta a DONO da loja dada (`--desfazer` do script). */
export async function voltarADono(email, lojaId) {
  const usuario = await usuarioRepo.buscarPorEmail(normalizarEmail(email));
  if (!usuario) throw usuarioNaoEncontrado();
  return usuarioRepo.atualizar(usuario.id, { papel: 'DONO', lojaId });
}
