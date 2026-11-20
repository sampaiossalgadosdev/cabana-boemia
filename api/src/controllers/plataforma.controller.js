import { z } from 'zod';
import { ErroHttp } from '../lib/erros.js';
import { validar } from '../lib/validar.js';
import * as bairroService from '../services/bairro.service.js';
import * as solicitacaoRepo from '../repositories/solicitacaoExclusao.repository.js';

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
