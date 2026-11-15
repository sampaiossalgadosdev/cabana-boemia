import { ErroHttp } from './erros.js';

/**
 * Valida `dados` com um schema zod. Em caso de erro lança 400 VALIDACAO com
 * a lista `{ campo, mensagem }`.
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} dados
 * @returns {T}
 */
export function validar(schema, dados) {
  const r = schema.safeParse(dados);
  if (r.success) return r.data;
  throw new ErroHttp(400, 'Dados inválidos', {
    codigo: 'VALIDACAO',
    detalhes: r.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
  });
}
