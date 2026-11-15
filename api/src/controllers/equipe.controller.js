import { z } from 'zod';
import { validar } from '../lib/validar.js';
import * as pedidoService from '../services/pedido.service.js';
import { CANAIS, FORMAS_PAGAMENTO } from '../services/pedido.service.js';
import * as equipeService from '../services/equipe.service.js';
import { enderecoSchema, itemPedidoSchema, telefone, trocoSoEmDinheiro } from './esquemas.js';

const buscaSchema = z.object({
  busca: z
    .string({ error: 'Digite o nome ou o telefone' })
    .trim()
    .min(2, 'Digite pelo menos 2 letras ou números')
    .max(60),
});

const enderecoNovoSchema = enderecoSchema.omit({ principal: true });

const clienteNovoSchema = z.object({
  nome: z.string({ error: 'Informe o nome' }).trim().min(1, 'Informe o nome').max(100),
  telefone,
  endereco: enderecoNovoSchema,
});

const cardapioSchema = z.object({ turnoId: z.coerce.number().int().positive().optional() });

/** Pedido do WhatsApp: o mesmo item do site; cliente e endereço do cadastro. */
const pedidoWhatsappSchema = z
  .object({
    clienteId: z.number({ error: 'Escolha o cliente' }).int().positive(),
    enderecoId: z.number({ error: 'Escolha o endereço de entrega' }).int().positive(),
    itens: z.array(itemPedidoSchema, { error: 'Adicione os itens' }).min(1, 'Adicione os itens').max(50),
    formaPagamento: z.enum(FORMAS_PAGAMENTO, { error: 'Escolha a forma de pagamento' }),
    trocoParaCentavos: z.number().int().positive().nullish(),
    chaveIdempotencia: z.uuid().optional(),
  })
  .superRefine(trocoSoEmDinheiro);

const listarSchema = z.object({
  dataRef: z
    .string()
    .regex(/^(hoje|\d{4}-\d{2}-\d{2})$/, 'Use "hoje" ou AAAA-MM-DD')
    .default('hoje'),
  // "SITE,WHATSAPP" → ['SITE', 'WHATSAPP']; ausente = todos os canais
  canal: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(CANAIS, { error: 'Canal inválido' })).optional()),
  status: z.enum(['abertos', 'todos'], { error: 'Use "abertos" ou "todos"' }).default('abertos'),
});

const idSchema = z.object({ id: z.coerce.number().int().positive() });

const finalizarSchema = z.object({
  formaPagamento: z.enum(FORMAS_PAGAMENTO, { error: 'Informe a forma de pagamento' }),
});

/** Inteiro de 1 a 240; null, "" ou ausente = voltar ao padrão. */
const tempoSchema = z.object({
  minutos: z
    .union([
      z.literal('').transform(() => null),
      z.null(),
      z
        .number({ error: 'Informe os minutos' })
        .int('Use minutos inteiros')
        .min(equipeService.TEMPO_MIN, `Mínimo ${equipeService.TEMPO_MIN} min`)
        .max(equipeService.TEMPO_MAX, `Máximo ${equipeService.TEMPO_MAX} min`),
    ])
    .optional()
    .transform((v) => v ?? null),
});

/** @param {() => Date} [relogio] fonte do "agora" (injetável nos testes) */
export function criarEquipeController(relogio = () => new Date()) {
  return {
    async listarPedidos(req, res) {
      const q = validar(listarSchema, req.query);
      res.json(
        await equipeService.listarPedidosDoDia(
          { dataRef: q.dataRef, canais: q.canal, somenteAbertos: q.status === 'abertos' },
          relogio(),
        ),
      );
    },

    async finalizarPedido(req, res) {
      const { id } = validar(idSchema, req.params);
      const dados = validar(finalizarSchema, req.body ?? {});
      res.json({ pedido: await equipeService.finalizarPedido(id, dados, relogio()) });
    },

    async cancelarPedido(req, res) {
      const { id } = validar(idSchema, req.params);
      res.json({ pedido: await pedidoService.cancelarPedido(id, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async criarPedido(req, res) {
      const dados = validar(pedidoWhatsappSchema, req.body);
      const { pedido, criado } = await pedidoService.criarPedidoDoWhatsapp(dados, {
        usuarioId: req.usuario.id,
        agora: relogio(),
      });
      res.status(criado ? 201 : 200).json({ pedido });
    },

    async buscarClientes(req, res) {
      const { busca } = validar(buscaSchema, req.query);
      res.json({ clientes: await equipeService.buscarClientes(busca) });
    },

    async criarCliente(req, res) {
      res.status(201).json({ cliente: await equipeService.criarCliente(validar(clienteNovoSchema, req.body)) });
    },

    async adicionarEndereco(req, res) {
      const { id } = validar(idSchema, req.params);
      const endereco = validar(enderecoNovoSchema, req.body);
      res.status(201).json({ cliente: await equipeService.adicionarEndereco(id, endereco) });
    },

    async cardapio(req, res) {
      const { turnoId } = validar(cardapioSchema, req.query);
      res.json(await equipeService.cardapioDaEquipe({ turnoId }, relogio()));
    },

    async obterTempo(req, res) {
      res.json(await equipeService.obterTempoEstimado(relogio()));
    },

    async definirTempo(req, res) {
      const { minutos } = validar(tempoSchema, req.body ?? {});
      res.json(await equipeService.definirTempoEstimado(minutos, relogio()));
    },
  };
}
