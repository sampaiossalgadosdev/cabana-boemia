import { z } from 'zod';
import { ErroHttp } from '../lib/erros.js';
import { validar } from '../lib/validar.js';
import * as bairroService from '../services/bairro.service.js';
import * as solicitacaoRepo from '../repositories/solicitacaoExclusao.repository.js';
import * as lojaService from '../services/loja.service.js';
import * as usuarioService from '../services/usuario.service.js';
import { normalizarWhatsapp } from '../services/configuracao.service.js';

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
  logoUrl: vazioParaNull(500).refine((v) => v == null || (/^https:\/\/\S+$/.test(v) && URL.canParse(v)), 'Use um link que comece com https://'),
  corPrimaria: cor,
  corFundo: cor,
  descricao: vazioParaNull(500),
  ativa: z.boolean({ error: 'Ativa deve ser verdadeiro ou falso' }),
  ordem: z.number({ error: 'Ordem inválida' }).int().min(0).max(9999),
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
export async function criarDono(req, res) {
  const { id } = validar(idSchema, req.params);
  await lojaService.buscar(id);
  res.status(201).json({ usuario: await usuarioService.criarDono({ ...validar(donoSchema, req.body ?? {}), lojaId: id }) });
}
