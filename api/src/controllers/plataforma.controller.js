import { z } from 'zod';
import { ErroHttp } from '../lib/erros.js';
import { validar } from '../lib/validar.js';
import * as bairroService from '../services/bairro.service.js';
import * as solicitacaoRepo from '../repositories/solicitacaoExclusao.repository.js';
import * as lojaService from '../services/loja.service.js';
import * as usuarioService from '../services/usuario.service.js';
import { normalizarWhatsapp } from '../services/configuracao.service.js';
import * as identidadeService from '../services/identidade.service.js';
import * as anuncioService from '../services/anuncio.service.js';
import * as alertaService from '../services/alerta.service.js';
import { normalizarCpfCnpj } from '../lib/documento.js';
import { avaliarCor } from '@restaurante/shared/cores';

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const nomeBairro = z.string({ error: 'Informe o nome' }).trim().min(1, 'Informe o nome').max(80);
const ativo = z.boolean({ error: 'Ativo deve ser verdadeiro ou falso' });
const bairroCriarSchema = z.object({ nome: nomeBairro, ativo: ativo.default(true) });
const bairroAlterarSchema = z
  .object({ nome: nomeBairro.optional(), ativo: ativo.optional() })
  .refine((d) => Object.keys(d).length > 0, 'Nada para alterar');

/** Bairros da cidade: a lista única que todas as lojas usam. */
export async function listarBairros(req, res) {
  res.json({ bairros: await bairroService.listarCidade() });
}

export async function criarBairro(req, res) {
  res.status(201).json({ bairro: await bairroService.criarCidade(validar(bairroCriarSchema, req.body)) });
}

export async function alterarBairro(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json({ bairro: await bairroService.atualizarCidade(id, validar(bairroAlterarSchema, req.body ?? {})) });
}

/** Pedidos de exclusão de conta da página pública /excluir-conta. */
export async function listarSolicitacoesExclusao(req, res) {
  res.json(await solicitacaoRepo.listar());
}

// ───────── Alertas para o ADMIN ─────────

export async function listarAlertas(req, res) {
  res.json(await alertaService.listar());
}

/** Contador do menu da plataforma. */
export async function contarAlertas(req, res) {
  res.json({ abertos: await alertaService.contarAbertos() });
}

export async function resolverAlerta(req, res) {
  const { id } = validar(idSchema, req.params);
  await alertaService.resolver(id, req.usuario.id);
  res.status(204).end();
}

export async function marcarSolicitacaoAtendida(req, res) {
  const { id } = validar(idSchema, req.params);
  if (!(await solicitacaoRepo.marcarAtendida(id))) {
    throw new ErroHttp(404, 'Solicitação não encontrada ou já atendida', { codigo: 'NAO_ENCONTRADO' });
  }
  res.status(204).end();
}

// ───────── Lojas ─────────

const vazioParaNull = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const cor = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v == null || /^#[0-9A-Fa-f]{6}$/.test(v), 'Use a cor no formato #RRGGBB');

/** Cor primária (e a padrão): formato e contraste (texto legível por cima, visível na base clara). */
const corLegivel = cor.superRefine((v, ctx) => {
  if (v == null) return;
  const a = avaliarCor(v);
  if (!a.ok) ctx.addIssue({ code: 'custom', message: a.motivo });
}).transform((v) => (v == null ? null : avaliarCor(v).cor));

/** Link https ou imagem enviada (/api/publico/imagens/:id). */
const logo = vazioParaNull(500).refine(
  (v) => v == null || identidadeService.ehImagemPropria(v) || (/^https:\/\/\S+$/.test(v) && URL.canParse(v)),
  'Use um link que comece com https:// ou envie a imagem',
);

const camposLoja = {
  slug: z
    .string({ error: 'Informe o endereço (slug)' })
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífen (ex.: lanchonete-do-ze)')
    .max(60),
  nome: z.string({ error: 'Informe o nome' }).trim().min(1, 'Informe o nome').max(100),
  razaoSocial: vazioParaNull(150),
  documento: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v.replace(/\D/g, '') : null))
    .refine((v) => v == null || v.length === 11 || v.length === 14, 'CPF com 11 ou CNPJ com 14 números'),
  endereco: vazioParaNull(200),
  whatsapp: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || '')
    .transform((v, ctx) => {
      if (!v) return '';
      const n = normalizarWhatsapp(v);
      if (!n) ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido (DDD + número)' });
      return n ?? '';
    }),
  logoUrl: logo,
  logoUrlPadrao: logo,
  corPrimaria: corLegivel,
  corPrimariaPadrao: corLegivel,
  corFundo: cor,
  descricao: vazioParaNull(500),
  ativa: z.boolean({ error: 'Ativa deve ser verdadeiro ou falso' }),
  ordem: z.number({ error: 'Ordem inválida' }).int().min(0).max(9999),
  // Pino da loja (os dois juntos; null = apaga): conferido no service (raio da cidade).
  latitude: z.number({ error: 'Posição inválida' }).min(-90).max(90).nullish(),
  longitude: z.number({ error: 'Posição inválida' }).min(-180).max(180).nullish(),
};

const lojaCriarSchema = z.object({
  ...camposLoja,
  ativa: camposLoja.ativa.default(true),
  ordem: camposLoja.ordem.default(0),
  // Turnos iniciais (só os nomes; os horários o dono define em "Turnos e horários").
  turnos: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

const lojaEditarSchema = z
  .object(Object.fromEntries(Object.entries(camposLoja).map(([k, v]) => [k, v.optional()])))
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Nada para alterar');

const donoSchema = z.object({
  nome: z.string({ error: 'Informe o nome' }).trim().min(1, 'Informe o nome').max(100),
  email: z.email('Email inválido'),
  senha: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(72, 'A senha pode ter no máximo 72 caracteres'),
});

export async function listarLojas(req, res) {
  res.json({ lojas: await lojaService.listarParaPlataforma() });
}

export async function criarLoja(req, res) {
  const { turnos, ...dados } = validar(lojaCriarSchema, req.body ?? {});
  res.status(201).json({ loja: await lojaService.criarLoja(dados, turnos) });
}

export async function editarLoja(req, res) {
  const { id } = validar(idSchema, req.params);
  const dados = Object.fromEntries(Object.entries(validar(lojaEditarSchema, req.body ?? {})).filter(([, v]) => v !== undefined));
  res.json({ loja: await lojaService.editarLoja(id, dados) });
}

/** Cria o usuário DONO da loja (o dono cria os atendentes na retaguarda). */
/** Logo PADRÃO da loja (corpo = o arquivo PNG/JPEG/WebP). Sem personalização do dono, a atual acompanha. */
export async function definirLogoPadrao(req, res) {
  const { id } = validar(idSchema, req.params);
  await identidadeService.definirLogoPadrao(id, req.body);
  res.json({ loja: (await lojaService.listarParaPlataforma()).find((l) => l.id === id) });
}

export async function criarDono(req, res) {
  const { id } = validar(idSchema, req.params);
  await lojaService.buscar(id);
  res.status(201).json({ usuario: await usuarioService.criarDono({ ...validar(donoSchema, req.body ?? {}), lojaId: id }) });
}

// ───────── Anúncios (carrossel "Patrocinado" do app) ─────────

const dataHora = (rotulo) =>
  z.iso.datetime({ offset: true, error: `${rotulo}: data e hora inválidas` }).transform((v) => new Date(v));

const camposAnuncio = {
  anuncianteNome: z.string({ error: 'Informe o anunciante' }).trim().min(1, 'Informe o anunciante').max(150),
  anuncianteDocumento: z.string({ error: 'Informe o CPF ou CNPJ do anunciante' }).transform((v, ctx) => {
    const d = normalizarCpfCnpj(v);
    if (!d) ctx.addIssue({ code: 'custom', message: 'CPF ou CNPJ inválido' });
    return d ?? '';
  }),
  imagemId: z.number({ error: 'Envie a imagem' }).int().positive(),
  destino: z.enum(['LOJA', 'LINK'], { error: 'Escolha o destino: loja do app ou link' }),
  destinoLojaId: z.number().int().positive().nullish(),
  destinoUrl: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v == null || (/^https:\/\/\S+$/.test(v) && URL.canParse(v)), 'Use um link que comece com https://'),
  inicio: dataHora('Início'),
  fim: dataHora('Fim'),
  valorPagoCentavos: z.number({ error: 'Informe o valor pago' }).int().min(0, 'Valor inválido').max(100_000_000),
  ativo: z.boolean({ error: 'Ativo deve ser verdadeiro ou falso' }),
  ordem: z.number({ error: 'Ordem inválida' }).int().min(0).max(9999),
};

const anuncioCriarSchema = z.object({
  ...camposAnuncio,
  ativo: camposAnuncio.ativo.default(true),
  ordem: camposAnuncio.ordem.default(0),
  // Declaração obrigatória (CDC art. 37 § 2º; Resolução Conanda 163/2014).
  naoDirigidoACriancas: z.literal(true, { error: 'Confirme que o anúncio não é dirigido a crianças' }),
});

const anuncioAlterarSchema = z
  .object(Object.fromEntries(Object.entries(camposAnuncio).map(([k, v]) => [k, v.optional()])))
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Nada para alterar');

/** Anúncios (só ADMIN). Sem excluir: desativar tira do ar e mantém o registro. */
export function criarAnunciosController(relogio = () => new Date()) {
  return {
    async listar(req, res) {
      res.json({ anuncios: await anuncioService.listarParaPlataforma(relogio()) });
    },
    async enviarImagem(req, res) {
      res.status(201).json(await anuncioService.enviarImagem(req.body, relogio()));
    },
    async criar(req, res) {
      const dados = validar(anuncioCriarSchema, req.body ?? {});
      res.status(201).json({ anuncio: await anuncioService.criar(dados, req.usuario.id, relogio()) });
    },
    async alterar(req, res) {
      const { id } = validar(idSchema, req.params);
      const dados = Object.fromEntries(Object.entries(validar(anuncioAlterarSchema, req.body ?? {})).filter(([, v]) => v !== undefined));
      res.json({ anuncio: await anuncioService.alterar(id, dados, relogio()) });
    },
  };
}
