import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { criarRotas } from './routes/index.js';
import { naoEncontrado } from './middlewares/naoEncontrado.js';
import { tratarErro } from './middlewares/erro.js';

/** Lê CORS_ORIGINS ("a,b,c") e devolve a lista sem espaços nem itens vazios. */
export function lerOrigensCors(valor = '') {
  return valor
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Build da retaguarda (`npm run build -w retaguarda`), servido em /admin. */
export const DIST_RETAGUARDA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'retaguarda', 'dist');

/**
 * Retaguarda (SPA) em /admin: arquivos do build e, para qualquer outra rota
 * sob /admin, o index.html (o React decide a tela). Sem build: não monta nada.
 */
function servirRetaguarda(app, dist) {
  const indice = path.join(dist, 'index.html');
  if (!fs.existsSync(indice)) return;
  app.use(
    '/admin',
    express.static(dist, {
      index: false,
      // Arquivos com hash no nome podem ficar em cache; o index.html nunca.
      setHeaders(res, arquivo) {
        res.set('Cache-Control', arquivo.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  app.get(['/admin', '/admin/*'], (req, res, next) => {
    // Asset que não existe é 404 (devolver o index.html no lugar quebraria o navegador em silêncio).
    if (req.path.startsWith('/admin/assets/')) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(indice);
  });
}

/**
 * Monta o app Express sem abrir porta; usado pelo server.js e pelos testes.
 * @param {{ corsOrigins?: string[], log?: boolean, limiteLogin?: number, relogio?: () => Date,
 *           verificarIdTokenGoogle?: (idToken: string) => Promise<object> }} [opcoes]
 *   `relogio`: fonte do "agora" das rotas públicas (injetável nos testes).
 *   `verificarIdTokenGoogle`: troca o verificador do Google (testes usam chave própria).
 *   `distRetaguarda`: pasta do build da retaguarda servida em /admin (testes usam uma própria).
 */
export function criarApp({
  corsOrigins = lerOrigensCors(process.env.CORS_ORIGINS),
  log = true,
  limiteLogin,
  relogio,
  verificarIdTokenGoogle,
  distRetaguarda = DIST_RETAGUARDA,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway fica atrás de proxy

  app.use(
    helmet({
      // A API vai servir o site (deploy): o popup do login com Google precisa
      // conversar com a página que o abriu, o que `same-origin` (padrão) bloqueia.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );
  app.use(
    cors({
      // Sem Origin (PDV Electron, curl, health check do Railway): passa.
      // Do navegador: só as origens de CORS_ORIGINS.
      origin(origin, callback) {
        callback(null, !origin || corsOrigins.includes(origin));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  if (log) app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.use(criarRotas({ limiteLogin, relogio, verificarIdTokenGoogle }));
  servirRetaguarda(app, distRetaguarda);

  app.use(naoEncontrado);
  app.use(tratarErro);

  return app;
}
