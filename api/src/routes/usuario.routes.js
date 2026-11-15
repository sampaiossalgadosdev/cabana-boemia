import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { autenticar } from '../middlewares/autenticar.js';
import { exigirPapel } from '../middlewares/exigirPapel.js';
import * as usuarios from '../controllers/usuario.controller.js';

export function criarUsuarioRoutes() {
  const r = Router();
  r.use(autenticar, exigirPapel('DONO'));
  r.post('/', assincrono(usuarios.criar));
  r.get('/', assincrono(usuarios.listar));
  r.patch('/:id/desativar', assincrono(usuarios.desativar));
  r.patch('/:id/reativar', assincrono(usuarios.reativar));
  r.patch('/:id/senha', assincrono(usuarios.trocarSenha));
  return r;
}
