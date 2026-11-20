import { z } from 'zod';
import { telefone, enderecoSchema, idSchema, itemPedidoSchema, trocoSoEmDinheiro } from './esquemas.js';
import { validar } from '../lib/validar.js';
import * as clienteService from '../services/cliente.service.js';
import * as enderecoService from '../services/endereco.service.js';
import * as pedidoService from '../services/pedido.service.js';
import { registrarAcesso } from '../services/registroAcesso.service.js';
import { buscarAtivaPorSlug } from '../services/loja.service.js';

const googleSchema = z.object({
  credential: z.string().min(1, 'Informe o credential do Google').max(4096),
  // App: pede também o refresh token (sessão longa). O site não manda e recebe só o token.
  refresh: z.boolean().optional(),
});

const appleSchema = z.object({
  identityToken: z.string().min(1, 'Informe o identity token da Apple').max(4096),
  // Nonce bruto: o app pediu à Apple o SHA-256 dele, que vem dentro do token.
  nonce: z.string().min(16).max(128),
  // A Apple só manda o nome no primeiro login (pelo app, fora do token).
  nome: z.string().trim().max(100).optional(),
  refresh: z.boolean().optional(),
});

const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });

const exclusaoSchema = z.object({
  // Conta da Apple: código novo do "Entrar com Apple" para revogar o login na Apple.
  appleAuthorizationCode: z.string().min(1).max(2048).optional(),
});

const perfilSchema = z.object({
  nome: z.string({ error: 'Informe o nome' }).trim().min(1, 'Informe o nome').max(100),
  telefone,
});

const slugLoja = z.string({ error: 'Loja inválida' }).trim().toLowerCase().min(1, 'Loja inválida').max(60);

/** Pedido do site e do app (itens: ver itemPedidoSchema; o preço sempre sai do banco). */
const pedidoSchema = z
  .object({
    itens: z.array(itemPedidoSchema, { error: 'A sacola está vazia' }).min(1, 'A sacola está vazia').max(50),
    enderecoId: z.number({ error: 'Escolha o endereço de entrega' }).int().positive(),
    formaPagamento: z.enum(pedidoService.FORMAS_PAGAMENTO, { error: 'Escolha a forma de pagamento' }),
    trocoParaCentavos: z.number().int().positive().nullish(),
    chaveIdempotencia: z.uuid().optional(),
    // Total que o cliente viu (só para conferir: o preço sempre sai do banco).
    totalEsperadoCentavos: z.number({ error: 'Informe o total do pedido' }).int().min(0),
    // Loja do pedido (app). Ausente = loja padrão (Cabana), como o site atual.
    lojaSlug: slugLoja.optional(),
  })
  .superRefine(trocoSoEmDinheiro);

const historicoSchema = z.object({
  antesDeId: z.coerce.number().int().positive().optional(),
  lojaSlug: slugLoja.optional(), // só os pedidos desta loja (ausente = de todas)
});

const ultimoSchema = z.object({ lojaSlug: slugLoja.optional() });

/** Loja do slug informado (ativa; senão 404), ou a padrão da rota. */
const lojaDoPedido = async (lojaSlug, padrao) => (lojaSlug ? (await buscarAtivaPorSlug(lojaSlug)).id : padrao);

/**
 * @param {{ verificarIdTokenGoogle: Function, verificarIdentityTokenApple: Function, revogarApple: Function }} deps
 * @param {() => Date} [relogio] "agora" do pedido (injetável nos testes)
 */
export function criarClienteController(
  { verificarIdTokenGoogle, verificarIdentityTokenApple, revogarApple },
  relogio = () => new Date(),
) {
  return {
    async entrarComGoogle(req, res) {
      const { credential, refresh } = validar(googleSchema, req.body);
      const identidade = await verificarIdTokenGoogle(credential);
      const r = await clienteService.entrarComGoogle(identidade, { comRefresh: refresh === true });
      await registrarAcesso({ clienteId: r.cliente.id, ip: req.ip, evento: 'LOGIN' });
      res.json(r);
    },

    async entrarComApple(req, res) {
      const { identityToken, nonce, nome, refresh } = validar(appleSchema, req.body);
      const identidade = await verificarIdentityTokenApple(identityToken, { nonce });
      const r = await clienteService.entrarComApple(identidade, { nome, comRefresh: refresh === true });
      await registrarAcesso({ clienteId: r.cliente.id, ip: req.ip, evento: 'LOGIN' });
      res.json(r);
    },

    async renovar(req, res) {
      const { refreshToken } = validar(refreshSchema, req.body);
      const r = await clienteService.renovarSessao(refreshToken);
      await registrarAcesso({ clienteId: r.cliente.id, ip: req.ip, evento: 'REFRESH' });
      res.json(r);
    },

    async sair(req, res) {
      const { refreshToken } = validar(refreshSchema, req.body);
      await clienteService.sair(refreshToken);
      res.status(204).end();
    },

    async excluirConta(req, res) {
      const { appleAuthorizationCode } = validar(exclusaoSchema, req.body ?? {});
      const r = await clienteService.excluirConta(req.cliente.id, {
        appleAuthorizationCode,
        revogarApple,
        agora: relogio(),
      });
      // Depois de apagar a conta: o registro fica pelo prazo legal (sem chave estrangeira).
      await registrarAcesso({ clienteId: req.cliente.id, ip: req.ip, evento: 'EXCLUSAO_CONTA' });
      res.json({ excluido: true, pedidosAnonimizados: r.pedidosAnonimizados, appleRevogado: r.apple?.revogado ?? null });
    },

    me(req, res) {
      res.json({ cliente: req.cliente });
    },

    async atualizarMe(req, res) {
      const dados = validar(perfilSchema, req.body);
      res.json({ cliente: await clienteService.atualizarPerfil(req.cliente.id, dados) });
    },

    async listarEnderecos(req, res) {
      res.json({ enderecos: await enderecoService.listar(req.cliente.id, { lojaId: req.lojaId }) });
    },

    async criarEndereco(req, res) {
      const dados = validar(enderecoSchema, req.body);
      res.status(201).json({ endereco: await enderecoService.criar(req.cliente.id, dados, { lojaId: req.lojaId }) });
    },

    async atualizarEndereco(req, res) {
      const { id } = validar(idSchema, req.params);
      const dados = validar(enderecoSchema, req.body);
      res.json({ endereco: await enderecoService.atualizar(req.cliente.id, id, dados, { lojaId: req.lojaId }) });
    },

    async removerEndereco(req, res) {
      const { id } = validar(idSchema, req.params);
      await enderecoService.remover(req.cliente.id, id);
      res.status(204).end();
    },

    async criarPedido(req, res) {
      const dados = validar(pedidoSchema, req.body);
      const lojaId = await lojaDoPedido(dados.lojaSlug, req.lojaId);
      const { pedido, criado } = await pedidoService.criarPedidoDoSite(lojaId, req.cliente, dados, { agora: relogio() });
      await registrarAcesso({ clienteId: req.cliente.id, ip: req.ip, evento: 'PEDIDO' });
      res.status(criado ? 201 : 200).json({ pedido });
    },

    /** Histórico de todas as lojas (cada pedido traz `loja`); `lojaSlug` filtra uma. */
    async listarPedidos(req, res) {
      const { antesDeId, lojaSlug } = validar(historicoSchema, req.query);
      const lojaId = lojaSlug ? (await buscarAtivaPorSlug(lojaSlug)).id : undefined;
      res.json(await pedidoService.pedidosDoCliente(req.cliente.id, { antesDeId, lojaId }));
    },

    /** "Repetir último pedido" é de uma loja: a do `lojaSlug` ou, sem ele, a padrão (site atual). */
    async ultimoPedido(req, res) {
      const { lojaSlug } = validar(ultimoSchema, req.query);
      res.json({ pedido: await pedidoService.ultimoPedidoDoCliente(req.cliente.id, await lojaDoPedido(lojaSlug, req.lojaId)) });
    },
  };
}
