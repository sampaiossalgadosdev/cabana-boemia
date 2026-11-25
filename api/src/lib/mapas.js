/**
 * Google Maps no servidor: Geocoding (texto → pino) e Routes (distância pelas
 * ruas). A chave do servidor (GOOGLE_MAPS_SERVER_KEY) nunca sai daqui: não vai
 * em resposta, log nem erro. `fetch` é injetável (os testes simulam o Google).
 *
 * Limite diário, cache e fallback ficam em services/mapa.service.js.
 */
import { TAXA_KM_PADRAO } from '@restaurante/shared/taxaKm';
import { pinValido } from '@restaurante/shared/mapa';

/** Centro de Abatiá-PR: centro do mapa sem pino e do raio aceito para pinos. */
export const CENTRO_PADRAO = Object.freeze({ latitude: -23.3049, longitude: -50.3133 });
/** Pino mais longe que isso do centro é recusado (lat/lng trocadas, 0,0, outro estado). */
export const RAIO_ACEITO_M = 60_000;
export const LIMITE_GEOCODING_PADRAO = 300;
export const LIMITE_ROTAS_PADRAO = 500;
/** Tempo máximo esperando o Google (a rota do pedido não pode atrasar a compra). */
export const TEMPO_LIMITE_ROTA_MS = 1500;
export const TEMPO_LIMITE_GEOCODING_MS = 5000;

const URL_GEOCODING = 'https://maps.googleapis.com/maps/api/geocode/json';
const URL_ROTAS = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Inteiro >= 0 da variável, ou o padrão (vazio/inválido). */
function inteiro(valor, padrao) {
  const t = String(valor ?? '').trim();
  if (!/^\d+$/.test(t)) return padrao;
  return Number(t);
}

/** "lat,lng" → pino; vazio ou inválido = Abatiá. */
export function lerCentro(valor) {
  const partes = String(valor ?? '').split(',').map((s) => s.trim());
  if (partes.length !== 2 || partes.some((p) => !/^-?\d+(\.\d+)?$/.test(p))) return { ...CENTRO_PADRAO };
  const p = { latitude: Number(partes[0]), longitude: Number(partes[1]) };
  return pinValido(p) ? p : { ...CENTRO_PADRAO };
}

/**
 * Configuração dos mapas a partir do ambiente. Sem a chave do servidor: geocoding
 * desligado (o cliente posiciona o pino à mão) e distância só estimada.
 */
export function lerConfigMapas(env = process.env) {
  return {
    chaveServidor: (env.GOOGLE_MAPS_SERVER_KEY ?? '').trim(),
    chaveWeb: (env.GOOGLE_MAPS_WEB_KEY ?? '').trim(),
    limiteGeocodingDia: inteiro(env.MAPAS_LIMITE_GEOCODING_DIA, LIMITE_GEOCODING_PADRAO),
    limiteRotasDia: inteiro(env.MAPAS_LIMITE_ROTAS_DIA, LIMITE_ROTAS_PADRAO),
    centro: lerCentro(env.MAPAS_CENTRO),
    raioAceitoM: RAIO_ACEITO_M,
    taxaKm: {
      baseCentavos: inteiro(env.TAXA_KM_BASE_CENTAVOS, TAXA_KM_PADRAO.baseCentavos),
      porKmCentavos: inteiro(env.TAXA_KM_POR_KM_CENTAVOS, TAXA_KM_PADRAO.porKmCentavos),
    },
  };
}

/** Falha ao falar com o Google. `motivo`: COTA (o Google recusou por cota/limite) | INDISPONIVEL. */
export class ErroMapa extends Error {
  constructor(motivo, mensagem) {
    super(mensagem);
    this.motivo = motivo;
  }
}

/** fetch com tempo limite (abort). Erro de rede/tempo = INDISPONIVEL. */
async function buscar(fetchFn, url, opcoes, tempoMs) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), tempoMs);
  try {
    return await fetchFn(url, { ...opcoes, signal: controle.signal });
  } catch (err) {
    throw new ErroMapa('INDISPONIVEL', err?.name === 'AbortError' ? 'tempo esgotado' : 'sem resposta');
  } finally {
    clearTimeout(timer);
  }
}

/** Quadrado de ~0,3° em volta do centro: o Geocoding prefere resultados ali. */
const limites = (c) => `${c.latitude - 0.3},${c.longitude - 0.3}|${c.latitude + 0.3},${c.longitude + 0.3}`;

/**
 * @param {{ chave: string, fetch?: typeof fetch }} opcoes
 */
export function criarClienteGoogle({ chave, fetch: fetchFn = globalThis.fetch }) {
  return {
    /**
     * Texto do endereço → `{ latitude, longitude, aproximado }` ou null (não achou).
     * `aproximado` = o Google não achou o número exato (centro da rua, do bairro…).
     */
    async geocodificar(texto, { centro = CENTRO_PADRAO, tempoMs = TEMPO_LIMITE_GEOCODING_MS } = {}) {
      const q = new URLSearchParams({
        address: texto,
        components: 'country:BR',
        region: 'br',
        language: 'pt-BR',
        bounds: limites(centro),
        key: chave,
      });
      const r = await buscar(fetchFn, `${URL_GEOCODING}?${q}`, { method: 'GET' }, tempoMs);
      const corpo = await r.json().catch(() => null);
      const status = corpo?.status;
      if (status === 'ZERO_RESULTS') return null;
      if (status === 'OVER_QUERY_LIMIT' || status === 'OVER_DAILY_LIMIT' || r.status === 429) {
        throw new ErroMapa('COTA', `geocoding: ${status ?? r.status}`);
      }
      if (status !== 'OK') throw new ErroMapa('INDISPONIVEL', `geocoding: ${status ?? r.status}`);
      const res = corpo.results?.[0];
      const loc = res?.geometry?.location;
      const pin = { latitude: loc?.lat, longitude: loc?.lng };
      if (!pinValido(pin)) return null;
      return { ...pin, aproximado: res.partial_match === true || res.geometry.location_type !== 'ROOFTOP' };
    },

    /** Distância de carro pelas ruas (metros), sem trânsito (SKU mais barato). null = sem rota. */
    async distanciaPelasRuas(origem, destino, { tempoMs = TEMPO_LIMITE_ROTA_MS } = {}) {
      const ponto = (p) => ({ location: { latLng: { latitude: p.latitude, longitude: p.longitude } } });
      const r = await buscar(
        fetchFn,
        URL_ROTAS,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': chave,
            'x-goog-fieldmask': 'routes.distanceMeters',
          },
          body: JSON.stringify({ origin: ponto(origem), destination: ponto(destino), travelMode: 'DRIVE', units: 'METRIC' }),
        },
        tempoMs,
      );
      if (r.status === 429) throw new ErroMapa('COTA', 'rotas: 429');
      if (!r.ok) throw new ErroMapa('INDISPONIVEL', `rotas: ${r.status}`);
      const corpo = await r.json().catch(() => null);
      const metros = corpo?.routes?.[0]?.distanceMeters;
      // Mesmo ponto: o Google devolve a rota sem distanceMeters (= 0).
      if (corpo?.routes?.[0] && metros == null) return 0;
      return Number.isInteger(metros) && metros >= 0 ? metros : null;
    },
  };
}
