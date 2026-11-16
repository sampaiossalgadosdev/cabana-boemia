import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { autenticar } from '../middlewares/autenticar.js';
import { exigirPapel } from '../middlewares/exigirPapel.js';
import { criarRetaguardaController } from '../controllers/retaguarda.controller.js';

/**
 * Rotas da retaguarda (só DONO). Dados de caixa: nunca em cache.
 * @param {{ relogio?: () => Date }} [opcoes]
 */
export function criarRetaguardaRoutes({ relogio } = {}) {
  const c = criarRetaguardaController(relogio);
  const r = Router();
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.use(autenticar, exigirPapel('DONO'));
  r.get('/caixas', assincrono(c.caixas));
  return r;
}
