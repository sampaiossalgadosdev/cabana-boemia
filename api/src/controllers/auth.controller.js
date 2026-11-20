import { z } from 'zod';
import { validar } from '../lib/validar.js';
import * as authService from '../services/auth.service.js';
import { identidadeDaLoja } from '../services/identidade.service.js';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Informe o email'),
  senha: z.string().min(1, 'Informe a senha'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Informe o refreshToken'),
});

export async function login(req, res) {
  res.json(await authService.login(validar(loginSchema, req.body)));
}

export async function refresh(req, res) {
  res.json(await authService.renovar(validar(refreshSchema, req.body)));
}

export async function logout(req, res) {
  await authService.logout(validar(refreshSchema, req.body));
  res.status(204).end();
}

export async function me(req, res) {
  res.json({ usuario: { ...req.usuario, loja: req.lojaDoUsuario ? await identidadeDaLoja(req.lojaDoUsuario) : null } });
}
