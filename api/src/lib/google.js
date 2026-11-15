import { OAuth2Client } from 'google-auth-library';
import { ErroHttp } from './erros.js';

const EMISSORES = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Verificador do ID token do Google Identity Services. Confere assinatura
 * (chaves públicas do Google, em cache pela própria biblioteca), emissor,
 * validade e `aud === clientId`.
 *
 * `obterCertificados` é injetável para os testes assinarem tokens com uma
 * chave própria, sem rede; em produção busca as chaves do Google.
 *
 * @param {{ clientId?: string, obterCertificados?: () => Promise<Record<string, string>> }} [opcoes]
 * @returns {(idToken: string) => Promise<{ googleId: string, email: string | null, nome: string | null }>}
 */
export function criarVerificadorGoogle({
  clientId = process.env.GOOGLE_CLIENT_ID,
  obterCertificados,
} = {}) {
  const client = new OAuth2Client();
  const certificados =
    obterCertificados ?? (async () => (await client.getFederatedSignonCertsAsync()).certs);

  return async function verificarIdTokenGoogle(idToken) {
    // Sem clientId a biblioteca pularia a checagem de audience: nunca verificar assim.
    if (!clientId) {
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
      const ticket = await client.verifySignedJwtWithCertsAsync(idToken, certs, clientId, EMISSORES);
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
