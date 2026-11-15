import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { autenticar } from '../middlewares/autenticar.js';
import { criarLimitadorLogin } from '../middlewares/limitarLogin.js';
import * as auth from '../controllers/auth.controller.js';

/** @param {{ limiteLogin?: number }} [opcoes] */
export function criarAuthRoutes({ limiteLogin } = {}) {
  const r = Router();
  r.post('/login', criarLimitadorLogin({ limite: limiteLogin }), assincrono(auth.login));
  r.post('/refresh', assincrono(auth.refresh));
  r.post('/logout', assincrono(auth.logout));
  r.get('/me', autenticar, auth.me);
  return r;
}
