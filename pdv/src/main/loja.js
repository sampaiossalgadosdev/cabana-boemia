/**
 * Loja em que este PDV trabalha (processo main; sem electron, testável).
 *
 * - DONO e ATENDENTE: a loja do cadastro (a API sabe; o PDV não manda X-Loja).
 * - ADMIN: escolhe a loja depois do login; o slug vai no cabeçalho X-Loja de
 *   toda requisição e em `auth.loja` do socket. Fica guardado no config.json
 *   (abre na mesma loja da próxima vez).
 * A identidade (nome, logo, cor) monta o tema e o título; a logo é baixada
 * aqui e vai para o renderer como `data:` (a CSP do renderer só libera 'self'
 * e data:, nunca o servidor).
 */

const MAX_LOGO_BYTES = 600 * 1024;
const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * @param {{
 *   servidor: () => string | null,
 *   fetch?: typeof fetch,
 * }} opcoes
 */
export function criarEstadoLoja({ servidor, fetch = globalThis.fetch }) {
  let papel = null;
  let slugEscolhido = null; // só ADMIN
  let identidade = null;
  const logos = new Map(); // url → data:

  /** Logo como data: URL (null se não houver ou falhar: o renderer mostra o nome). */
  async function logoComoDataUrl(url) {
    if (!url) return null;
    if (logos.has(url)) return logos.get(url);
    let absoluta;
    try {
      absoluta = new URL(url, `${servidor()}/`).toString();
    } catch {
      return null;
    }
    if (!/^https?:\/\//.test(absoluta)) return null;
    try {
      const res = await fetch(absoluta, { signal: AbortSignal.timeout(10_000) });
      const tipo = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!res.ok || !TIPOS_LOGO.includes(tipo)) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) return null;
      const dataUrl = `data:${tipo};base64,${bytes.toString('base64')}`;
      logos.set(url, dataUrl);
      return dataUrl;
    } catch {
      return null;
    }
  }

  return {
    /** Valor do X-Loja / auth.loja: só para o ADMIN (DONO e ATENDENTE não mandam). */
    informada: () => (papel === 'ADMIN' ? slugEscolhido : null),
    ehAdmin: () => papel === 'ADMIN',
    identidade: () => identidade,
    /** Precisa escolher a loja antes de trabalhar (ADMIN sem loja). */
    precisaEscolher: () => papel === 'ADMIN' && !slugEscolhido,

    /** Depois do login: o papel do usuário e, para o ADMIN, a loja lembrada. */
    iniciar(usuario, slugLembrado = null) {
      papel = usuario?.papel ?? null;
      slugEscolhido = papel === 'ADMIN' ? slugLembrado || null : null;
      identidade = null;
    },
    escolher(slug) {
      slugEscolhido = slug || null;
      identidade = null;
    },
    /** Grava a identidade que a API devolveu (GET /equipe/loja) com a logo em data:. */
    async definirIdentidade(loja) {
      if (!loja) {
        identidade = null;
        return null;
      }
      identidade = { ...loja, logoDataUrl: await logoComoDataUrl(loja.logoUrl) };
      return identidade;
    },
    limpar() {
      papel = null;
      slugEscolhido = null;
      identidade = null;
    },
  };
}
