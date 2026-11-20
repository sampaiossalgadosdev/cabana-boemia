import express, { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { autenticar } from '../middlewares/autenticar.js';
import { exigirPapel } from '../middlewares/exigirPapel.js';
import * as c from '../controllers/plataforma.controller.js';

/**
 * Rotas da plataforma (Delivery Abatiá): só ADMIN (o DONO leva 403), nunca em cache.
 * - Lojas: listar, criar (com turnos iniciais opcionais), editar e criar o DONO de cada uma.
 * - Bairros da cidade: a lista única que todas as lojas usam (o DONO só escolhe
 *   os da área de entrega dele, com a taxa, em /retaguarda/bairros).
 * - Solicitações de exclusão de conta da página pública /excluir-conta (a
 *   plataforma é a controladora dos dados; atendidas à mão pelo ADMIN).
 */
/** Corpo cru da imagem (até 500 KB; o tipo é conferido pelos bytes no service). */
export const corpoImagem = () => express.raw({ type: () => true, limit: '520kb' });

export function criarPlataformaRoutes() {
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
  r.get('/bairros', assincrono(c.listarBairros));
  r.post('/bairros', assincrono(c.criarBairro));
  r.patch('/bairros/:id', assincrono(c.alterarBairro));
  r.get('/solicitacoes-exclusao', assincrono(c.listarSolicitacoesExclusao));
  r.patch('/solicitacoes-exclusao/:id/atendida', assincrono(c.marcarSolicitacaoAtendida));
  return r;
}
