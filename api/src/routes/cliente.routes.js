import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { criarVerificadorGoogle } from '../lib/google.js';
import { criarVerificadorApple, criarRevogadorApple } from '../lib/apple.js';
import { autenticarCliente, exigirTelefoneCliente } from '../middlewares/autenticarCliente.js';
import { criarLimitadorAuthCliente } from '../middlewares/limitarLogin.js';
import { criarClienteController } from '../controllers/cliente.controller.js';

/** Dados pessoais: nunca em cache. */
function semCache(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * Rotas do cliente (site e app; JWT de cliente, separado do da equipe).
 * @param {{ verificarIdTokenGoogle?: Function, verificarIdentityTokenApple?: Function,
 *           revogarApple?: Function, limiteAuthCliente?: number, relogio?: () => Date }} [opcoes]
 */
export function criarClienteRoutes({
  verificarIdTokenGoogle = criarVerificadorGoogle(),
  verificarIdentityTokenApple = criarVerificadorApple(),
  revogarApple = criarRevogadorApple(),
  limiteAuthCliente,
  relogio,
} = {}) {
  const c = criarClienteController({ verificarIdTokenGoogle, verificarIdentityTokenApple, revogarApple }, relogio);
  const r = Router();
  r.use(semCache);

  const limitar = criarLimitadorAuthCliente({ limite: limiteAuthCliente });
  r.post('/auth/google', limitar, assincrono(c.entrarComGoogle));
  r.post('/auth/apple', limitar, assincrono(c.entrarComApple));
  r.post('/auth/renovar', limitar, assincrono(c.renovar));
  r.post('/auth/sair', limitar, assincrono(c.sair));

  r.use(autenticarCliente);
  r.get('/me', c.me);
  r.put('/me', assincrono(c.atualizarMe));
  r.delete('/me', assincrono(c.excluirConta));
  r.get('/enderecos', assincrono(c.listarEnderecos));
  r.post('/enderecos', assincrono(c.criarEndereco));
  r.put('/enderecos/:id', assincrono(c.atualizarEndereco));
  r.delete('/enderecos/:id', assincrono(c.removerEndereco));
  r.post('/pedidos', exigirTelefoneCliente, assincrono(c.criarPedido));
  r.get('/pedidos', assincrono(c.listarPedidos));
  r.get('/pedidos/ultimo', assincrono(c.ultimoPedido));
  return r;
}
