import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { autenticar } from '../middlewares/autenticar.js';
import { exigirPapel } from '../middlewares/exigirPapel.js';
import { criarEquipeController } from '../controllers/equipe.controller.js';

/**
 * Rotas do PDV (DONO e ATENDENTE). Dados do dia: nunca em cache.
 * @param {{ relogio?: () => Date }} [opcoes]
 */
export function criarEquipeRoutes({ relogio } = {}) {
  const c = criarEquipeController(relogio);
  const r = Router();
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.use(autenticar, exigirPapel('DONO', 'ATENDENTE'));
  r.get('/pedidos', assincrono(c.listarPedidos));
  r.patch('/pedidos/:id/finalizar', assincrono(c.finalizarPedido));
  r.get('/config/tempo-estimado', assincrono(c.obterTempo));
  r.put('/config/tempo-estimado', assincrono(c.definirTempo));
  return r;
}
