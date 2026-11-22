import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { criarVerificadorGoogle } from '../lib/google.js';
import { criarVerificadorApple, criarRevogadorApple } from '../lib/apple.js';
import { autenticarCliente, exigirTelefoneCliente } from '../middlewares/autenticarCliente.js';
import { criarLimitadorAuthCliente, criarLimitadoresTelefone } from '../middlewares/limitarLogin.js';
import { criarVerificadorTelefone, telefoneE164 } from '../lib/verificadorTelefone.js';
import { criarClienteController } from '../controllers/cliente.controller.js';
import { lojaDoSite } from '../middlewares/loja.js';

/** Dados pessoais: nunca em cache. */
function semCache(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * Rotas do cliente (site e app; JWT de cliente, separado do da equipe).
 * @param {{ verificarIdTokenGoogle?: Function, verificarIdentityTokenApple?: Function,
 *           revogarApple?: Function, limiteAuthCliente?: number, relogio?: () => Date,
 *           verificadorTelefone?: object, limitesTelefone?: object }} [opcoes]
 *   `verificadorTelefone`: login com celular (padrão: o de PHONE_VERIFIER);
 *   `limitesTelefone`: janelas e limites (ver criarLimitadoresTelefone; os testes encurtam).
 */
export function criarClienteRoutes({
  verificarIdTokenGoogle = criarVerificadorGoogle(),
  verificarIdentityTokenApple = criarVerificadorApple(),
  revogarApple = criarRevogadorApple(),
  verificadorTelefone = criarVerificadorTelefone(),
  limitesTelefone,
  limiteAuthCliente,
  relogio,
} = {}) {
  const c = criarClienteController(
    { verificarIdTokenGoogle, verificarIdentityTokenApple, revogarApple, verificadorTelefone },
    relogio,
  );
  const r = Router();
  r.use(semCache);

  const limitar = criarLimitadorAuthCliente({ limite: limiteAuthCliente });
  r.post('/auth/google', limitar, assincrono(c.entrarComGoogle));
  r.post('/auth/apple', limitar, assincrono(c.entrarComApple));
  // Login com celular (código de 6 dígitos): limites por IP e por número.
  const tel = criarLimitadoresTelefone(telefoneE164, limitesTelefone);
  r.post('/auth/telefone/enviar', tel.porIp, tel.reenvio, tel.porHora, assincrono(c.enviarCodigoTelefone));
  r.post('/auth/telefone/entrar', limitar, tel.errosCodigo, assincrono(c.entrarComTelefone));
  r.post('/auth/renovar', limitar, assincrono(c.renovar));
  r.post('/auth/sair', limitar, assincrono(c.sair));

  // Cadastro do cliente é único entre lojas; o pedido vai para a loja do site (padrão, por enquanto).
  r.use(autenticarCliente, lojaDoSite);
  r.get('/me', c.me);
  r.put('/me', assincrono(c.atualizarMe));
  r.delete('/me', assincrono(c.excluirConta));
  r.post('/aceite', assincrono(c.aceitarTermos));
  r.put('/marketing', assincrono(c.definirMarketing));
  r.get('/enderecos', assincrono(c.listarEnderecos));
  r.post('/enderecos', assincrono(c.criarEndereco));
  r.put('/enderecos/:id', assincrono(c.atualizarEndereco));
  r.delete('/enderecos/:id', assincrono(c.removerEndereco));
  r.post('/pedidos', exigirTelefoneCliente, assincrono(c.criarPedido));
  r.get('/pedidos', assincrono(c.listarPedidos));
  r.get('/pedidos/ultimo', assincrono(c.ultimoPedido));
  return r;
}
