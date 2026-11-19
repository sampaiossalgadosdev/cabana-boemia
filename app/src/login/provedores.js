/**
 * Login nativo: Google (Android e iOS) e Apple (só iOS). Os módulos nativos
 * são carregados sob demanda: no Expo Go o do Google não existe (exige
 * development build), e o app mostra um aviso em vez de quebrar.
 *
 * Os dois devolvem o que a API precisa; quem fala com a API é o estado do
 * cliente (src/estado/Cliente.js).
 */
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';

/** Erro que a tela mostra como texto (não é falha do app). */
export class ErroLogin extends Error {
  constructor(mensagem, { cancelado = false } = {}) {
    super(mensagem);
    this.name = 'ErroLogin';
    this.cancelado = cancelado;
  }
}

const SEM_MODULO = 'Este login precisa do app instalado (development build ou loja); no Expo Go ele não funciona.';

function moduloGoogle() {
  try {
    return require('@react-native-google-signin/google-signin');
  } catch {
    return null;
  }
}

function moduloApple() {
  try {
    return require('expo-apple-authentication');
  } catch {
    return null;
  }
}

let configurado = null;

/**
 * Login com Google. `webClientId` = o cliente OAuth "Aplicativo da Web" (o
 * mesmo do site, vindo de GET /publico/config): o ID token sai com esse
 * `aud`, que a API já aceita. No iOS, `iosClientId` vem do build
 * (EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID). No Android, quem libera o app é o
 * cliente OAuth "Android" com o SHA-1 do certificado (ver CONFIGURACAO_LOGIN.md).
 * @returns {Promise<{ idToken: string }>}
 */
export async function entrarComGoogle(webClientId) {
  const m = moduloGoogle();
  if (!m?.GoogleSignin) throw new ErroLogin(SEM_MODULO);
  const { GoogleSignin, statusCodes, isErrorWithCode } = m;
  if (!webClientId) throw new ErroLogin('Login com Google indisponível no momento. Tente mais tarde.');
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined;
  if (configurado !== webClientId) {
    GoogleSignin.configure({ webClientId, iosClientId, scopes: ['email', 'profile'] });
    configurado = webClientId;
  }
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const r = await GoogleSignin.signIn();
    if (r?.type !== 'success') throw new ErroLogin('Login cancelado.', { cancelado: true });
    const idToken = r.data?.idToken;
    if (!idToken) throw new ErroLogin('O Google não devolveu a identificação. Tente de novo.');
    return { idToken };
  } catch (erro) {
    if (erro instanceof ErroLogin) throw erro;
    if (isErrorWithCode?.(erro)) {
      if (erro.code === statusCodes.SIGN_IN_CANCELLED) throw new ErroLogin('Login cancelado.', { cancelado: true });
      if (erro.code === statusCodes.IN_PROGRESS) throw new ErroLogin('Já existe um login em andamento.', { cancelado: true });
      if (erro.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new ErroLogin('O Google Play Services está desatualizado ou indisponível neste aparelho.');
      }
      // DEVELOPER_ERROR (10) = SHA-1/package não cadastrados no Google Cloud.
      if (String(erro.code) === '10' || erro.code === 'DEVELOPER_ERROR') {
        throw new ErroLogin('Login com Google ainda não configurado para esta versão do app.');
      }
    }
    throw new ErroLogin('Não foi possível entrar com o Google. Tente de novo.');
  }
}

/** Sai da conta Google no aparelho (o próximo login pergunta a conta de novo). Nunca lança. */
export async function sairDoGoogle({ revogar = false } = {}) {
  const g = moduloGoogle()?.GoogleSignin;
  try {
    if (revogar) await g?.revokeAccess();
    await g?.signOut();
  } catch {
    // sem sessão do Google no aparelho
  }
}

/** "Entrar com Apple" só aparece no iOS com o recurso disponível. */
export async function appleDisponivel() {
  if (Platform.OS !== 'ios') return false;
  try {
    return Boolean(await moduloApple()?.isAvailableAsync());
  } catch {
    return false;
  }
}

/**
 * Entrar com Apple. O nonce bruto vai para a API; a Apple recebe o SHA-256
 * dele (vem dentro do identity token e a API confere). O nome só vem no
 * primeiro login.
 * @returns {Promise<{ identityToken: string, nonce: string, nome: string | null, authorizationCode: string | null }>}
 */
export async function entrarComApple() {
  const A = moduloApple();
  if (!A?.signInAsync) throw new ErroLogin(SEM_MODULO);
  const nonce = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/g, '');
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const c = await A.signInAsync({
      requestedScopes: [A.AppleAuthenticationScope.FULL_NAME, A.AppleAuthenticationScope.EMAIL],
      nonce: hash,
    });
    if (!c.identityToken) throw new ErroLogin('A Apple não devolveu a identificação. Tente de novo.');
    const nome = [c.fullName?.givenName, c.fullName?.familyName].filter(Boolean).join(' ').trim() || null;
    return { identityToken: c.identityToken, nonce, nome, authorizationCode: c.authorizationCode ?? null };
  } catch (erro) {
    if (erro instanceof ErroLogin) throw erro;
    if (erro?.code === 'ERR_REQUEST_CANCELED') throw new ErroLogin('Login cancelado.', { cancelado: true });
    throw new ErroLogin('Não foi possível entrar com a Apple. Tente de novo.');
  }
}

/**
 * Código novo da Apple para a API revogar o login ao excluir a conta
 * (exigência da App Store). Cancelado ou indisponível = null (a conta é
 * excluída do mesmo jeito).
 */
export async function codigoAppleParaExclusao() {
  try {
    return (await entrarComApple()).authorizationCode;
  } catch {
    return null;
  }
}
