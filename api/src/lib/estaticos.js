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
// Script inline do <head> do site (site/index.html) que decide, antes do primeiro
// paint, se a splash de abertura aparece. Liberado só por hash (nada de
// 'unsafe-inline'); test/estaticos.test.js recalcula o hash a partir do index.html.
export const HASH_SCRIPT_SPLASH = "'sha256-ldXn7X1EBTH8LVu/HR/BG/IWewXYvQMUzeaa1vXCfuY='";

export const CSP_SITE = {
  ...BASE_CSP,
  scriptSrc: ["'self'", HASH_SCRIPT_SPLASH, `${GOOGLE_GSI}client`],
  styleSrc: ["'self'", "'unsafe-inline'", `${GOOGLE_GSI}style`],
  connectSrc: ["'self'", GOOGLE_GSI],
  frameSrc: [GOOGLE_GSI],
  // Fotos dos produtos: o dono cola o link na retaguarda e pode ser de qualquer
  // host (hoje Unsplash, depois as fotos reais). Só imagem e só https.
  imgSrc: ["'self'", 'data:', 'https:'],
  // PWA: manifest e service worker só do próprio site (já valia pelo
  // default-src/script-src; explícito para ninguém afrouxar sem querer).
  manifestSrc: ["'self'"],
  workerSrc: ["'self'"],
};

// Google Maps JavaScript (pino da loja, só na retaguarda): as origens que o
// Google documenta para a API (script, blocos do mapa, fontes e o worker em blob:).
// https://developers.google.com/maps/documentation/javascript/content-security-policy
const MAPS_SCRIPT = ['https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.ggpht.com', 'https://*.googleusercontent.com'];
const MAPS_IMG = ['https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.googleusercontent.com'];

/**
 * CSP da retaguarda: a base + só o Google Maps JavaScript (mapa do pino da loja).
 * `'unsafe-inline'` só em estilo (o mapa posiciona os blocos com estilo inline).
 */
export const CSP_RETAGUARDA = {
  ...BASE_CSP,
  scriptSrc: ["'self'", ...MAPS_SCRIPT],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  imgSrc: ["'self'", 'data:', ...MAPS_IMG],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  connectSrc: ["'self'", 'https://*.googleapis.com', 'https://*.google.com', 'https://*.gstatic.com', 'data:', 'blob:'],
  frameSrc: ['https://*.google.com'],
  workerSrc: ["'self'", 'blob:'],
};

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
      // Service worker do PWA (site/pwa/): sempre revalidado (no-cache, acima),
      // então um deploy novo chega na próxima visita; vale para o site inteiro.
      if (arquivo === path.join(dist, 'sw.js')) res.set('Service-Worker-Allowed', '/');
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
