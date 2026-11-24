/**
 * Erro do login com Google (@react-native-google-signin) → texto da tela.
 * Sem React Native: os `statusCodes` e o `isErrorWithCode` da biblioteca
 * entram por parâmetro (testado em test/erro-google.test.js).
 *
 * O código do erro vai entre parênteses no texto e no log (`[login-google]`,
 * sai no logcat com a tag ReactNativeJS), para descobrir a causa real pelo
 * celular. DEVELOPER_ERROR (10) = falta o cliente OAuth Android com o pacote e
 * o SHA-1 do app instalado, ou o webClientId está errado (ver CONFIGURACAO_LOGIN.md).
 */

/** Código do erro como texto ("10", "12500", "DEVELOPER_ERROR"...). */
export function codigoDoErroGoogle(erro) {
  return erro?.code != null && erro.code !== '' ? String(erro.code) : 'sem código';
}

/** Linha do log: prefixo, código e mensagem da biblioteca. */
export function linhaDoLogGoogle(erro) {
  return `[login-google] código ${codigoDoErroGoogle(erro)}: ${erro?.message ?? String(erro)}`;
}

/**
 * @param {unknown} erro
 * @param {{ statusCodes?: Record<string, string>, isErrorWithCode?: (e: unknown) => boolean }} biblioteca
 * @returns {{ mensagem: string, cancelado: boolean }}
 */
export function interpretarErroGoogle(erro, { statusCodes = {}, isErrorWithCode } = {}) {
  const codigo = codigoDoErroGoogle(erro);
  if (isErrorWithCode?.(erro)) {
    if (erro.code === statusCodes.SIGN_IN_CANCELLED) return { mensagem: 'Login cancelado.', cancelado: true };
    if (erro.code === statusCodes.IN_PROGRESS) return { mensagem: 'Já existe um login em andamento.', cancelado: true };
    if (erro.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return { mensagem: 'O Google Play Services está desatualizado ou indisponível neste aparelho.', cancelado: false };
    }
    // DEVELOPER_ERROR (10) = SHA-1/package não cadastrados no Google Cloud, ou webClientId errado.
    if (codigo === '10' || codigo === 'DEVELOPER_ERROR') {
      return { mensagem: `Login com Google ainda não configurado para esta versão do app (código ${codigo}).`, cancelado: false };
    }
  }
  return { mensagem: `Não foi possível entrar com o Google. Tente de novo (código ${codigo}).`, cancelado: false };
}
