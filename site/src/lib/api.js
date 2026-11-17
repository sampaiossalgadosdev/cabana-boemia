// Rotas da API sob /api. Em produção a API serve esta página (mesmo domínio,
// VITE_API_URL vazio); em dev, o proxy do Vite repassa /api para a API local.
const BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/api`;

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

/**
 * GET /publico/cardapio. Lança em erro de rede ou status ≠ 2xx.
 * `forcar`: ignora o cache HTTP do navegador (a API manda max-age=15). Usado
 * quando a API acabou de dizer que o cardápio mudou: com cache, voltaria o
 * preço antigo e a conciliação desfaria o preço novo.
 */
export async function buscarCardapio(signal, { forcar = false } = {}) {
  const res = await fetch(`${BASE}/publico/cardapio`, { signal, cache: forcar ? 'no-cache' : 'default' });
  if (!res.ok) throw new Error(`Cardápio indisponível (HTTP ${res.status})`);
  return res.json();
}

/** GET /publico/config → { nome, whatsapp, googleClientId, freteGratis } */
export const buscarConfig = () => requisitar('GET', '/publico/config');

/** POST /cliente/auth/google → { token, cliente } */
export const entrarComGoogle = (credential) =>
  requisitar('POST', '/cliente/auth/google', { corpo: { credential } });

/** GET /cliente/me → { cliente } */
export const buscarCliente = (token) => requisitar('GET', '/cliente/me', { token });

/** GET /publico/bairros → { bairros: [{ id, nome, taxaCentavos }] } */
export const buscarBairros = () => requisitar('GET', '/publico/bairros');

/** GET /cliente/enderecos → { enderecos } */
export const listarEnderecos = (token) => requisitar('GET', '/cliente/enderecos', { token });

/** POST /cliente/enderecos → { endereco } */
export const criarEndereco = (token, dados) => requisitar('POST', '/cliente/enderecos', { token, corpo: dados });

/** POST /cliente/pedidos → { pedido } (201 criado; 200 = mesma chave, pedido já existia) */
export const enviarPedido = (token, corpo) => requisitar('POST', '/cliente/pedidos', { token, corpo });

/** GET /cliente/pedidos/ultimo → { pedido | null } */
export const buscarUltimoPedido = (token) => requisitar('GET', '/cliente/pedidos/ultimo', { token });

/** PUT /cliente/me → { cliente } */
export const salvarPerfil = (token, { nome, telefone }) =>
  requisitar('PUT', '/cliente/me', { token, corpo: { nome, telefone } });

/** GET /cliente/pedidos → { pedidos, proximo } (mais novo primeiro; `proximo` pagina) */
export const listarPedidos = (token, antesDeId) =>
  requisitar('GET', `/cliente/pedidos${antesDeId ? `?antesDeId=${antesDeId}` : ''}`, { token });

/** PUT /cliente/enderecos/:id → { endereco } */
export const atualizarEndereco = (token, id, dados) =>
  requisitar('PUT', `/cliente/enderecos/${id}`, { token, corpo: dados });

/** DELETE /cliente/enderecos/:id → 204 */
export const removerEndereco = (token, id) => requisitar('DELETE', `/cliente/enderecos/${id}`, { token });
