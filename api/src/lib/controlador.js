/**
 * Quem é o CONTROLADOR dos dados do app Delivery do Batiá (LGPD), usado nas
 * páginas /privacidade-app e /termos-app. Um lugar só: quando houver empresa,
 * trocar `nome` pela razão social e preencher `documento` com o CNPJ.
 *
 * Agente de tratamento de pequeno porte (Resolução CD/ANPD nº 2/2022): sem
 * encarregado (DPO) nomeado; o canal de contato do titular cumpre essa função.
 */
export const CONTROLADOR = Object.freeze({
  nome: 'João Pedro de Oliveira Sampaio (Delivery do Batiá)',
  /** Ex.: 'CNPJ 00.000.000/0001-00' (null = pessoa física, sem documento publicado). */
  documento: null,
  cidade: 'Abatiá-PR',
  /** true = sem encarregado nomeado (Res. CD/ANPD nº 2/2022). */
  pequenoPorte: true,
});

/**
 * E-mail do canal do titular (pedidos sobre os dados pessoais). Fica no
 * ambiente (CONTATO_TITULAR_EMAIL) para trocar sem mexer no código; vazio =
 * as páginas mostram só o formulário de /excluir-conta.
 * @returns {string | null}
 */
export function emailDoTitular(env = process.env) {
  const email = env.CONTATO_TITULAR_EMAIL?.trim();
  return email || null;
}

/** "Nome (Delivery do Batiá), CNPJ …, Abatiá-PR" */
export function identificacaoDoControlador(c = CONTROLADOR) {
  return [c.nome, c.documento, c.cidade].filter(Boolean).join(', ');
}

/**
 * Versão da política de privacidade e dos termos de uso do app (as duas
 * páginas mudam juntas). Mudou o texto de qualquer uma: trocar `versao` e
 * `vigencia`; quem aceitou a versão anterior precisa aceitar de novo no app
 * (`precisaAceite` do cliente).
 */
export const DOCUMENTOS_APP = Object.freeze({
  versao: '2026-11-20',
  vigencia: '20 de novembro de 2026',
});

/** O cliente precisa aceitar (de novo) os termos e a política do app? */
export const precisaAceite = (termosVersao) => termosVersao !== DOCUMENTOS_APP.versao;

/**
 * GET /publico/app: dados da plataforma para a tela "Sobre" do app e a versão
 * dos documentos (o app manda essa versão no aceite). Caminhos relativos ao
 * servidor (o app junta com o endereço da API).
 */
export function dadosDaPlataforma(email = emailDoTitular(), c = CONTROLADOR) {
  return {
    plataforma: {
      nome: 'Delivery do Batiá',
      responsavel: c.nome,
      documento: c.documento,
      cidade: c.cidade,
      identificacao: identificacaoDoControlador(c),
    },
    contato: { email: email ?? null, formulario: '/excluir-conta' },
    documentos: {
      versao: DOCUMENTOS_APP.versao,
      vigencia: DOCUMENTOS_APP.vigencia,
      privacidade: '/privacidade-app',
      termos: '/termos-app',
      excluirConta: '/excluir-conta',
    },
  };
}
