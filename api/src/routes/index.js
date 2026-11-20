import { Router } from 'express';
import { healthRoutes } from './health.routes.js';
import { criarAuthRoutes } from './auth.routes.js';
import { criarUsuarioRoutes } from './usuario.routes.js';
import { criarPublicoRoutes } from './publico.routes.js';
import { criarClienteRoutes } from './cliente.routes.js';
import { criarEquipeRoutes } from './equipe.routes.js';
import { criarRetaguardaRoutes } from './retaguarda.routes.js';
import { criarPlataformaRoutes } from './plataforma.routes.js';

/**
 * Rotas montadas por app: cada criarApp() tem seu próprio rate limiter
 * (estado em memória), o que isola os testes.
 * @param {{ limiteLogin?: number, relogio?: () => Date, verificarIdTokenGoogle?: Function,
 *           verificarIdentityTokenApple?: Function, revogarApple?: Function, limiteAuthCliente?: number }} [opcoes]
 */
export function criarRotas(opcoes = {}) {
  const routes = Router();
  routes.use('/health', healthRoutes);
  routes.use('/auth', criarAuthRoutes(opcoes));
  routes.use('/usuarios', criarUsuarioRoutes());
  routes.use('/publico', criarPublicoRoutes(opcoes));
  routes.use('/cliente', criarClienteRoutes(opcoes));
  routes.use('/equipe', criarEquipeRoutes(opcoes));
  routes.use('/retaguarda', criarRetaguardaRoutes(opcoes));
  routes.use('/plataforma', criarPlataformaRoutes());
  return routes;
}
