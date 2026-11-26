/**
 * Tela "Pagamentos online" do ADMIN (Etapa 5 de docs/pagamento-online.md, Decisões 2 e 4):
 * lista dos pagamentos, cancelar/estornar com motivo obrigatório e os reembolsos pendentes
 * (tentar de novo ou resolvido por fora, com observação). Sem retentativa automática.
 */
import { z } from 'zod';
import { validar } from '../lib/validar.js';

const idSchema = z.object({ id: z.coerce.number().int().positive() });

const listarSchema = z.object({
  acao: z
    .enum(['sim', 'nao'])
    .optional()
    .transform((v) => v === 'sim'),
  lojaId: z.coerce.number().int().positive().optional(),
  pedidoId: z.coerce.number().int().positive().optional(),
  numeroDia: z.coerce.number().int().positive().optional(),
});

const estornarSchema = z.object({
  // Sem valor = o que ainda não voltou ao cliente (total); com ele = parcial.
  valorCentavos: z.number({ error: 'Valor em centavos' }).int('Valor em centavos').positive('Valor maior que zero').nullish(),
  motivo: z.string({ error: 'Informe o motivo' }).trim().min(3, 'Informe o motivo').max(300),
});

const resolvidoSchema = z.object({
  observacao: z.string({ error: 'Escreva o que foi feito' }).trim().min(3, 'Escreva o que foi feito').max(500),
});

/** @param {object} pagamentos serviço do pagamento online @param {() => Date} [relogio] */
export function criarPagamentosController(pagamentos, relogio = () => new Date()) {
  return {
    async listar(req, res) {
      res.json({ pagamentos: await pagamentos.listarParaAdmin(validar(listarSchema, req.query)) });
    },
    async estornar(req, res) {
      const { id } = validar(idSchema, req.params);
      const { valorCentavos, motivo } = validar(estornarSchema, req.body ?? {});
      res.json(await pagamentos.estornarPeloAdmin(id, { valorCentavos: valorCentavos ?? null, motivo, usuarioId: req.usuario.id, agora: relogio() }));
    },
    async tentarDeNovo(req, res) {
      const { id } = validar(idSchema, req.params);
      res.json(await pagamentos.tentarEstornoDeNovo(id, { usuarioId: req.usuario.id, agora: relogio() }));
    },
    async resolvidoPorFora(req, res) {
      const { id } = validar(idSchema, req.params);
      const { observacao } = validar(resolvidoSchema, req.body ?? {});
      await pagamentos.resolverEstornoPorFora(id, { observacao, usuarioId: req.usuario.id, agora: relogio() });
      res.status(204).end();
    },
  };
}
