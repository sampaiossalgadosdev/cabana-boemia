import { OAuth2Client } from 'google-auth-library';
import { ErroHttp } from './erros.js';

const EMISSORES = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Audiences aceitas no ID token do Google: GOOGLE_CLIENT_ID (cliente "Aplicativo
 * da Web" do site, como sempre) + GOOGLE_CLIENT_IDS (lista separada por
 * vírgula: clientes Android/iOS do app). Sem repetição, sem itens vazios.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function audiencesGoogle(env = process.env) {
  const lista = [env.GOOGLE_CLIENT_ID, ...(env.GOOGLE_CLIENT_IDS ?? '').split(',')]
    .map((id) => id?.trim())
    .filter(Boolean);
  return [...new Set(lista)];
}

/**
 * Verificador do ID token do Google (site: Google Identity Services; app:
 * Google Sign-In nativo). Confere assinatura (chaves públicas do Google, em
 * cache pela própria biblioteca), emissor, validade e `aud` ∈ audiences.
 *
 * `obterCertificados` é injetável para os testes assinarem tokens com uma
 * chave própria, sem rede; em produção busca as chaves do Google.
 *
 * @param {{ clientId?: string, clientIds?: string[], obterCertificados?: () => Promise<Record<string, string>> }} [opcoes]
 *   `clientId` (um só) continua aceito por compatibilidade; `clientIds` tem precedência.
 * @returns {(idToken: string) => Promise<{ googleId: string, email: string | null, nome: string | null }>}
 */
export function criarVerificadorGoogle({ clientId, clientIds, obterCertificados } = {}) {
  // `clientId` passado (mesmo vazio) vale como antes; sem nenhum dos dois, lê o ambiente.
  const audiences = (clientIds ?? (clientId !== undefined ? [clientId] : audiencesGoogle())).filter(Boolean);
  const client = new OAuth2Client();
  const certificados =
    obterCertificados ?? (async () => (await client.getFederatedSignonCertsAsync()).certs);

  return async function verificarIdTokenGoogle(idToken) {
    // Sem audience a biblioteca pularia a checagem: nunca verificar assim.
    if (!audiences.length) {
      throw new ErroHttp(503, 'Login com Google indisponível no momento', {
        codigo: 'GOOGLE_NAO_CONFIGURADO',
      });
    }

    let certs;
    try {
      certs = await certificados();
    } catch {
      throw new ErroHttp(503, 'Não foi possível falar com o Google. Tente de novo.', {
        codigo: 'GOOGLE_INDISPONIVEL',
      });
    }

    let payload = null;
    try {
      const ticket = await client.verifySignedJwtWithCertsAsync(idToken, certs, audiences, EMISSORES);
      payload = ticket.getPayload();
    } catch {
      // A mensagem da biblioteca contém o token: não repassar nem logar.
    }
    if (!payload?.sub) {
      throw new ErroHttp(401, 'Login com Google inválido. Tente entrar de novo.', {
        codigo: 'TOKEN_GOOGLE_INVALIDO',
      });
    }

    return {
      googleId: payload.sub,
      email: payload.email && payload.email_verified ? payload.email.toLowerCase() : null,
      nome: payload.name?.trim() || null,
    };
  };
}
