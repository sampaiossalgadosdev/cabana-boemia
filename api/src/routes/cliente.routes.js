import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { criarVerificadorGoogle } from '../lib/google.js';
import { autenticarCliente, exigirTelefoneCliente } from '../middlewares/autenticarCliente.js';
import { criarClienteController } from '../controllers/cliente.controller.js';

/** Dados pessoais: nunca em cache. */
function semCache(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * Rotas do cliente do site (JWT de cliente, separado do da equipe).
 * @param {{ verificarIdTokenGoogle?: (idToken: string) => Promise<object>, relogio?: () => Date }} [opcoes]
 */
export function criarClienteRoutes({ verificarIdTokenGoogle = criarVerificadorGoogle(), relogio } = {}) {
  const c = criarClienteController(verificarIdTokenGoogle, relogio);
  const r = Router();
  r.use(semCache);

  r.post('/auth/google', assincrono(c.entrarComGoogle));

  r.use(autenticarCliente);
  r.get('/me', c.me);
  r.put('/me', assincrono(c.atualizarMe));
  r.get('/enderecos', assincrono(c.listarEnderecos));
  r.post('/enderecos', assincrono(c.criarEndereco));
  r.put('/enderecos/:id', assincrono(c.atualizarEndereco));
  r.delete('/enderecos/:id', assincrono(c.removerEndereco));
  r.post('/pedidos', exigirTelefoneCliente, assincrono(c.criarPedido));
  r.get('/pedidos/ultimo', assincrono(c.ultimoPedido));
  return r;
}
