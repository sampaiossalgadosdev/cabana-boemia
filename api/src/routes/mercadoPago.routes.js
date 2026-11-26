import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { criarLimitadorRetorno, criarPagamentoOnlineController } from '../controllers/pagamentoOnline.controller.js';

/**
 * Rotas públicas do Mercado Pago (sem login). Etapa 3: só o retorno do OAuth da loja,
 * `GET /api/mercadopago/oauth/retorno` (= MP_REDIRECT_URI, cadastrada no aplicativo do
 * Mercado Pago). O code nunca vai para o log (`urlParaLog` no app.js tira a query).
 * @param {{ conexaoMp?: object }} [opcoes]
 */
export function criarMercadoPagoRoutes({ conexaoMp } = {}) {
  const c = criarPagamentoOnlineController(conexaoMp);
  const r = Router();
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  r.get('/oauth/retorno', criarLimitadorRetorno(), assincrono(c.retorno));
  return r;
}
