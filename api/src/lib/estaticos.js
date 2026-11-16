/**
 * Builds servidos pela API (deploy num serviço só no Railway):
 *   /       → site do cliente (`api/public/site`)
 *   /admin  → retaguarda (`api/public/admin`)
 *   /api    → rotas da API (montadas no app.js, nunca caem aqui)
 * Os builds são copiados para `api/public` pelo `npm run build` da raiz.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
export const DIST_SITE = path.join(PUBLIC, 'site');
export const DIST_RETAGUARDA = path.join(PUBLIC, 'admin');

/** Caminhos que nunca são páginas do site (a API e o Socket.IO respondem por eles). */
const RESERVADOS = /^\/(api|admin|socket\.io)(\/|$)/;

// Google Identity Services (login do cliente no site): o script, o iframe do
// botão/One Tap, as chamadas dele e a folha de estilo, todos sob /gsi/.
// https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#content_security_policy
const GOOGLE_GSI = 'https://accounts.google.com/gsi/';

const BASE_CSP = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  frameSrc: ["'none'"],
  upgradeInsecureRequests: [],
};

/**
 * CSP do site: a base + só o necessário do Google Identity Services.
 * `'unsafe-inline'` só em estilo: o script do GIS aplica estilos inline nos
 * elementos que cria (sem isso o iframe do botão fica 0×0). Scripts continuam
 * restritos a 'self' + o client do Google.
 */
export const CSP_SITE = {
  ...BASE_CSP,
  scriptSrc: ["'self'", `${GOOGLE_GSI}client`],
  styleSrc: ["'self'", "'unsafe-inline'", `${GOOGLE_GSI}style`],
  connectSrc: ["'self'", GOOGLE_GSI],
  frameSrc: [GOOGLE_GSI],
};

/** CSP da retaguarda: não carrega nada de fora. */
export const CSP_RETAGUARDA = BASE_CSP;

/** Arquivo pedido (com extensão ou em assets/) que não existe = 404, não o index.html. */
const pareceArquivo = (rel) => rel.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(rel);

/**
 * Serve uma SPA: arquivos do build (assets com hash em cache longo, o resto
 * `no-cache`) e o index.html para qualquer outra rota GET sob o prefixo.
 * Sem build (index.html ausente), não monta nada.
 * @param {import('express').Express} app
 * @param {{ prefixo: string, dist: string, csp: object }} opcoes
 */
export function servirSpa(app, { prefixo, dist, csp }) {
  const indice = path.join(dist, 'index.html');
  if (!fs.existsSync(indice)) return false;
  const raiz = prefixo === '/';
  const politica = helmet.contentSecurityPolicy({ useDefaults: false, directives: csp });
  const nossa = (req) => (raiz ? !RESERVADOS.test(req.path) : true);

  const estatico = express.static(dist, {
    index: false,
    setHeaders(res, arquivo) {
      res.set('Cache-Control', arquivo.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  app.use(prefixo, (req, res, next) => {
    if (!nossa(req)) return next();
    politica(req, res, (erro) => (erro ? next(erro) : estatico(req, res, next)));
  });

  app.get(raiz ? '*' : [prefixo, `${prefixo}/*`], (req, res, next) => {
    if (!nossa(req)) return next();
    const rel = raiz ? req.path : req.path.slice(prefixo.length) || '/';
    if (pareceArquivo(rel)) return next();
    politica(req, res, (erro) => {
      if (erro) return next(erro);
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indice);
    });
  });
  return true;
}
