import { z } from 'zod';
import * as identidadeService from '../services/identidade.service.js';
import * as bairroService from '../services/bairro.service.js';
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

/** Endereço no PDV: o do site + CEP (só dígitos), cidade e estado (opcionais). */
const enderecoNovoSchema = enderecoSchema.omit({ principal: true }).extend({
  cep: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v.replace(/\D/g, '') : null))
    .refine((v) => v == null || v.length === 8, 'CEP com 8 números')
    .transform((v) => v || null),
  cidade: opcional(60),
  estado: opcional(30),
});

const email = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v == null || (v.length <= 120 && z.email().safeParse(v).success), 'E-mail inválido');

const dadosClienteSchema = {
  nome: z.string({ error: 'Informe o nome' }).trim().min(1, 'Informe o nome').max(100),
  telefone,
  email,
  observacao: opcional(300),
};

/** Cadastro rápido: endereço opcional (encomenda retirada no balcão). */
const clienteNovoSchema = z.object({ ...dadosClienteSchema, endereco: enderecoNovoSchema.nullish() });

const clienteEdicaoSchema = z.object(dadosClienteSchema);

const enderecoIdSchema = z.object({
  id: z.coerce.number().int().positive(),
  enderecoId: z.coerce.number().int().positive(),
});

const cardapioSchema = z.object({ turnoId: z.coerce.number().int().positive().optional() });

/** Teto de sanidade para desconto (R$ 10.000,00); o service limita ao subtotal. */
const DESCONTO_MAX_CENTAVOS = 1_000_000;

/**
 * Pedido da equipe (delivery do WhatsApp ou encomenda): o mesmo item do site;
 * cliente e endereço do cadastro. Retirada no balcão (só encomenda) não tem
 * endereço. `taxaEntregaCentavos` ausente/null = taxa do bairro (com frete grátis).
 */
const pedidoWhatsappSchema = z
  .object({
    clienteId: z.number({ error: 'Escolha o cliente' }).int().positive(),
    enderecoId: z.number({ error: 'Escolha o endereço de entrega' }).int().positive().nullish(),
    itens: z.array(itemPedidoSchema, { error: 'Adicione os itens' }).min(1, 'Adicione os itens').max(50),
    formaPagamento: z.enum(FORMAS_PAGAMENTO, { error: 'Escolha a forma de pagamento' }),
    trocoParaCentavos: z.number().int().positive().nullish(),
    chaveIdempotencia: z.uuid().optional(),
    encomenda: z.boolean().default(false),
    agendadoPara: z.iso.datetime({ offset: true, error: 'Informe a data e o horário' }).nullish().transform((v) => (v ? new Date(v) : null)),
    retirarNoBalcao: z.boolean().default(false),
    descontoCentavos: z.number({ error: 'Desconto inválido' }).int('Use centavos inteiros').min(0).max(DESCONTO_MAX_CENTAVOS).default(0),
    taxaEntregaCentavos: z
      .number({ error: 'Taxa inválida' })
      .int('Use centavos inteiros')
      .min(0, 'A taxa não pode ser negativa')
      .max(pedidoService.TAXA_MANUAL_MAX_CENTAVOS, 'Taxa alta demais')
      .nullish()
      .transform((v) => v ?? null),
    observacao: opcional(200),
    pagoAgora: z.boolean().default(false),
  })
  .superRefine(trocoSoEmDinheiro)
  .superRefine((d, ctx) => {
    if (d.encomenda && !d.agendadoPara) {
      ctx.addIssue({ code: 'custom', path: ['agendadoPara'], message: 'Informe a data e o horário da encomenda' });
    }
    if (!d.encomenda && d.agendadoPara) {
      ctx.addIssue({ code: 'custom', path: ['agendadoPara'], message: 'Horário agendado só em encomenda' });
    }
    if (d.retirarNoBalcao && !d.encomenda) {
      ctx.addIssue({ code: 'custom', path: ['retirarNoBalcao'], message: 'Retirada no balcão só em encomenda' });
    }
    if (!d.retirarNoBalcao && !d.enderecoId) {
      ctx.addIssue({ code: 'custom', path: ['enderecoId'], message: 'Escolha o endereço de entrega' });
    }
  });

const statusSchema = z.object({
  status: z.enum(pedidoService.STATUS_ANDAMENTO, { error: 'Status inválido' }),
});

const agendamentoSchema = z.object({
  agendadoPara: z.iso
    .datetime({ offset: true, error: 'Informe a data e o horário' })
    .transform((v) => new Date(v)),
});

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

/** Identificador do agente de impressão (um por computador; gerado pelo PDV). */
const agente = z.string({ error: 'Informe o agente' }).trim().regex(/^[A-Za-z0-9._:-]{1,64}$/, 'Agente inválido');
const falhaSchema = z.object({ erro: z.string().max(2000).optional(), agente });
const confirmarSchema = z.object({ agente });
const reservarSchema = z.object({ agente, limite: z.number().int().min(1).max(50).optional() });

/** Chave de acesso da NFC-e (aceita espaços/pontos); null ou "" = apagar. */
const nfceSchema = z.object({
  chaveNfce: z.union([z.literal('').transform(() => null), z.null(), z.string().max(80)]),
});

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
    /** Bairros onde ESTA loja entrega (área ativa, bairro ativo na cidade), com a taxa dela. */
    async bairros(req, res) {
      res.json({ bairros: await bairroService.listarOndeEntrega(req.lojaId) });
    },
    /** Loja em que o PDV está trabalhando (nome, logo, cor) para o tema e o cupom. */
    async loja(req, res) {
      res.json({ loja: await identidadeService.identidadeDaLoja(req.lojaId) });
    },
    async listarPedidos(req, res) {
      const q = validar(listarSchema, req.query);
      res.json(
        await equipeService.listarPedidosDoDia(
          req.lojaId,
          { dataRef: q.dataRef, canais: q.canal, somenteAbertos: q.status === 'abertos' },
          relogio(),
        ),
      );
    },

    async finalizarPedido(req, res) {
      const { id } = validar(idSchema, req.params);
      const dados = validar(finalizarSchema, req.body ?? {});
      res.json({ pedido: await equipeService.finalizarPedido(req.lojaId, id, dados, relogio()) });
    },

    async alterarStatus(req, res) {
      const { id } = validar(idSchema, req.params);
      const { status } = validar(statusSchema, req.body ?? {});
      res.json({ pedido: await pedidoService.alterarStatus(req.lojaId, id, status) });
    },

    async alterarAgendamento(req, res) {
      const { id } = validar(idSchema, req.params);
      const { agendadoPara } = validar(agendamentoSchema, req.body ?? {});
      res.json({ pedido: await pedidoService.alterarAgendamento(req.lojaId, id, agendadoPara, relogio()) });
    },

    async cancelarPedido(req, res) {
      const { id } = validar(idSchema, req.params);
      res.json({ pedido: await pedidoService.cancelarPedido(req.lojaId, id, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async criarPedido(req, res) {
      const dados = validar(pedidoWhatsappSchema, req.body);
      const { pedido, criado } = await pedidoService.criarPedidoDoWhatsapp(req.lojaId, dados, {
        usuarioId: req.usuario.id,
        agora: relogio(),
      });
      res.status(criado ? 201 : 200).json({ pedido });
    },

    async buscarClientes(req, res) {
      const { busca } = validar(buscaSchema, req.query);
      res.json({ clientes: await equipeService.buscarClientes(req.lojaId, busca) });
    },

    async criarCliente(req, res) {
      res.status(201).json({ cliente: await equipeService.criarCliente(req.lojaId, validar(clienteNovoSchema, req.body)) });
    },

    async atualizarCliente(req, res) {
      const { id } = validar(idSchema, req.params);
      res.json({ cliente: await equipeService.atualizarCliente(req.lojaId, id, validar(clienteEdicaoSchema, req.body ?? {})) });
    },

    async adicionarEndereco(req, res) {
      const { id } = validar(idSchema, req.params);
      const endereco = validar(enderecoNovoSchema, req.body);
      res.status(201).json({ cliente: await equipeService.adicionarEndereco(req.lojaId, id, endereco) });
    },

    async atualizarEndereco(req, res) {
      const { id, enderecoId } = validar(enderecoIdSchema, req.params);
      const endereco = validar(enderecoNovoSchema, req.body ?? {});
      res.json({ cliente: await equipeService.atualizarEndereco(req.lojaId, id, enderecoId, endereco) });
    },

    async cardapio(req, res) {
      const { turnoId } = validar(cardapioSchema, req.query);
      res.json(await equipeService.cardapioDaEquipe(req.lojaId, { turnoId }, relogio()));
    },

    async obterTempo(req, res) {
      res.json(await equipeService.obterTempoEstimado(req.lojaId, relogio()));
    },

    async definirTempo(req, res) {
      const { minutos } = validar(tempoSchema, req.body ?? {});
      res.json(await equipeService.definirTempoEstimado(req.lojaId, minutos, relogio()));
    },

    async caixaAtual(req, res) {
      // horaViradaDia: o PDV usa para saber se o caixa é "de outro dia" (dia operacional).
      const [caixa, horaViradaDia] = await Promise.all([caixaService.caixaAtual(req.lojaId), horaVirada(req.lojaId)]);
      res.json({ caixa, horaViradaDia });
    },

    async abrirCaixa(req, res) {
      const dados = validar(abrirCaixaSchema, req.body ?? {});
      res.status(201).json({ caixa: await caixaService.abrirCaixa(req.lojaId, dados, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async movimentoCaixa(req, res) {
      const dados = validar(movimentoCaixaSchema, req.body ?? {});
      res.status(201).json({ caixa: await caixaService.registrarMovimento(req.lojaId, dados, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async fecharCaixa(req, res) {
      const dados = validar(fecharCaixaSchema, req.body ?? {});
      res.json({ caixa: await caixaService.fecharCaixa(req.lojaId, dados, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async listarComandas(req, res) {
      res.json({ comandas: await comandaService.listarAbertas(req.lojaId) });
    },

    async obterComanda(req, res) {
      const { id } = validar(idSchema, req.params);
      res.json({ comanda: await comandaService.buscarComanda(req.lojaId, id) });
    },

    async abrirComanda(req, res) {
      const dados = validar(comandaNovaSchema, req.body ?? {});
      res.status(201).json({ comanda: await comandaService.abrirComanda(req.lojaId, dados, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async lancarItemComanda(req, res) {
      const { id } = validar(idSchema, req.params);
      const item = validar(itemComandaSchema, req.body ?? {});
      res.status(201).json({ comanda: await comandaService.lancarItem(req.lojaId, id, item, { usuarioId: req.usuario.id }) });
    },

    async removerItemComanda(req, res) {
      const { id, itemId } = validar(itemIdSchema, req.params);
      res.json({ comanda: await comandaService.removerItem(req.lojaId, id, itemId, { usuarioId: req.usuario.id, agora: relogio() }) });
    },

    async fecharComanda(req, res) {
      const { id } = validar(idSchema, req.params);
      const dados = validar(fecharComandaSchema, req.body ?? {});
      res.json(await comandaService.fecharComanda(req.lojaId, id, dados, { agora: relogio() }));
    },

    /** Agente: reserva os pendentes (dois PDVs da loja nunca pegam o mesmo cupom). */
    async reservarImpressoes(req, res) {
      const { agente: id, limite } = validar(reservarSchema, req.body ?? {});
      res.json(await impressaoService.reservarPendentes(req.lojaId, id, relogio(), { limite }));
    },

    async confirmarImpressao(req, res) {
      const { id } = validar(idSchema, req.params);
      const { agente: quem } = validar(confirmarSchema, req.body ?? {});
      res.json(await impressaoService.confirmar(req.lojaId, id, relogio(), { agente: quem }));
    },

    async falhaImpressao(req, res) {
      const { id } = validar(idSchema, req.params);
      const { erro, agente: quem } = validar(falhaSchema, req.body ?? {});
      res.json(await impressaoService.registrarFalha(req.lojaId, id, erro, { agente: quem, agora: relogio() }));
    },

    /** Prova de emissão da NFC-e da venda (chave de 44 números); null apaga. */
    async definirNfce(req, res) {
      const { id } = validar(idSchema, req.params);
      const { chaveNfce } = validar(nfceSchema, req.body ?? {});
      res.json({ pedido: await pedidoService.definirChaveNfce(req.lojaId, id, chaveNfce) });
    },

    async reimprimirPedido(req, res) {
      const { id } = validar(idSchema, req.params);
      res.status(201).json({ trabalho: await impressaoService.reimprimir(req.lojaId, id) });
    },
  };
}
