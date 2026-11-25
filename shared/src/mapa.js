/**
 * Pino no mapa e distância: regras puras usadas pela API, pelo app, pela
 * retaguarda e pelo PDV/cupom. Coordenadas em graus decimais (WGS84).
 */

/** Linha reta × este fator = estimativa da distância pelas ruas (quando a rota falha). */
export const FATOR_ESTIMATIVA = 1.3;

/** Raio médio da Terra (m) usado no haversine. */
const RAIO_TERRA_M = 6371008.8;

const ehNumero = (v) => typeof v === 'number' && Number.isFinite(v);

/** `{ latitude, longitude }` com números finitos dentro das faixas (e não o 0,0 de "sem valor"). */
export function pinValido(p) {
  if (!p || !ehNumero(p.latitude) || !ehNumero(p.longitude)) return false;
  if (p.latitude < -90 || p.latitude > 90 || p.longitude < -180 || p.longitude > 180) return false;
  return !(p.latitude === 0 && p.longitude === 0);
}

/** Pino do registro (endereço, loja, pedido) ou null se faltar um dos dois. */
export function pinDe(registro, { lat = 'latitude', lng = 'longitude' } = {}) {
  if (!registro) return null;
  const p = { latitude: registro[lat], longitude: registro[lng] };
  return pinValido(p) ? p : null;
}

/** Distância em linha reta (haversine), em metros (não arredondada). */
export function distanciaEmLinhaReta(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimativa pelas ruas: linha reta × 1,3, em metros inteiros. */
export const distanciaEstimada = (a, b) => Math.round(distanciaEmLinhaReta(a, b) * FATOR_ESTIMATIVA);

/** Coordenada arredondada em 4 casas (~11 m), como inteiro ×10⁴ (chave do cache). */
export const arredondar4 = (grau) => Math.round(grau * 1e4);

/** Link do Google Maps com o pino (no celular abre o app do Maps). */
export function linkDoMapa(p) {
  if (!pinValido(p)) return null;
  const f = (v) => Number(v.toFixed(6)).toString();
  return `https://www.google.com/maps/search/?api=1&query=${f(p.latitude)},${f(p.longitude)}`;
}

/** "850 m", "3,2 km", "13 km" (exibição). */
export function formatarDistancia(metros) {
  if (!Number.isInteger(metros) || metros < 0) return '';
  if (metros < 1000) return `${metros} m`;
  const km = metros / 1000;
  return km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`;
}
