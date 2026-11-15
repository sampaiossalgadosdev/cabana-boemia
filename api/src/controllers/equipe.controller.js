import { z } from 'zod';
import { validar } from '../lib/validar.js';
import { CANAIS, FORMAS_PAGAMENTO } from '../services/pedido.service.js';
import * as equipeService from '../services/equipe.service.js';

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

    async obterTempo(req, res) {
      res.json(await equipeService.obterTempoEstimado(relogio()));
    },

    async definirTempo(req, res) {
      const { minutos } = validar(tempoSchema, req.body ?? {});
      res.json(await equipeService.definirTempoEstimado(minutos, relogio()));
    },
  };
}
