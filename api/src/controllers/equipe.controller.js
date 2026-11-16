import { z } from 'zod';
import { validar } from '../lib/validar.js';
import { horaVirada } from '../services/diaOperacional.service.js';
import * as pedidoService from '../services/pedido.service.js';
import { CANAIS, FORMAS_PAGAMENTO } from '../services/pedido.service.js';
import * as equipeService from '../services/equipe.service.js';
import * as impressaoService from '../services/impressao.service.js';
import * as comandaService from '../services/comanda.service.js';
import * as caixaService from '../services/caixa.service.js';
import { enderecoSchema, itemPedidoSchema, opcional, telefone, trocoSoEmDinheiro } from './esquemas.js';

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

// ───────── Caixa ─────────

/** Teto de sanidade para valores do caixa (R$ 100.000,00). */
const VALOR_MAX_CENTAVOS = 10_000_000;
const centavos = (mensagem, min) =>
  z
    .number({ error: mensagem })
    .int('Use centavos inteiros')
    .min(min, min > 0 ? 'Informe um valor maior que zero' : 'O valor não pode ser negativo')
    .max(VALOR_MAX_CENTAVOS, 'Valor alto demais');

const abrirCaixaSchema = z.object({ valorInicialCentavos: centavos('Informe o valor inicial', 0) });

const movimentoCaixaSchema = z.object({
  tipo: z.enum(caixaService.TIPOS_MOVIMENTO, { error: 'Escolha sangria ou suprimento' }),
  valorCentavos: centavos('Informe o valor', 1),
  motivo: z.string({ error: 'Informe o motivo' }).trim().min(1, 'Informe o motivo').max(140),
});

/** Fechamento cego: só o valor contado (e observação). */
const fecharCaixaSchema = z.object({
  valorContadoCentavos: centavos('Informe o valor contado', 0),
  observacao: opcional(500),
});

// ───────── Comandas do salão ─────────

/** Peso máximo de um prato (gramas): 5 kg já é erro de digitação. */
export const PESO_MAX_GRAMAS = 5000;

const comandaNovaSchema = z.object({
  nomeCliente: z.string({ error: 'Informe o nome do cliente' }).trim().min(1, 'Informe o nome do cliente').max(60),
  mesaRotulo: opcional(10),
});

/** Item da comanda. Sem preço: sai do banco. `pesoGramas` só para produto POR_KG. */
const itemComandaSchema = z.object({
  produtoId: z.number({ error: 'Item inválido' }).int().positive(),
  quantidade: z.number({ error: 'Quantidade inválida' }).int().min(1).max(20).default(1),
  pesoGramas: z
    .number({ error: 'Peso inválido' })
    .int('Use gramas inteiros')
    .min(1, 'Informe o peso')
    .max(PESO_MAX_GRAMAS, `Máximo ${PESO_MAX_GRAMAS} g`)
    .nullish(),
  observacao: opcional(140),
});

const itemIdSchema = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});

const fecharComandaSchema = z.object({
  formaPagamento: z.enum(FORMAS_PAGAMENTO, { error: 'Escolha a forma de pagamento' }),
  imprimirConta: z.boolean().default(false),
});

const falhaSchema = z.object({ erro: z.string().max(2000).optional() });

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

    async caixaAtual(req, res) {
      // horaViradaDia: o PDV usa para saber se o caixa é "de outro dia" (dia operacional).
      const [caixa, horaViradaDia] = await Promise.all([caixaService.caixaAtual(), horaVirada()]);
      res.json({ caixa, horaViradaDia });
    },

    async abrirCaixa(req, res) {
      const dados = validar(abrirCaixaSchema, req.body ?? {});
      res.status(201).json({ caixa: await caixaService.abrirCaixa(dados, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async movimentoCaixa(req, res) {
      const dados = validar(movimentoCaixaSchema, req.body ?? {});
      res.status(201).json({ caixa: await caixaService.registrarMovimento(dados, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async fecharCaixa(req, res) {
      const dados = validar(fecharCaixaSchema, req.body ?? {});
      res.json({ caixa: await caixaService.fecharCaixa(dados, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async listarComandas(req, res) {
      res.json({ comandas: await comandaService.listarAbertas() });
    },

    async obterComanda(req, res) {
      const { id } = validar(idSchema, req.params);
      res.json({ comanda: await comandaService.buscarComanda(id) });
    },

    async abrirComanda(req, res) {
      const dados = validar(comandaNovaSchema, req.body ?? {});
      res.status(201).json({ comanda: await comandaService.abrirComanda(dados, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async lancarItemComanda(req, res) {
      const { id } = validar(idSchema, req.params);
      const item = validar(itemComandaSchema, req.body ?? {});
      res.status(201).json({ comanda: await comandaService.lancarItem(id, item, { usuarioId: req.usuario.id }) });
    },

    async removerItemComanda(req, res) {
      const { id, itemId } = validar(itemIdSchema, req.params);
      res.json({ comanda: await comandaService.removerItem(id, itemId, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async fecharComanda(req, res) {
      const { id } = validar(idSchema, req.params);
      const dados = validar(fecharComandaSchema, req.body ?? {});
      res.json(await comandaService.fecharComanda(id, dados, { agora: relogio() }));
    },

    async impressoesPendentes(req, res) {
      res.json(await impressaoService.listarPendentes(relogio()));
    },

    async confirmarImpressao(req, res) {
      const { id } = validar(idSchema, req.params);
      res.json(await impressaoService.confirmar(id, relogio()));
    },

    async falhaImpressao(req, res) {
      const { id } = validar(idSchema, req.params);
      const { erro } = validar(falhaSchema, req.body ?? {});
      res.json(await impressaoService.registrarFalha(id, erro));
    },

    async reimprimirPedido(req, res) {
      const { id } = validar(idSchema, req.params);
      res.status(201).json({ trabalho: await impressaoService.reimprimir(id) });
    },
  };
}
