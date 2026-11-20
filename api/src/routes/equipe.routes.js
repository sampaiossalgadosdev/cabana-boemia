import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { autenticar } from '../middlewares/autenticar.js';
import { exigirPapel } from '../middlewares/exigirPapel.js';
import { lojaDaEquipe } from '../middlewares/loja.js';
import { criarEquipeController } from '../controllers/equipe.controller.js';

/**
 * Rotas do PDV (DONO e ATENDENTE; ADMIN passa como DONO), sempre na loja do
 * usuário (`req.lojaId`). Dados do dia: nunca em cache.
 * @param {{ relogio?: () => Date }} [opcoes]
 */
export function criarEquipeRoutes({ relogio } = {}) {
  const c = criarEquipeController(relogio);
  const r = Router();
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.use(autenticar, exigirPapel('DONO', 'ATENDENTE'), lojaDaEquipe);
  r.get('/pedidos', assincrono(c.listarPedidos));
  r.post('/pedidos', assincrono(c.criarPedido));
  r.patch('/pedidos/:id/finalizar', assincrono(c.finalizarPedido));
  r.patch('/pedidos/:id/cancelar', assincrono(c.cancelarPedido));
  r.patch('/pedidos/:id/status', assincrono(c.alterarStatus));
  r.patch('/pedidos/:id/agendamento', assincrono(c.alterarAgendamento));
  r.post('/pedidos/:id/reimprimir', assincrono(c.reimprimirPedido));
  r.patch('/pedidos/:id/nfce', assincrono(c.definirNfce));
  r.get('/caixa/atual', assincrono(c.caixaAtual));
  r.post('/caixa/abrir', assincrono(c.abrirCaixa));
  r.post('/caixa/movimentos', assincrono(c.movimentoCaixa));
  r.post('/caixa/fechar', assincrono(c.fecharCaixa));
  r.get('/comandas', assincrono(c.listarComandas));
  r.post('/comandas', assincrono(c.abrirComanda));
  r.get('/comandas/:id', assincrono(c.obterComanda));
  r.post('/comandas/:id/itens', assincrono(c.lancarItemComanda));
  r.delete('/comandas/:id/itens/:itemId', assincrono(c.removerItemComanda));
  r.post('/comandas/:id/fechar', assincrono(c.fecharComanda));
  r.get('/impressoes/pendentes', assincrono(c.impressoesPendentes)); // PDV antigo (sem reserva)
  r.post('/impressoes/reservar', assincrono(c.reservarImpressoes)); // agente novo
  r.post('/impressoes/:id/confirmar', assincrono(c.confirmarImpressao));
  r.post('/impressoes/:id/falha', assincrono(c.falhaImpressao));
  r.get('/clientes', assincrono(c.buscarClientes));
  r.post('/clientes', assincrono(c.criarCliente));
  r.put('/clientes/:id', assincrono(c.atualizarCliente));
  r.post('/clientes/:id/enderecos', assincrono(c.adicionarEndereco));
  r.put('/clientes/:id/enderecos/:enderecoId', assincrono(c.atualizarEndereco));
  r.get('/cardapio', assincrono(c.cardapio));
  r.get('/config/tempo-estimado', assincrono(c.obterTempo));
  r.put('/config/tempo-estimado', assincrono(c.definirTempo));
  return r;
}
