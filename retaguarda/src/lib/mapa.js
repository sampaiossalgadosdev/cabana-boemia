/**
 * Pino da loja na retaguarda: regras puras (testadas). O mapa em si é o
 * Google Maps JavaScript (componentes/MapaPino.jsx); a busca vai pelo servidor.
 */
import { pinValido } from '@restaurante/shared/mapa';

/** Mensagem da busca no mapa conforme a resposta da API (`motivo`/`aproximado`). */
export function mensagemDaBusca({ pin, aproximado, motivo }) {
  if (pin) {
    return aproximado
      ? { tipo: 'aviso', texto: 'Encontramos só a região aproximada. Arraste o pino até a porta da loja.' }
      : { tipo: 'ok', texto: 'Endereço encontrado. Confira e, se precisar, arraste o pino.' };
  }
  const textos = {
    NAO_ENCONTRADO: 'Endereço não encontrado na cidade. Posicione o pino à mão.',
    COTA: 'A busca no mapa atingiu o limite de hoje. Posicione o pino à mão.',
    DESLIGADO: 'Busca no mapa não configurada. Posicione o pino à mão.',
  };
  return { tipo: 'aviso', texto: textos[motivo] ?? 'Não foi possível buscar agora. Posicione o pino à mão.' };
}

/** "-23,3049" ou "-23.3049" → número; vazio ou inválido = null. */
export function lerCoordenada(texto) {
  const t = String(texto ?? '').trim().replace(',', '.');
  if (!/^-?\d{1,3}(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Dois campos de texto → pino válido, ou null. */
export function pinDosCampos(lat, lng) {
  const p = { latitude: lerCoordenada(lat), longitude: lerCoordenada(lng) };
  return pinValido(p) ? p : null;
}

/** 6 casas, vírgula decimal (exibição e campos manuais). */
export const coordenadaParaTexto = (v) => (Number.isFinite(v) ? v.toFixed(6).replace('.', ',') : '');

/** O pino mudou em relação ao salvo (comparando em 6 casas)? */
export function pinMudou(salvo, atual) {
  const s = pinValido(salvo) ? salvo : null;
  const a = pinValido(atual) ? atual : null;
  if (!s || !a) return Boolean(s) !== Boolean(a);
  return s.latitude.toFixed(6) !== a.latitude.toFixed(6) || s.longitude.toFixed(6) !== a.longitude.toFixed(6);
}

/** Corpo do PUT/PATCH: os dois números ou os dois null (apaga). */
export const pinParaApi = (p) => (pinValido(p) ? { latitude: p.latitude, longitude: p.longitude } : { latitude: null, longitude: null });
