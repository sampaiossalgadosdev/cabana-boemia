import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { criarLimitadorRetorno, criarPagamentoOnlineController } from '../controllers/pagamentoOnline.controller.js';
import { pagamentosPadrao } from '../services/pagamento.service.js';
import { documento, responderPagina } from '../lib/paginaPublica.js';

/** Link do app (scheme do app.config.js) que leva de volta à tela do cartão (rota `cartao-retorno`). */
export const LINK_VOLTA_APP = 'deliveryabatia://cartao-retorno';

/**
 * Página de volta do Checkout Pro (`back_urls`). NÃO aprova nada: a query (payment_id, status…)
 * é ignorada e nem vai para o log; o app consulta a nossa API, que consulta o Mercado Pago.
 * Manda o navegador de volta ao app (o navegador do app fecha ao ver o link) e, se não fechar,
 * mostra o botão.
 */
function paginaRetornoCartao() {
  return documento({
    titulo: 'Pagamento',
    corpo: `<section><h2>Pronto, pode voltar ao app</h2>
<p>O Taaki Delivery confere o pagamento com o Mercado Pago e mostra o resultado no app.</p>
<p><a href="${LINK_VOLTA_APP}">Voltar ao app</a></p>
<p class="nota">Se o app não abrir sozinho, feche esta janela.</p></section>`,
  }).replace('<head>', `<head><meta http-equiv="refresh" content="0;url=${LINK_VOLTA_APP}">`);
}

/**
 * Rotas públicas do Mercado Pago (sem login):
 * - `GET /api/mercadopago/oauth/retorno` (= MP_REDIRECT_URI): retorno do OAuth da loja. O code
 *   nunca vai para o log (`urlParaLog` no app.js tira a query de tudo em /mercadopago/).
 * - `POST /api/mercadopago/webhook` (notification_url dos Pix e Webhooks do painel: tópicos
 *   "Pagamentos" e "Vinculação de aplicações"): assinatura `x-signature` com MP_WEBHOOK_SECRET
 *   (inválida = 401), 200 na hora e o processamento depois (consulta o pagamento com o token da loja).
 * - `GET /api/mercadopago/cartao/retorno` (back_urls do Checkout Pro do cartão): só volta ao app.
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
  r.get('/cartao/retorno', (req, res) => responderPagina(res, 200, paginaRetornoCartao()));
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
