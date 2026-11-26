import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { criarLimitadorRetorno, criarPagamentoOnlineController } from '../controllers/pagamentoOnline.controller.js';
import { pagamentosPadrao } from '../services/pagamento.service.js';

/**
 * Rotas públicas do Mercado Pago (sem login):
 * - `GET /api/mercadopago/oauth/retorno` (= MP_REDIRECT_URI): retorno do OAuth da loja. O code
 *   nunca vai para o log (`urlParaLog` no app.js tira a query de tudo em /mercadopago/).
 * - `POST /api/mercadopago/webhook` (notification_url dos Pix e Webhooks do painel: tópicos
 *   "Pagamentos" e "Vinculação de aplicações"): assinatura `x-signature` com MP_WEBHOOK_SECRET
 *   (inválida = 401), 200 na hora e o processamento depois (consulta o pagamento com o token da loja).
 * @param {{ conexaoMp?: object, pagamentos?: object, relogio?: () => Date }} [opcoes]
 */
export function criarMercadoPagoRoutes({ conexaoMp, pagamentos = pagamentosPadrao(), relogio = () => new Date() } = {}) {
  const c = criarPagamentoOnlineController(conexaoMp);
  const r = Router();
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  r.get('/oauth/retorno', criarLimitadorRetorno(), assincrono(c.retorno));
  r.post(
    '/webhook',
    assincrono(async (req, res) => {
      const r = await pagamentos.receberWebhook(
        {
          assinatura: req.get('x-signature'),
          requestId: req.get('x-request-id'),
          dataIdQuery: typeof req.query['data.id'] === 'string' ? req.query['data.id'] : null,
          corpo: req.body ?? {},
        },
        relogio(),
      );
      res.status(200).json({ recebido: true, duplicado: r.duplicado });
    }),
  );
  return r;
}
