/**
 * Acesso à ponte do preload (window.pdv). Desembrulha `{ ok, dados, erro }`:
 * sucesso devolve os dados; falha lança Error com `codigo` e `status`.
 */
export const pdv = window.pdv;

export async function chamar(promessa) {
  const r = await promessa;
  if (r?.ok) return r.dados;
  const erro = new Error(r?.erro?.mensagem ?? 'Erro inesperado');
  erro.codigo = r?.erro?.codigo ?? 'ERRO';
  erro.status = r?.erro?.status ?? 0;
  erro.detalhes = r?.erro?.detalhes ?? null;
  throw erro;
}
