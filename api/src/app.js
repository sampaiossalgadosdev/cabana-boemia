import express from 'express';
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

/**
 * Monta o app Express sem abrir porta; usado pelo server.js e pelos testes.
 * @param {{ corsOrigins?: string[], log?: boolean, limiteLogin?: number, relogio?: () => Date,
 *           verificarIdTokenGoogle?: (idToken: string) => Promise<object> }} [opcoes]
 *   `relogio`: fonte do "agora" das rotas públicas (injetável nos testes).
 *   `verificarIdTokenGoogle`: troca o verificador do Google (testes usam chave própria).
 */
export function criarApp({
  corsOrigins = lerOrigensCors(process.env.CORS_ORIGINS),
  log = true,
  limiteLogin,
  relogio,
  verificarIdTokenGoogle,
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

  app.use(naoEncontrado);
  app.use(tratarErro);

  return app;
}
