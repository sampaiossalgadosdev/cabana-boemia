/**
 * Quem é o CONTROLADOR dos dados do app Delivery Abatiá (LGPD), usado nas
 * páginas /privacidade-app e /termos-app. Um lugar só: quando houver empresa,
 * trocar `nome` pela razão social e preencher `documento` com o CNPJ.
 *
 * Agente de tratamento de pequeno porte (Resolução CD/ANPD nº 2/2022): sem
 * encarregado (DPO) nomeado; o canal de contato do titular cumpre essa função.
 */
export const CONTROLADOR = Object.freeze({
  nome: 'João Pedro de Oliveira Sampaio (Delivery Abatiá)',
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

/** "Nome (Delivery Abatiá), CNPJ …, Abatiá-PR" */
export function identificacaoDoControlador(c = CONTROLADOR) {
  return [c.nome, c.documento, c.cidade].filter(Boolean).join(', ');
}
