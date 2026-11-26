import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { criarVerificadorGoogle } from '../lib/google.js';
import { criarVerificadorApple, criarRevogadorApple } from '../lib/apple.js';
import { autenticarCliente, exigirTelefoneCliente } from '../middlewares/autenticarCliente.js';
import { criarLimitadorAuthCliente, criarLimitadoresTelefone } from '../middlewares/limitarLogin.js';
import { criarVerificadorTelefone, telefoneE164 } from '../lib/verificadorTelefone.js';
import { criarClienteController } from '../controllers/cliente.controller.js';
import { lojaDoSite } from '../middlewares/loja.js';
import { criarLimitadorMapa, criarMapaController } from '../controllers/mapa.controller.js';
import { pagamentosPadrao } from '../services/pagamento.service.js';

/** Dados pessoais: nunca em cache. */
function semCache(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * Rotas do cliente (site e app; JWT de cliente, separado do da equipe).
 * @param {{ verificarIdTokenGoogle?: Function, verificarIdentityTokenApple?: Function,
 *           revogarApple?: Function, limiteAuthCliente?: number, relogio?: () => Date,
 *           verificadorTelefone?: object, limitesTelefone?: object, mapas?: object }} [opcoes]
 *   `verificadorTelefone`: login com celular (padrão: o de PHONE_VERIFIER);
 *   `limitesTelefone`: janelas e limites (ver criarLimitadoresTelefone; os testes encurtam).
 *   `pagamentos`: pagamento online (Pix; padrão: o do ambiente; os testes simulam o Mercado Pago).
 */
export function criarClienteRoutes({
  verificarIdTokenGoogle = criarVerificadorGoogle(),
  verificarIdentityTokenApple = criarVerificadorApple(),
  revogarApple = criarRevogadorApple(),
  verificadorTelefone = criarVerificadorTelefone(),
  limitesTelefone,
  limiteAuthCliente,
  relogio,
  mapas,
  pagamentos = pagamentosPadrao(),
} = {}) {
  const c = criarClienteController(
    { verificarIdTokenGoogle, verificarIdentityTokenApple, revogarApple, verificadorTelefone, mapas, pagamentos },
    relogio,
  );
  const mapa = criarMapaController(mapas);
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
  r.put('/email', assincrono(c.definirEmail));
  // Verificar o telefone da conta logada (campanha): mesmo verificador e mesmos limites do login.
  r.post('/telefone/enviar', tel.porIp, tel.reenvio, tel.porHora, assincrono(c.enviarCodigoDaConta));
  r.post('/telefone/verificar', tel.errosCodigo, assincrono(c.verificarTelefoneDaConta));
  r.put('/marketing', assincrono(c.definirMarketing));
  // Busca do endereço no mapa (Geocoding pelo servidor; a chave não vai ao app).
  r.post('/mapa/geocodificar', criarLimitadorMapa({ chave: (req) => `cliente:${req.cliente.id}` }), assincrono(mapa.geocodificarEndereco));
  r.get('/enderecos', assincrono(c.listarEnderecos));
  r.post('/enderecos', assincrono(c.criarEndereco));
  r.put('/enderecos/:id', assincrono(c.atualizarEndereco));
  r.delete('/enderecos/:id', assincrono(c.removerEndereco));
  r.post('/pedidos', exigirTelefoneCliente, assincrono(c.criarPedido));
  r.post('/pedidos/previa', exigirTelefoneCliente, assincrono(c.previaPedido));
  r.get('/pedidos/:id/pagamento', assincrono(c.situacaoPagamento));
  r.post('/pedidos/:id/cancelar', assincrono(c.cancelarPedido));
  r.get('/pedidos', assincrono(c.listarPedidos));
  r.get('/pedidos/ultimo', assincrono(c.ultimoPedido));
  return r;
}
