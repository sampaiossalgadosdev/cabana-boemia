import express, { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { autenticar } from '../middlewares/autenticar.js';
import { exigirPapel } from '../middlewares/exigirPapel.js';
import * as c from '../controllers/plataforma.controller.js';
import { criarLimitadorMapa, criarMapaController } from '../controllers/mapa.controller.js';
import { criarPagamentosController } from '../controllers/pagamentosAdmin.controller.js';
import { pagamentosPadrao } from '../services/pagamento.service.js';

/**
 * Rotas da plataforma (Taaki Delivery): só ADMIN (o DONO leva 403), nunca em cache.
 * - Lojas: listar, criar (com turnos iniciais opcionais), editar e criar o DONO de cada uma.
 * - Bairros da cidade: a lista única que todas as lojas usam (o DONO só escolhe
 *   os da área de entrega dele, com a taxa, em /retaguarda/bairros).
 * - Anúncios do carrossel "Patrocinado" do app (registro da veiculação; sem excluir).
 * - Solicitações de exclusão de conta da página pública /excluir-conta (a
 *   plataforma é a controladora dos dados; atendidas à mão pelo ADMIN).
 * - Alertas para o ADMIN (renovação do Mercado Pago que falhou, pagamentos que pedem ação).
 * - Pagamentos online: cancelar com estorno (total ou parcial, motivo obrigatório), estornar
 *   pedido finalizado e os reembolsos pendentes (tentar de novo, resolvido por fora).
 */
/** Corpo cru da imagem (até 500 KB; o tipo é conferido pelos bytes no service). */
export const corpoImagem = () => express.raw({ type: () => true, limit: '520kb' });

/** @param {{ relogio?: () => Date, mapas?: object, pagamentos?: object }} [opcoes] */
export function criarPlataformaRoutes({ relogio, mapas, pagamentos = pagamentosPadrao() } = {}) {
  const anuncios = c.criarAnunciosController(relogio);
  const pag = criarPagamentosController(pagamentos, relogio);
  const mapa = criarMapaController(mapas);
  const r = Router();
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.use(autenticar, exigirPapel('ADMIN'));
  r.get('/lojas', assincrono(c.listarLojas));
  r.post('/lojas', assincrono(c.criarLoja));
  r.patch('/lojas/:id', assincrono(c.editarLoja));
  r.put('/lojas/:id/logo-padrao', corpoImagem(), assincrono(c.definirLogoPadrao));
  r.post('/lojas/:id/dono', assincrono(c.criarDono));
  // Mapas: pino da loja (busca no mapa) e o uso diário do Google.
  r.get('/mapas/config', mapa.configWeb);
  r.post('/mapas/geocodificar', criarLimitadorMapa({ limite: 60, chave: (req) => `usuario:${req.usuario.id}` }), assincrono(mapa.geocodificarTexto));
  r.get('/mapas/uso', assincrono(mapa.uso));
  r.get('/bairros', assincrono(c.listarBairros));
  r.post('/bairros', assincrono(c.criarBairro));
  r.patch('/bairros/:id', assincrono(c.alterarBairro));
  r.get('/anuncios', assincrono(anuncios.listar));
  r.post('/anuncios/imagens', corpoImagem(), assincrono(anuncios.enviarImagem));
  r.post('/anuncios', assincrono(anuncios.criar));
  r.patch('/anuncios/:id', assincrono(anuncios.alterar));
  r.get('/alertas', assincrono(c.listarAlertas));
  r.get('/alertas/contagem', assincrono(c.contarAlertas));
  r.patch('/alertas/:id/resolvido', assincrono(c.resolverAlerta));
  // Pagamentos online (Etapa 5): lista, cancelar/estornar e os reembolsos pendentes.
  r.get('/pagamentos', assincrono(pag.listar));
  r.post('/pedidos/:id/estornar', assincrono(pag.estornar));
  r.post('/pagamentos/:id/tentar-estorno', assincrono(pag.tentarDeNovo));
  r.post('/pagamentos/:id/resolvido', assincrono(pag.resolvidoPorFora));
  r.get('/solicitacoes-exclusao', assincrono(c.listarSolicitacoesExclusao));
  r.patch('/solicitacoes-exclusao/:id/atendida', assincrono(c.marcarSolicitacaoAtendida));
  return r;
}
