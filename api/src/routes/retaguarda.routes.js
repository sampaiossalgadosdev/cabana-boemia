import { Router } from 'express';
import { assincrono } from '../lib/assincrono.js';
import { autenticar } from '../middlewares/autenticar.js';
import { exigirPapel } from '../middlewares/exigirPapel.js';
import { lojaDaEquipe } from '../middlewares/loja.js';
import { criarRetaguardaController } from '../controllers/retaguarda.controller.js';
import { corpoImagem } from './plataforma.routes.js';

/**
 * Rotas da retaguarda (só DONO; ADMIN passa como DONO), na loja do usuário
 * (`req.lojaId`), nunca em cache. Catálogo, estoque, turnos,
 * bairros e configuração emitem `cardapio:atualizado` para o PDV recarregar.
 * @param {{ relogio?: () => Date }} [opcoes]
 */
export function criarRetaguardaRoutes({ relogio } = {}) {
  const c = criarRetaguardaController(relogio);
  const r = Router();
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.use(autenticar, exigirPapel('DONO'), lojaDaEquipe);
  r.get('/caixas', assincrono(c.caixas));
  r.get('/relatorios/dia', assincrono(c.relatorioDia));
  r.post('/relatorios/dia/imprimir', assincrono(c.imprimirRelatorioDia));

  r.get('/categorias', assincrono(c.listarCategorias));
  r.post('/categorias', assincrono(c.criarCategoria));
  r.patch('/categorias/:id', assincrono(c.alterarCategoria));

  r.get('/produtos', assincrono(c.listarProdutos));
  r.post('/produtos', assincrono(c.criarProduto));
  r.get('/produtos/:id', assincrono(c.obterProduto));
  r.put('/produtos/:id', assincrono(c.alterarProduto));
  r.patch('/produtos/:id/disponivel-hoje', assincrono(c.definirDisponivelHoje));
  r.patch('/produtos/:id/descricao', assincrono(c.definirDescricao));

  r.get('/cardapio-do-dia', assincrono(c.cardapioDoDia));
  r.post('/cardapio-do-dia/liberar-tudo', assincrono(c.liberarTudo));

  r.get('/turnos', assincrono(c.listarTurnos));
  r.post('/turnos', assincrono(c.criarTurno));
  r.patch('/turnos/:id', assincrono(c.alterarTurno));
  r.put('/turnos/:id/horarios', assincrono(c.definirHorarios));

  // Área de entrega da loja (bairros da lista da cidade + taxa); `:id` = id do bairro.
  r.get('/bairros', assincrono(c.listarBairros));
  r.get('/bairros/cidade', assincrono(c.bairrosDaCidade));
  r.post('/bairros', assincrono(c.criarBairro));
  r.patch('/bairros/:id', assincrono(c.alterarBairro));

  r.get('/estoque', assincrono(c.estoque));
  r.post('/estoque/entrada', assincrono(c.entrada));
  r.post('/estoque/ajuste', assincrono(c.ajuste));
  r.get('/estoque/movimentacoes', assincrono(c.movimentacoes));
  r.post('/insumos', assincrono(c.criarInsumo));
  r.put('/insumos/:id', assincrono(c.alterarInsumo));

  // Perfil da loja: cor primária e logo (o ADMIN define o padrão).
  r.get('/perfil', assincrono(c.obterPerfil));
  r.put('/perfil/cor', assincrono(c.definirCor));
  r.put('/perfil/logo', corpoImagem(), assincrono(c.definirLogo));
  r.post('/perfil/padrao', assincrono(c.voltarAoPadrao));

  r.get('/config', assincrono(c.obterConfig));
  r.put('/config', assincrono(c.definirConfig));
  return r;
}
