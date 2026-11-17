import { z } from 'zod';
import { validar } from '../lib/validar.js';
import { ErroHttp } from '../lib/erros.js';
import { idSchema } from './esquemas.js';
import * as caixaService from '../services/caixa.service.js';
import * as categoriaService from '../services/categoria.service.js';
import * as produtoService from '../services/produto.service.js';
import * as bairroService from '../services/bairro.service.js';
import * as estoqueService from '../services/estoque.service.js';
import * as configuracaoService from '../services/configuracao.service.js';
import * as turnoService from '../services/turno.service.js';
import * as relatorioService from '../services/relatorio.service.js';

// ───────── Schemas ─────────

const caixasSchema = z.object({
  data: z
    .string()
    .regex(/^(hoje|\d{4}-\d{2}-\d{2})$/, 'Use "hoje" ou AAAA-MM-DD')
    .default('hoje'),
});

const MAX_CENTAVOS = 10_000_000; // R$ 100.000,00
const centavos = (msg) => z.number({ error: msg }).int(msg).min(0, msg).max(MAX_CENTAVOS, msg);
const nome = (max, msg = 'Informe o nome') => z.string({ error: msg }).trim().min(1, msg).max(max);
const ordem = z.number({ error: 'Ordem inválida' }).int('Ordem inválida').min(0).max(9999);
const ativo = z.boolean({ error: 'Ativo deve ser verdadeiro ou falso' });
const quantidadeEstoque = (msg) => z.number({ error: msg }).int(msg).min(0, msg).max(100_000, msg);

/** Pelo menos um campo no PATCH/PUT parcial. */
const naoVazio = (d, ctx) => {
  if (Object.values(d).every((v) => v === undefined)) ctx.addIssue({ code: 'custom', message: 'Nada para alterar' });
};

const categoriaCriarSchema = z.object({ nome: nome(60), ordem: ordem.default(0), ativo: ativo.default(true) });
const categoriaAlterarSchema = z
  .object({ nome: nome(60).optional(), ordem: ordem.optional(), ativo: ativo.optional() })
  .superRefine(naoVazio);

const bairroCriarSchema = z.object({
  nome: nome(80),
  taxaCentavos: centavos('Taxa inválida'),
  ativo: ativo.default(true),
});
const bairroAlterarSchema = z
  .object({ nome: nome(80).optional(), taxaCentavos: centavos('Taxa inválida').optional(), ativo: ativo.optional() })
  .superRefine(naoVazio);

const idsUnicos = (lista, ctx, campo) => {
  if (new Set(lista).size !== lista.length) ctx.addIssue({ code: 'custom', path: [campo], message: 'Item repetido' });
};

/** Formulário completo do produto (POST e PUT). Saldo e disponivelHoje ficam de fora. */
const produtoSchema = z
  .object({
    nome: nome(80),
    descricao: z.string().trim().max(500, 'Descrição muito longa').default(''),
    categoriaId: z.number({ error: 'Escolha a categoria' }).int().positive('Escolha a categoria'),
    tipoPreco: z.enum(['UNIDADE', 'POR_KG'], { error: 'Tipo de preço inválido' }),
    precoCentavos: centavos('Preço inválido'),
    ativo,
    vendidoNoSite: z.boolean().default(true),
    controlaEstoque: z.boolean().default(false),
    estoqueMinimo: quantidadeEstoque('Estoque mínimo inválido').nullable().default(null),
    ordem: ordem.default(0),
    turnoIds: z.array(z.number().int().positive(), { error: 'Turnos inválidos' }).max(10),
    insumos: z
      .array(
        z.object({
          insumoId: z.number({ error: 'Insumo inválido' }).int().positive(),
          quantidade: z.number({ error: 'Quantidade inválida' }).int().min(1, 'Quantidade inválida').max(50),
        }),
      )
      .max(20)
      .default([]),
  })
  .superRefine((d, ctx) => {
    idsUnicos(d.turnoIds, ctx, 'turnoIds');
    idsUnicos(d.insumos.map((i) => i.insumoId), ctx, 'insumos');
  });

const turnoQuerySchema = z.object({ turnoId: z.coerce.number().int().positive().optional() });
const disponivelSchema = z.object({ disponivelHoje: z.boolean({ error: 'Informe verdadeiro ou falso' }) });
const descricaoSchema = z.object({ descricao: z.string({ error: 'Descrição inválida' }).trim().max(500, 'Descrição muito longa') });
const liberarSchema = z.object({ turnoId: z.number({ error: 'Escolha o turno' }).int().positive() });

const hhmm = z.string({ error: 'Horário inválido' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const horariosSchema = z.object({
  horarios: z
    .array(
      z
        .object({
          diaSemana: z.number({ error: 'Dia inválido' }).int().min(0, 'Dia inválido').max(6, 'Dia inválido'),
          inicio: hhmm,
          fim: hhmm,
        })
        .refine((h) => h.inicio !== h.fim, { message: 'Início e fim iguais', path: ['fim'] }),
      { error: 'Horários inválidos' },
    )
    .max(50),
});

const insumoSchema = z.object({
  nome: nome(60),
  estoqueMinimo: quantidadeEstoque('Estoque mínimo inválido').default(0),
});

/** Exatamente um alvo: produto (bebida) ou insumo. */
const alvo = {
  produtoId: z.number().int().positive().optional(),
  insumoId: z.number().int().positive().optional(),
};
const umAlvo = (d, ctx) => {
  if (Boolean(d.produtoId) === Boolean(d.insumoId)) {
    ctx.addIssue({ code: 'custom', path: ['produtoId'], message: 'Informe o produto ou o insumo' });
  }
};
const motivo = (obrigatorio) =>
  obrigatorio
    ? z.string({ error: 'Informe o motivo' }).trim().min(1, 'Informe o motivo').max(200)
    : z
        .string()
        .trim()
        .max(200)
        .nullish()
        .transform((v) => v || null);

const entradaSchema = z
  .object({
    ...alvo,
    quantidade: z.number({ error: 'Quantidade inválida' }).int('Quantidade inválida').min(1, 'Quantidade inválida').max(100_000),
    motivo: motivo(false),
  })
  .superRefine(umAlvo);
const ajusteSchema = z
  .object({ ...alvo, saldoContado: quantidadeEstoque('Saldo contado inválido'), motivo: motivo(true) })
  .superRefine(umAlvo);

const movimentacoesSchema = z.object({
  produtoId: z.coerce.number().int().positive().optional(),
  insumoId: z.coerce.number().int().positive().optional(),
  tipo: z.enum(['VENDA', 'ESTORNO', 'ENTRADA', 'AJUSTE']).optional(),
  antesDeId: z.coerce.number().int().positive().optional(),
});

const configSchema = z.object({
  nomeRestaurante: nome(60, 'Informe o nome do restaurante'),
  whatsappNumero: z.string({ error: 'Informe o WhatsApp' }).transform((v, ctx) => {
    const n = configuracaoService.normalizarWhatsapp(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido: informe DDD e número' });
      return z.NEVER;
    }
    return n;
  }),
  tempoEstimadoPadraoMin: z
    .number({ error: 'Tempo inválido' })
    .int('Use minutos inteiros')
    .min(1, 'Entre 1 e 240 minutos')
    .max(240, 'Entre 1 e 240 minutos'),
  horaViradaDia: z
    .number({ error: 'Hora inválida' })
    .int('Use uma hora cheia')
    .min(0, 'Entre 0 e 12 horas')
    .max(12, 'Entre 0 e 12 horas'),
  // Frete grátis: ausentes = não mexe (cliente antigo). Desligado guarda o
  // mínimo para quando religar; ligado exige mínimo > 0.
  freteGratisAtivo: z.boolean({ error: 'Valor inválido' }).optional(),
  freteGratisMinimoCentavos: z
    .number({ error: 'Valor inválido' })
    .int('Valor inválido')
    .min(1, 'Informe um valor maior que zero')
    .max(MAX_CENTAVOS, 'Valor muito alto')
    .nullable()
    .optional(),
  freteGratisWhatsapp: z.boolean({ error: 'Valor inválido' }).optional(),
}).superRefine((d, ctx) => {
  // Ligado (ou sem dizer, com o banco talvez ligado) exige o mínimo junto.
  if ((d.freteGratisAtivo || (d.freteGratisAtivo === undefined && d.freteGratisMinimoCentavos === null)) && d.freteGratisMinimoCentavos == null) {
    ctx.addIssue({ code: 'custom', path: ['freteGratisMinimoCentavos'], message: 'Informe a partir de quanto o frete é grátis' });
  }
});

const imprimirSchema = z.object({ data: caixasSchema.shape.data });

const alvoDe = (d) => (d.produtoId ? { produtoId: d.produtoId } : { insumoId: d.insumoId });
const id = (req) => validar(idSchema, req.params).id;

/** @param {() => Date} [relogio] fonte do "agora" (injetável nos testes) */
export function criarRetaguardaController(relogio = () => new Date()) {
  return {
    /** Caixas abertos no dia local, com esperado, contado, diferença e totais por forma. */
    async caixas(req, res) {
      const { data } = validar(caixasSchema, req.query);
      res.json(await caixaService.caixasDoDia(data, relogio()));
    },

    // Categorias
    async listarCategorias(req, res) {
      res.json({ categorias: await categoriaService.listar() });
    },
    async criarCategoria(req, res) {
      res.status(201).json({ categoria: await categoriaService.criar(validar(categoriaCriarSchema, req.body)) });
    },
    async alterarCategoria(req, res) {
      const dados = validar(categoriaAlterarSchema, req.body);
      res.json({ categoria: await categoriaService.atualizar(id(req), dados) });
    },

    // Produtos
    async listarProdutos(req, res) {
      res.json({ produtos: await produtoService.listar() });
    },
    async obterProduto(req, res) {
      res.json({ produto: await produtoService.obter(id(req)) });
    },
    async criarProduto(req, res) {
      res.status(201).json({ produto: await produtoService.criar(validar(produtoSchema, req.body)) });
    },
    async alterarProduto(req, res) {
      const dados = validar(produtoSchema, req.body);
      res.json({ produto: await produtoService.atualizar(id(req), dados) });
    },

    // Cardápio do dia
    async cardapioDoDia(req, res) {
      res.json(await produtoService.cardapioDoDia(validar(turnoQuerySchema, req.query), relogio()));
    },
    async definirDisponivelHoje(req, res) {
      const { disponivelHoje } = validar(disponivelSchema, req.body);
      res.json({ produto: await produtoService.definirDisponivelHoje(id(req), disponivelHoje) });
    },
    async definirDescricao(req, res) {
      const { descricao } = validar(descricaoSchema, req.body);
      res.json({ produto: await produtoService.definirDescricao(id(req), descricao) });
    },
    async liberarTudo(req, res) {
      const { turnoId } = validar(liberarSchema, req.body);
      res.json(await produtoService.liberarTudo(turnoId));
    },

    // Turnos
    async listarTurnos(req, res) {
      res.json({ turnos: await turnoService.listarTurnos() });
    },
    async definirHorarios(req, res) {
      const { horarios } = validar(horariosSchema, req.body);
      res.json({ turno: await turnoService.definirHorarios(id(req), horarios) });
    },

    // Bairros
    async listarBairros(req, res) {
      res.json({ bairros: await bairroService.listar() });
    },
    async criarBairro(req, res) {
      res.status(201).json({ bairro: await bairroService.criar(validar(bairroCriarSchema, req.body)) });
    },
    async alterarBairro(req, res) {
      const dados = validar(bairroAlterarSchema, req.body);
      res.json({ bairro: await bairroService.atualizar(id(req), dados) });
    },

    // Estoque
    async estoque(req, res) {
      res.json(await estoqueService.visaoGeral());
    },
    async criarInsumo(req, res) {
      res.status(201).json({ insumo: await estoqueService.criarInsumo(validar(insumoSchema, req.body)) });
    },
    async alterarInsumo(req, res) {
      const dados = validar(insumoSchema, req.body);
      res.json({ insumo: await estoqueService.atualizarInsumo(id(req), dados) });
    },
    async entrada(req, res) {
      const d = validar(entradaSchema, req.body);
      const r = await estoqueService.registrarEntrada(alvoDe(d), d, { usuarioId: req.usuario.id });
      res.status(201).json(r);
    },
    async ajuste(req, res) {
      const d = validar(ajusteSchema, req.body);
      const r = await estoqueService.registrarAjuste(alvoDe(d), d, { usuarioId: req.usuario.id });
      res.status(r.movimentacao ? 201 : 200).json(r);
    },
    async movimentacoes(req, res) {
      const filtro = validar(movimentacoesSchema, req.query);
      if (filtro.produtoId && filtro.insumoId) {
        throw new ErroHttp(400, 'Filtre por produto ou por insumo', { codigo: 'VALIDACAO' });
      }
      res.json(await estoqueService.movimentacoes(filtro));
    },

    // Relatório do dia (operacional)
    async relatorioDia(req, res) {
      const { data } = validar(caixasSchema, req.query);
      res.json(await relatorioService.relatorioDoDia(data, relogio()));
    },
    async imprimirRelatorioDia(req, res) {
      const { data } = validar(imprimirSchema, req.body ?? {});
      res.status(201).json(await relatorioService.imprimirRelatorio(data, relogio()));
    },

    // Configurações
    async obterConfig(req, res) {
      res.json({ config: await configuracaoService.obter() });
    },
    async definirConfig(req, res) {
      res.json({ config: await configuracaoService.atualizar(validar(configSchema, req.body)) });
    },
  };
}
