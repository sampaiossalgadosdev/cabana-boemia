import { z } from 'zod';
import { normalizarTelefone, MENSAGEM_TELEFONE_INVALIDO } from '@restaurante/shared/telefone';
import { validar } from '../lib/validar.js';
import * as clienteService from '../services/cliente.service.js';
import * as enderecoService from '../services/endereco.service.js';
import * as pedidoService from '../services/pedido.service.js';

const googleSchema = z.object({
  credential: z.string().min(1, 'Informe o credential do Google').max(4096),
});

/** Celular brasileiro (DDD + 9 dígitos); sai só com números. */
const telefone = z.string({ error: MENSAGEM_TELEFONE_INVALIDO }).transform((v, ctx) => {
  const n = normalizarTelefone(v);
  if (!n) {
    ctx.addIssue({ code: 'custom', message: MENSAGEM_TELEFONE_INVALIDO });
    return z.NEVER;
  }
  return n;
});

const perfilSchema = z.object({
  nome: z.string({ error: 'Informe o nome' }).trim().min(1, 'Informe o nome').max(100),
  telefone,
});

/** Texto opcional: vazio ou ausente vira null. */
const opcional = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const enderecoSchema = z.object({
  rua: z.string({ error: 'Informe a rua' }).trim().min(1, 'Informe a rua').max(120),
  numero: z.string({ error: 'Informe o número' }).trim().min(1, 'Informe o número').max(20),
  complemento: opcional(120),
  referencia: opcional(200),
  bairroId: z.number({ error: 'Escolha o bairro' }).int().positive(),
  principal: z.boolean().optional(),
});

const idSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Pedido do site. Só produtoId, quantidade e observação por item: qualquer
 * outro campo (ex.: precoCentavos) é descartado pelo zod e o preço sai do banco.
 */
const itemPedidoSchema = z.object({
  produtoId: z.number({ error: 'Item inválido' }).int().positive(),
  quantidade: z.number({ error: 'Quantidade inválida' }).int().min(1).max(20),
  observacao: opcional(140),
});

const pedidoSchema = z
  .object({
    itens: z.array(itemPedidoSchema, { error: 'O carrinho está vazio' }).min(1, 'O carrinho está vazio').max(50),
    enderecoId: z.number({ error: 'Escolha o endereço de entrega' }).int().positive(),
    formaPagamento: z.enum(pedidoService.FORMAS_PAGAMENTO, { error: 'Escolha a forma de pagamento' }),
    trocoParaCentavos: z.number().int().positive().nullish(),
    chaveIdempotencia: z.uuid().optional(),
    // Total que o cliente viu (só para conferir: o preço sempre sai do banco).
    totalEsperadoCentavos: z.number({ error: 'Informe o total do pedido' }).int().min(0),
  })
  .superRefine((d, ctx) => {
    if (d.trocoParaCentavos != null && d.formaPagamento !== 'DINHEIRO') {
      ctx.addIssue({ code: 'custom', path: ['trocoParaCentavos'], message: 'Troco só para pagamento em dinheiro' });
    }
  });

/**
 * @param {(idToken: string) => Promise<object>} verificarIdTokenGoogle
 * @param {() => Date} [relogio] "agora" do pedido (injetável nos testes)
 */
export function criarClienteController(verificarIdTokenGoogle, relogio = () => new Date()) {
  return {
    async entrarComGoogle(req, res) {
      const { credential } = validar(googleSchema, req.body);
      const identidade = await verificarIdTokenGoogle(credential);
      res.json(await clienteService.entrarComGoogle(identidade));
    },

    me(req, res) {
      res.json({ cliente: req.cliente });
    },

    async atualizarMe(req, res) {
      const dados = validar(perfilSchema, req.body);
      res.json({ cliente: await clienteService.atualizarPerfil(req.cliente.id, dados) });
    },

    async listarEnderecos(req, res) {
      res.json({ enderecos: await enderecoService.listar(req.cliente.id) });
    },

    async criarEndereco(req, res) {
      const dados = validar(enderecoSchema, req.body);
      res.status(201).json({ endereco: await enderecoService.criar(req.cliente.id, dados) });
    },

    async atualizarEndereco(req, res) {
      const { id } = validar(idSchema, req.params);
      const dados = validar(enderecoSchema, req.body);
      res.json({ endereco: await enderecoService.atualizar(req.cliente.id, id, dados) });
    },

    async removerEndereco(req, res) {
      const { id } = validar(idSchema, req.params);
      await enderecoService.remover(req.cliente.id, id);
      res.status(204).end();
    },

    async criarPedido(req, res) {
      const dados = validar(pedidoSchema, req.body);
      const { pedido, criado } = await pedidoService.criarPedidoDoSite(req.cliente, dados, { agora: relogio() });
      res.status(criado ? 201 : 200).json({ pedido });
    },

    async ultimoPedido(req, res) {
      res.json({ pedido: await pedidoService.ultimoPedidoDoCliente(req.cliente.id) });
    },
  };
}
