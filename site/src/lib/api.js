const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Erro HTTP da API: `status` e `codigo` vêm de `{ erro: { mensagem, codigo, detalhes } }`. */
export class ErroApi extends Error {
  constructor(status, { mensagem, codigo, detalhes } = {}) {
    super(mensagem || `Erro ${status}`);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/** fetch + JSON. Lança ErroApi (status ≠ 2xx) ou o erro de rede. */
async function requisitar(metodo, rota, { corpo, token, signal } = {}) {
  const headers = {};
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${rota}`, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal,
  });
  const texto = await res.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    // corpo não-JSON (ex.: proxy fora do ar)
  }
  if (!res.ok) throw new ErroApi(res.status, dados?.erro);
  return dados;
}

/** GET /publico/cardapio. Lança em erro de rede ou status ≠ 2xx. */
export async function buscarCardapio(signal) {
  const res = await fetch(`${BASE}/publico/cardapio`, { signal });
  if (!res.ok) throw new Error(`Cardápio indisponível (HTTP ${res.status})`);
  return res.json();
}

/** GET /publico/config → { nome, whatsapp, googleClientId } */
export const buscarConfig = () => requisitar('GET', '/publico/config');

/** POST /cliente/auth/google → { token, cliente } */
export const entrarComGoogle = (credential) =>
  requisitar('POST', '/cliente/auth/google', { corpo: { credential } });

/** GET /cliente/me → { cliente } */
export const buscarCliente = (token) => requisitar('GET', '/cliente/me', { token });

/** PUT /cliente/me → { cliente } */
export const salvarPerfil = (token, { nome, telefone }) =>
  requisitar('PUT', '/cliente/me', { token, corpo: { nome, telefone } });
