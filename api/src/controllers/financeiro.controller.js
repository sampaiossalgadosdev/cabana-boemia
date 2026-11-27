/**
 * Livro-razão e fechamento semanal (Etapa 6 de docs/pagamento-online.md).
 * - Loja (DONO; ADMIN com X-Loja): semana atual (parcial), fechamentos e o detalhe.
 * - ADMIN: fechamentos de todas as lojas, quitar (data e observação), ajuste manual
 *   (observação obrigatória) e o resumo da campanha de frete grátis.
 */
import { z } from 'zod';
import { validar } from '../lib/validar.js';
import * as livroRazao from '../services/livroRazao.service.js';

const idSchema = z.object({ id: z.coerce.number().int().positive() });

const dataSchema = z
  .string({ error: 'Informe a data' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Data inválida');

const listarSchema = z.object({
  status: z.enum(['AGUARDANDO_PAGAMENTO', 'QUITADO']).optional(),
  lojaId: z.coerce.number().int().positive().optional(),
});

const quitarSchema = z.object({
  quitadoEm: dataSchema,
  observacao: z.string().trim().max(300, 'Até 300 caracteres').nullish(),
});

const ajusteSchema = z.object({
  lojaId: z.number({ error: 'Escolha a loja' }).int().positive('Escolha a loja'),
  valorCentavos: z
    .number({ error: 'Informe o valor' })
    .int('Valor em centavos')
    .refine((v) => v !== 0, 'O valor não pode ser zero')
    .refine((v) => Math.abs(v) <= livroRazao.AJUSTE_MAX_CENTAVOS, 'Valor alto demais'),
  observacao: z.string({ error: 'Escreva o motivo do ajuste' }).trim().min(3, 'Escreva o motivo do ajuste').max(300, 'Até 300 caracteres'),
  pedidoId: z.number().int().positive().nullish(),
});

/** @param {() => Date} [relogio] */
export function criarFinanceiroController(relogio = () => new Date()) {
  return {
    // ── Loja ──
    async daLoja(req, res) {
      res.json(await livroRazao.fechamentoDaLoja(req.lojaId, relogio()));
    },
    async detalheDaLoja(req, res) {
      const { id } = validar(idSchema, req.params);
      res.json(await livroRazao.detalheDoFechamento(id, { lojaId: req.lojaId }));
    },
    // ── ADMIN ──
    async listar(req, res) {
      res.json(await livroRazao.listarParaAdmin(validar(listarSchema, req.query), relogio()));
    },
    async detalhe(req, res) {
      const { id } = validar(idSchema, req.params);
      res.json(await livroRazao.detalheDoFechamento(id));
    },
    async semanaAtual(req, res) {
      const { id } = validar(idSchema, req.params);
      res.json(await livroRazao.semanaAtualParaAdmin(id, relogio()));
    },
    async quitar(req, res) {
      const { id } = validar(idSchema, req.params);
      const { quitadoEm, observacao } = validar(quitarSchema, req.body ?? {});
      res.json(await livroRazao.quitar(id, { quitadoEm, observacao: observacao ?? null, usuarioId: req.usuario.id }, relogio()));
    },
    async ajuste(req, res) {
      const dados = validar(ajusteSchema, req.body ?? {});
      res.status(201).json(await livroRazao.ajusteManual({ ...dados, pedidoId: dados.pedidoId ?? null, usuarioId: req.usuario.id }, relogio()));
    },
    async campanha(req, res) {
      res.json({ campanha: await livroRazao.resumoCampanha() });
    },
  };
}
