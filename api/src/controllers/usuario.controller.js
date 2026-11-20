import { z } from 'zod';
import { validar } from '../lib/validar.js';
import * as usuarioService from '../services/usuario.service.js';

// bcrypt só considera os primeiros 72 bytes da senha.
const senha = z
  .string()
  .min(8, 'A senha precisa ter pelo menos 8 caracteres')
  .max(72, 'A senha pode ter no máximo 72 caracteres');

const criarSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(100),
  email: z.email('Email inválido'),
  senha,
});

const senhaSchema = z.object({ senha });

const idSchema = z.object({ id: z.coerce.number().int().positive() });

export async function criar(req, res) {
  res.status(201).json({ usuario: await usuarioService.criarAtendente({ ...validar(criarSchema, req.body), lojaId: req.lojaId }) });
}

export async function listar(req, res) {
  res.json({ usuarios: await usuarioService.listar(req.lojaId) });
}

export async function desativar(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json({ usuario: await usuarioService.desativar(req.lojaId, id) });
}

export async function reativar(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json({ usuario: await usuarioService.reativar(req.lojaId, id) });
}

export async function trocarSenha(req, res) {
  const { id } = validar(idSchema, req.params);
  const { senha: nova } = validar(senhaSchema, req.body);
  await usuarioService.trocarSenha(req.lojaId, id, nova);
  res.status(204).end();
}
