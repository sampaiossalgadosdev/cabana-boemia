import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { criarPublicoController } from '../controllers/publico.controller.js';
import { lojaDoSite, lojaDoSlug } from '../middlewares/loja.js';

/** Cache curto: o site reflete estoque/turno com no máximo ~15s de atraso. */
function cacheCurto(req, res, next) {
  res.set('Cache-Control', 'public, max-age=15');
  next();
}

/**
 * Rotas públicas, sem autenticação.
 * - /lojas e /lojas/:slug/(cardapio|bairros|config): app e lojas novas.
 * - /cardapio, /bairros, /config (antigas): sempre a loja padrão (Cabana), para o site atual.
 * @param {{ relogio?: () => Date }} [opcoes]
 */
export function criarPublicoRoutes({ relogio } = {}) {
  const c = criarPublicoController(relogio);
  const r = Router();
  r.use(cacheCurto);
  r.get('/lojas', assincrono(c.lojas));
  // Lista da cidade (cadastro de endereço no Perfil do app, sem loja escolhida).
  r.get('/bairros-da-cidade', assincrono(c.bairrosDaCidade));
  r.get('/lojas/:slug/cardapio', lojaDoSlug, assincrono(c.cardapio));
  r.get('/lojas/:slug/bairros', lojaDoSlug, assincrono(c.bairros));
  r.get('/lojas/:slug/config', lojaDoSlug, assincrono(c.config));
  // Logo enviada pela retaguarda: cada envio é outro id, então o cache é longo.
  r.get('/imagens/:id', assincrono(c.imagem));
  r.get('/cardapio', lojaDoSite, assincrono(c.cardapio));
  r.get('/bairros', lojaDoSite, assincrono(c.bairros));
  r.get('/config', lojaDoSite, assincrono(c.config));
  return r;
}
