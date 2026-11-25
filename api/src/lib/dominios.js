/**
 * Domínios do Taaki Delivery x domínio da Cabana Boemia, no mesmo serviço.
 *
 * O servidor atende vários hosts (Custom Domains do Railway). Nos hosts do
 * Taaki (TAAKI_HOSTS) a raiz é a landing da plataforma e o site da Cabana não
 * aparece; nos outros (cabana.managerpix.com.br, o domínio .up.railway.app,
 * localhost) tudo continua como antes. /api, /admin, /api/socket.io e as
 * páginas do app (/privacidade-app, /termos-app, /excluir-conta) valem em
 * todos os hosts.
 */

/** Hosts do Taaki quando TAAKI_HOSTS está vazio ou ausente. */
export const HOSTS_TAAKI_PADRAO = Object.freeze(['taakidelivery.com.br', 'www.taakidelivery.com.br', 'api.taakidelivery.com.br']);

/** Destino de /app quando TAAKI_APP_URL está vazio: a página do app no Google Play. */
export const APP_URL_PADRAO = 'https://play.google.com/store/apps/details?id=br.com.taaki.app';

/** "https://x.com:443/" ou "X.com" → "x.com" (só o nome, minúsculo, sem porta). */
function soHost(valor) {
  return String(valor)
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/:].*$/, '')
    .replace(/\.$/, '');
}

/**
 * TAAKI_HOSTS ("a.com.br,www.a.com.br") → lista de hosts, sem esquema, porta,
 * barra nem repetição. Vazio ou ausente = HOSTS_TAAKI_PADRAO.
 * @returns {string[]}
 */
export function lerHostsTaaki(valor) {
  const hosts = [...new Set(String(valor ?? '').split(',').map(soHost).filter(Boolean))];
  return hosts.length ? hosts : [...HOSTS_TAAKI_PADRAO];
}

/** A requisição veio por um host do Taaki? (`req.hostname` já vem sem porta.) */
export const ehHostTaaki = (req, hosts) => hosts.includes(soHost(req.hostname ?? ''));

/** Só link https vale como destino de /app (outra coisa cai no padrão). */
export const linkHttps = (v) => {
  const t = String(v ?? '').trim();
  return /^https:\/\/\S+$/.test(t) && URL.canParse(t) ? t : null;
};

/**
 * Destinos de /app: TAAKI_APP_URL (todos; vazio = Google Play) e
 * TAAKI_APP_URL_IOS (iPhone/iPad; vazio = o mesmo de todos). Quando houver a
 * App Store ou uma versão web, é só preencher as variáveis.
 * @returns {{ padrao: string, ios: string | null }}
 */
export function lerDestinosDoApp(env = process.env) {
  return { padrao: linkHttps(env.TAAKI_APP_URL) ?? APP_URL_PADRAO, ios: linkHttps(env.TAAKI_APP_URL_IOS) };
}

const IOS = /\b(iPhone|iPad|iPod)\b/;

/** Para onde /app manda este aparelho. */
export function destinoDoApp(userAgent, destinos) {
  return destinos.ios && IOS.test(String(userAgent ?? '')) ? destinos.ios : destinos.padrao;
}

/**
 * Origens aceitas no CORS (HTTP e Socket.IO): as de CORS_ORIGINS mais
 * `https://<host>` de cada host do Taaki. Nada sai de CORS_ORIGINS.
 */
export function origensPermitidas(corsOrigins, hostsTaaki) {
  return [...new Set([...corsOrigins, ...hostsTaaki.map((h) => `https://${h}`)])];
}
