/**
 * Dados da plataforma (GET /publico/app): tela "Sobre", links legais e a
 * versão dos termos/política que o cliente aceita. Sem React Native.
 */

/** Usado quando a API não responde (os links legais continuam funcionando). */
export const PLATAFORMA_PADRAO = Object.freeze({
  plataforma: { nome: 'Delivery do Batiá', responsavel: null, documento: null, cidade: 'Abatiá-PR', identificacao: null },
  contato: { email: null, formulario: '/excluir-conta' },
  documentos: { versao: null, vigencia: null, privacidade: '/privacidade-app', termos: '/termos-app', excluirConta: '/excluir-conta' },
});

const caminho = (v, padrao) => (typeof v === 'string' && v.startsWith('/') ? v : padrao);

/** Resposta da API → formato conferido (campo faltando = o padrão). */
export function dadosDaPlataforma(resposta) {
  const r = resposta ?? {};
  const p = PLATAFORMA_PADRAO;
  return {
    plataforma: { ...p.plataforma, ...(r.plataforma ?? {}) },
    contato: {
      email: typeof r.contato?.email === 'string' && r.contato.email.includes('@') ? r.contato.email : null,
      formulario: caminho(r.contato?.formulario, p.contato.formulario),
    },
    documentos: {
      versao: typeof r.documentos?.versao === 'string' ? r.documentos.versao : null,
      vigencia: r.documentos?.vigencia ?? null,
      privacidade: caminho(r.documentos?.privacidade, p.documentos.privacidade),
      termos: caminho(r.documentos?.termos, p.documentos.termos),
      excluirConta: caminho(r.documentos?.excluirConta, p.documentos.excluirConta),
    },
  };
}

/** Logado e sem o aceite da versão atual dos termos/política: o app pede antes de continuar. */
export const precisaAceitar = (status, cliente) => status === 'logado' && Boolean(cliente?.precisaAceite);
