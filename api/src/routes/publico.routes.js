import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { criarPublicoController } from '../controllers/publico.controller.js';
import { lojaDoSite } from '../middlewares/loja.js';

/** Cache curto: o site reflete estoque/turno com no máximo ~15s de atraso. */
function cacheCurto(req, res, next) {
  res.set('Cache-Control', 'public, max-age=15');
  next();
}

/** Rotas do site, sem autenticação, na loja padrão (`req.lojaId`). @param {{ relogio?: () => Date }} [opcoes] */
export function criarPublicoRoutes({ relogio } = {}) {
  const c = criarPublicoController(relogio);
  const r = Router();
  r.use(cacheCurto, lojaDoSite);
  r.get('/cardapio', assincrono(c.cardapio));
  r.get('/bairros', assincrono(c.bairros));
  r.get('/config', assincrono(c.config));
  return r;
}
