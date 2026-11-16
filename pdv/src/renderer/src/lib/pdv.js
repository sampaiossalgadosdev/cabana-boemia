/**
 * Acesso à ponte do preload (window.pdv). Desembrulha `{ ok, dados, erro }`:
 * sucesso devolve os dados; falha lança Error com `codigo` e `status`.
 */
export const pdv = window.pdv;

/** Disparado em `window` quando a API responde 409 CAIXA_FECHADO (a tela recarrega o caixa). */
export const CAIXA_FECHADO_EVENTO = 'pdv:caixa-fechado';

export async function chamar(promessa) {
  const r = await promessa;
  if (r?.ok) return r.dados;
  const erro = new Error(r?.erro?.mensagem ?? 'Erro inesperado');
  erro.codigo = r?.erro?.codigo ?? 'ERRO';
  erro.status = r?.erro?.status ?? 0;
  erro.detalhes = r?.erro?.detalhes ?? null;
  if (erro.codigo === 'CAIXA_FECHADO') window.dispatchEvent(new Event(CAIXA_FECHADO_EVENTO));
  throw erro;
}
