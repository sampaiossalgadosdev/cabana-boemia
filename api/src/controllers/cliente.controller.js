import { z } from 'zod';
import { normalizarTelefone, MENSAGEM_TELEFONE_INVALIDO } from '@restaurante/shared/telefone';
import { validar } from '../lib/validar.js';
import * as clienteService from '../services/cliente.service.js';
import * as enderecoService from '../services/endereco.service.js';

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

/** @param {(idToken: string) => Promise<object>} verificarIdTokenGoogle */
export function criarClienteController(verificarIdTokenGoogle) {
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
  };
}
