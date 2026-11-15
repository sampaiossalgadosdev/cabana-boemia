import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { gerarHashSenha } from '../lib/senha.js';
import { normalizarEmail } from './auth.service.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';
import * as refreshRepo from '../repositories/refreshToken.repository.js';

async function criarUsuario({ nome, email, senha }, papel) {
  const emailNorm = normalizarEmail(email);
  if (await usuarioRepo.buscarPorEmail(emailNorm)) {
    throw new ErroHttp(409, 'Já existe um usuário com este email', { codigo: 'EMAIL_EM_USO' });
  }
  return usuarioRepo.criar({
    nome: nome.trim(),
    email: emailNorm,
    senhaHash: await gerarHashSenha(senha),
    papel,
  });
}

/** Usado só pelo script `npm run criar-dono`. */
export function criarDono(dados) {
  return criarUsuario(dados, 'DONO');
}

export function criarAtendente(dados) {
  return criarUsuario(dados, 'ATENDENTE');
}

export function listar() {
  return usuarioRepo.listar();
}

/** Garante que o alvo existe e é ATENDENTE (o dono não gerencia outros donos por aqui). */
async function buscarAtendente(id) {
  const usuario = await usuarioRepo.buscarPorId(id);
  if (!usuario) {
    throw new ErroHttp(404, 'Usuário não encontrado', { codigo: 'NAO_ENCONTRADO' });
  }
  if (usuario.papel !== 'ATENDENTE') {
    throw new ErroHttp(403, 'Só é possível gerenciar usuários atendentes', {
      codigo: 'SOMENTE_ATENDENTE',
    });
  }
  return usuario;
}

export async function desativar(id) {
  await buscarAtendente(id);
  return prisma.$transaction(async (tx) => {
    await refreshRepo.revogarTodosDoUsuario(id, tx);
    return usuarioRepo.atualizar(id, { ativo: false }, tx);
  });
}

export async function reativar(id) {
  await buscarAtendente(id);
  return usuarioRepo.atualizar(id, { ativo: true });
}

export async function trocarSenha(id, senha) {
  await buscarAtendente(id);
  const senhaHash = await gerarHashSenha(senha);
  return prisma.$transaction(async (tx) => {
    await refreshRepo.revogarTodosDoUsuario(id, tx);
    return usuarioRepo.atualizar(id, { senhaHash }, tx);
  });
}
