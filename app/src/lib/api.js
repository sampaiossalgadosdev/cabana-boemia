/**
 * Cliente HTTP da API (adaptado de site/src/lib/api.js). No site a base é
 * relativa (mesmo domínio); no app é absoluta: EXPO_PUBLIC_API_URL (endereço
 * do servidor, sem /api) ou o de produção. Sem React Native aqui: testado no
 * Node com um fetch falso.
 */
export const SERVIDOR_PADRAO = 'https://cabana.managerpix.com.br';

/** Tempo máximo de uma requisição (o fetch do React Native não tem limite próprio). */
export const TEMPO_LIMITE_MS = 15_000;

/**
 * "https://x.com.br/" ou "https://x.com.br/api" → "https://x.com.br/api".
 * Vazio/ausente = produção.
 */
export function baseDaApi(servidor) {
  const limpo = String(servidor ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/, '');
  return `${limpo || SERVIDOR_PADRAO}/api`;
}

// O Expo só troca o valor no build com a escrita literal `process.env.EXPO_PUBLIC_...`.
export const BASE = baseDaApi(process.env.EXPO_PUBLIC_API_URL);

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

/** Sem resposta do servidor (sem internet, DNS, tempo esgotado): não é ErroApi nem cancelamento nosso. */
export const ehErroDeRede = (erro) => Boolean(erro) && !(erro instanceof ErroApi) && erro.name !== 'AbortError';

/**
 * AbortController que cancela no tempo limite OU quando o `signal` de quem
 * chamou cancelar. Tempo esgotado vira TypeError (erro de rede), não AbortError.
 */
function comTempoLimite(signal, ms) {
  const controle = new AbortController();
  let esgotou = false;
  const timer = setTimeout(() => {
    esgotou = true;
    controle.abort();
  }, ms);
  const repassar = () => controle.abort();
  if (signal?.aborted) controle.abort();
  else signal?.addEventListener?.('abort', repassar);
  return {
    signal: controle.signal,
    esgotou: () => esgotou,
    fim: () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', repassar);
    },
  };
}

/**
 * fetch + JSON. Lança ErroApi (status ≠ 2xx) ou o erro de rede.
 * `semCache`: as rotas públicas mandam `Cache-Control: max-age=15`; o cache
 * HTTP do aparelho (NSURLCache no iOS) devolveria o preço antigo numa recarga
 * forçada e a conciliação desfaria o preço novo. Vai `cache: 'no-cache'` e o
 * cabeçalho equivalente (o fetch do RN nem sempre respeita a opção).
 */
export async function requisitar(
  metodo,
  rota,
  { corpo, token, signal, semCache = false, fetch: f = globalThis.fetch, tempoLimiteMs = TEMPO_LIMITE_MS } = {},
) {
  const headers = { accept: 'application/json' };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (semCache) {
    headers['cache-control'] = 'no-cache';
    headers.pragma = 'no-cache';
  }
  const limite = comTempoLimite(signal, tempoLimiteMs);
  let res;
  let texto;
  try {
    res = await f(`${BASE}${rota}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: limite.signal,
      ...(semCache ? { cache: 'no-cache' } : {}),
    });
    texto = await res.text();
  } catch (erro) {
    if (limite.esgotou()) throw new TypeError('Tempo esgotado esperando o servidor');
    throw erro;
  } finally {
    limite.fim();
  }
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
 * GET /publico/cardapio. `forcar`: ignora o cache HTTP (a API acabou de dizer
 * que o cardápio mudou, ou o cliente pediu "Tentar de novo").
 */
export const buscarCardapio = (signal, { forcar = false, fetch } = {}) =>
  requisitar('GET', '/publico/cardapio', { signal, semCache: forcar, fetch });

// ───── Multi-loja: vitrine e rotas por loja (slug) ─────

/** GET /publico/lojas → { lojas: [{ slug, nome, descricao, logoUrl, corPrimaria, corTexto, corFundo, aberta, proximaAbertura }] } */
export const buscarLojas = (signal, { forcar = false, fetch } = {}) => requisitar('GET', '/publico/lojas', { signal, semCache: forcar, fetch });

const daLoja = (slug, rota) => `/publico/lojas/${encodeURIComponent(slug)}/${rota}`;

/** GET /publico/lojas/:slug/cardapio (mesmo formato do /publico/cardapio). */
export const buscarCardapioDaLoja = (slug, signal, { forcar = false, fetch } = {}) =>
  requisitar('GET', daLoja(slug, 'cardapio'), { signal, semCache: forcar, fetch });

/** GET /publico/lojas/:slug/config → { nome, slug, logoUrl, corPrimaria, corTexto, whatsapp, razaoSocial, documento, endereco, freteGratis, ... } */
export const buscarConfigDaLoja = (slug, signal, { forcar = false, fetch } = {}) =>
  requisitar('GET', daLoja(slug, 'config'), { signal, semCache: forcar, fetch });

/** GET /publico/lojas/:slug/bairros → { bairros: [{ id, nome, taxaCentavos }] } (onde a loja entrega) */
export const buscarBairrosDaLoja = (slug) => requisitar('GET', daLoja(slug, 'bairros'));

/** GET /publico/bairros-da-cidade → { bairros: [{ id, nome }] } (endereço vale para qualquer loja) */
export const buscarBairrosDaCidade = () => requisitar('GET', '/publico/bairros-da-cidade');

/** GET /publico/config → { nome, whatsapp, googleClientId, freteGratis } */
export const buscarConfig = () => requisitar('GET', '/publico/config');

/** GET /publico/bairros → { bairros: [{ id, nome, taxaCentavos }] } */
export const buscarBairros = () => requisitar('GET', '/publico/bairros');

/** GET /publico/anuncios → { anuncios: [{ id, anunciante, imagemUrl, destino: { tipo: 'LOJA', slug, nome } | { tipo: 'LINK', url } }] } */
export const buscarAnuncios = (signal, { forcar = false, fetch } = {}) => requisitar('GET', '/publico/anuncios', { signal, semCache: forcar, fetch });

/** GET /publico/app → { plataforma, contato, documentos: { versao, ... } } (tela "Sobre" e aceite dos termos) */
export const buscarDadosDoApp = () => requisitar('GET', '/publico/app');

// ───── Cliente (login, pedidos e perfil entram no próximo passo do app) ─────

/**
 * POST /cliente/auth/google → { token, refreshToken, cliente } (o app sempre pede o refresh).
 * `aceite` = versão dos termos/política marcada na tela de entrada.
 */
export const entrarComGoogle = (credential, { aceite } = {}) =>
  requisitar('POST', '/cliente/auth/google', { corpo: { credential, refresh: true, ...(aceite ? { aceite } : {}) } });

/** POST /cliente/auth/apple → { token, refreshToken, cliente }. `nonce` = o bruto (a Apple recebeu o SHA-256). */
export const entrarComApple = ({ identityToken, nonce, nome, aceite }) =>
  requisitar('POST', '/cliente/auth/apple', {
    corpo: { identityToken, nonce, refresh: true, ...(nome ? { nome } : {}), ...(aceite ? { aceite } : {}) },
  });

/**
 * POST /cliente/auth/telefone/enviar { telefone } → { enviado, telefone, reenviarEmSegundos }.
 * Erros: 400 TELEFONE_INVALIDO, 503 SMS_INDISPONIVEL, 429 AGUARDE_REENVIO | MUITOS_ENVIOS | MUITAS_TENTATIVAS (detalhes.segundos).
 */
export const enviarCodigoTelefone = (telefone) => requisitar('POST', '/cliente/auth/telefone/enviar', { corpo: { telefone } });

/** POST /cliente/auth/telefone/entrar → { token, refreshToken, cliente } (401 CODIGO_INVALIDO; mesma sessão do Google). */
export const entrarComTelefone = ({ telefone, codigo, aceite }) =>
  requisitar('POST', '/cliente/auth/telefone/entrar', { corpo: { telefone, codigo, refresh: true, ...(aceite ? { aceite } : {}) } });

/** POST /cliente/aceite { versao } → { cliente } (409 VERSAO_DESATUALIZADA se a versão mudou) */
export const aceitarTermos = (token, versao) => requisitar('POST', '/cliente/aceite', { token, corpo: { versao } });

/** PUT /cliente/marketing { aceito } → { cliente } (consentimento opcional e revogável) */
export const definirMarketing = (token, aceito) => requisitar('PUT', '/cliente/marketing', { token, corpo: { aceito } });

/** POST /cliente/auth/renovar → { token, refreshToken, cliente } (o refresh usado deixa de valer). */
export const renovarSessao = (refreshToken) => requisitar('POST', '/cliente/auth/renovar', { corpo: { refreshToken } });

/** POST /cliente/auth/sair → 204 (revoga o refresh). */
export const sairDaSessao = (refreshToken) => requisitar('POST', '/cliente/auth/sair', { corpo: { refreshToken } });

/** DELETE /cliente/me → { excluido, pedidosAnonimizados, appleRevogado } */
export const excluirConta = (token, { appleAuthorizationCode } = {}) =>
  requisitar('DELETE', '/cliente/me', { token, corpo: appleAuthorizationCode ? { appleAuthorizationCode } : {} });

/** GET /cliente/me → { cliente } */
export const buscarCliente = (token) => requisitar('GET', '/cliente/me', { token });

/** PUT /cliente/me → { cliente } */
export const salvarPerfil = (token, { nome, telefone }) =>
  requisitar('PUT', '/cliente/me', { token, corpo: { nome, telefone } });

/** GET /cliente/enderecos → { enderecos } */
export const listarEnderecos = (token) => requisitar('GET', '/cliente/enderecos', { token });

/** POST /cliente/enderecos → { endereco } */
export const criarEndereco = (token, dados) => requisitar('POST', '/cliente/enderecos', { token, corpo: dados });

/** PUT /cliente/enderecos/:id → { endereco } */
export const atualizarEndereco = (token, id, dados) =>
  requisitar('PUT', `/cliente/enderecos/${id}`, { token, corpo: dados });

/** DELETE /cliente/enderecos/:id → 204 */
export const removerEndereco = (token, id) => requisitar('DELETE', `/cliente/enderecos/${id}`, { token });

/** POST /cliente/pedidos → { pedido } (201 criado; 200 = mesma chave, pedido já existia) */
export const enviarPedido = (token, corpo) => requisitar('POST', '/cliente/pedidos', { token, corpo });

/** GET /cliente/pedidos/ultimo?lojaSlug → { pedido | null } (o último daquela loja) */
export const buscarUltimoPedido = (token, lojaSlug) =>
  requisitar('GET', `/cliente/pedidos/ultimo${lojaSlug ? `?lojaSlug=${encodeURIComponent(lojaSlug)}` : ''}`, { token });

/** GET /cliente/pedidos → { pedidos, proximo } (mais novo primeiro; `proximo` pagina) */
export const listarPedidos = (token, antesDeId) =>
  requisitar('GET', `/cliente/pedidos${antesDeId ? `?antesDeId=${antesDeId}` : ''}`, { token });
