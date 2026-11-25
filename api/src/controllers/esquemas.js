/** Schemas zod compartilhados entre o site (cliente) e a equipe (PDV). */
import { z } from 'zod';
import { normalizarTelefone, MENSAGEM_TELEFONE_INVALIDO } from '@restaurante/shared/telefone';

/** Celular brasileiro (DDD + 9 dígitos); sai só com números. */
export const telefone = z.string({ error: MENSAGEM_TELEFONE_INVALIDO }).transform((v, ctx) => {
  const n = normalizarTelefone(v);
  if (!n) {
    ctx.addIssue({ code: 'custom', message: MENSAGEM_TELEFONE_INVALIDO });
    return z.NEVER;
  }
  return n;
});

/** Texto opcional: vazio ou ausente vira null. */
export const opcional = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const enderecoSchema = z.object({
  rua: z.string({ error: 'Informe a rua' }).trim().min(1, 'Informe a rua').max(120),
  numero: z.string({ error: 'Informe o número' }).trim().min(1, 'Informe o número').max(20),
  complemento: opcional(120),
  referencia: opcional(200),
  bairroId: z.number({ error: 'Escolha o bairro' }).int().positive(),
  principal: z.boolean().optional(),
  // Pino no mapa (opcional): os dois juntos (conferido no service). Ausente no PUT = não mexe,
  // a não ser que rua, número ou bairro mudem (aí o pino antigo é apagado); null = apaga.
  latitude: z.number({ error: 'Posição inválida' }).min(-90).max(90).nullish(),
  longitude: z.number({ error: 'Posição inválida' }).min(-180).max(180).nullish(),
});

export const idSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Item de pedido. Só produtoId, quantidade e observação: qualquer outro campo
 * (ex.: precoCentavos) é descartado pelo zod e o preço sai do banco.
 */
export const itemPedidoSchema = z.object({
  produtoId: z.number({ error: 'Item inválido' }).int().positive(),
  quantidade: z.number({ error: 'Quantidade inválida' }).int().min(1).max(20),
  observacao: opcional(140),
});

/** Troco só faz sentido em dinheiro (o "maior que o total" é conferido no service). */
export function trocoSoEmDinheiro(d, ctx) {
  if (d.trocoParaCentavos != null && d.formaPagamento !== 'DINHEIRO') {
    ctx.addIssue({ code: 'custom', path: ['trocoParaCentavos'], message: 'Troco só para pagamento em dinheiro' });
  }
}
