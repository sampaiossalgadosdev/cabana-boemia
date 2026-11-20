import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { criarRotas } from './routes/index.js';
import { criarRotasExclusao } from './routes/exclusao.routes.js';
import { criarRotasLegais } from './routes/legal.routes.js';
import { naoEncontrado } from './middlewares/naoEncontrado.js';
import { tratarErro } from './middlewares/erro.js';
import { servirSpa, DIST_SITE, DIST_RETAGUARDA, CSP_SITE, CSP_RETAGUARDA } from './lib/estaticos.js';

export { DIST_SITE, DIST_RETAGUARDA };

/** Lê CORS_ORIGINS ("a,b,c") e devolve a lista sem espaços nem itens vazios. */
export function lerOrigensCors(valor = '') {
  return valor
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Prefixo de todas as rotas da API (o site ocupa / e a retaguarda /admin). */
export const PREFIXO_API = '/api';

/**
 * Monta o app Express sem abrir porta; usado pelo server.js e pelos testes.
 * @param {{ corsOrigins?: string[], log?: boolean, limiteLogin?: number, relogio?: () => Date,
 *           verificarIdTokenGoogle?: (idToken: string) => Promise<object> }} [opcoes]
 *   `relogio`: fonte do "agora" das rotas públicas (injetável nos testes).
 *   `verificarIdTokenGoogle` / `verificarIdentityTokenApple` / `revogarApple`: trocam o Google e a
 *   Apple nos testes (chave própria, sem rede). `limiteAuthCliente`: rate limit de /cliente/auth/*.
 *   `limiteSolicitacoes`: envios por hora do formulário de /excluir-conta.
 *   `emailTitular`: e-mail do canal do titular nas páginas legais (padrão: CONTATO_TITULAR_EMAIL).
 *   `distSite` / `distRetaguarda`: builds servidos em / e /admin (testes usam pastas próprias).
 */
export function criarApp({
  corsOrigins = lerOrigensCors(process.env.CORS_ORIGINS),
  log = true,
  limiteLogin,
  relogio,
  verificarIdTokenGoogle,
  verificarIdentityTokenApple,
  revogarApple,
  limiteAuthCliente,
  limiteSolicitacoes,
  emailTitular,
  distSite = DIST_SITE,
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

  app.use(
    PREFIXO_API,
    criarRotas({ limiteLogin, relogio, verificarIdTokenGoogle, verificarIdentityTokenApple, revogarApple, limiteAuthCliente, emailTitular }),
  );
  // Páginas públicas do app (exclusão de conta, privacidade e termos; links do Play Console
  // e do app): antes do site, que pegaria qualquer caminho.
  app.use(criarRotasExclusao({ limiteSolicitacoes }));
  app.use(criarRotasLegais({ email: emailTitular }));
  servirSpa(app, { prefixo: '/admin', dist: distRetaguarda, csp: CSP_RETAGUARDA });
  servirSpa(app, { prefixo: '/', dist: distSite, csp: CSP_SITE });

  app.use(naoEncontrado);
  app.use(tratarErro);

  return app;
}
