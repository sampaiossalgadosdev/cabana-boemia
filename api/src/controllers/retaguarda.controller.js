import { z } from 'zod';
import { validar } from '../lib/validar.js';
import * as caixaService from '../services/caixa.service.js';

const caixasSchema = z.object({
  data: z
    .string()
    .regex(/^(hoje|\d{4}-\d{2}-\d{2})$/, 'Use "hoje" ou AAAA-MM-DD')
    .default('hoje'),
});

/** @param {() => Date} [relogio] fonte do "agora" (injetável nos testes) */
export function criarRetaguardaController(relogio = () => new Date()) {
  return {
    /** Caixas abertos no dia local, com esperado, contado, diferença e totais por forma. */
    async caixas(req, res) {
      const { data } = validar(caixasSchema, req.query);
      res.json(await caixaService.caixasDoDia(data, relogio()));
    },
  };
}
