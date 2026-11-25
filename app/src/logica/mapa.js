/**
 * Pino do endereço no app: regras puras (testadas em test/mapa.test.js).
 * O texto do endereço é o que a pessoa escreveu e continua obrigatório; o pino
 * é a posição exata (busca pelo servidor, "usar minha localização" ou arrastar).
 */
import { pinDe, pinValido } from '@restaurante/shared/mapa';

/** Centro de Abatiá-PR (mapa sem pino nenhum). */
export const CENTRO_CIDADE = Object.freeze({ latitude: -23.3049, longitude: -50.3133 });

/** Pino salvo no endereço, ou null. */
export const pinDoEndereco = (endereco) => pinDe(endereco);

/** O endereço ainda não tem pino (pedir para confirmar no próximo pedido)? */
export const precisaConfirmarPino = (endereco) => Boolean(endereco) && !pinDe(endereco);

/** Região do mapa: perto da porta com pino exato, mais aberta se aproximado ou sem pino. */
export function regiaoDoMapa(pin, { aproximado = false } = {}) {
  const centro = pinValido(pin) ? pin : CENTRO_CIDADE;
  const delta = !pinValido(pin) ? 0.03 : aproximado ? 0.008 : 0.003;
  return { latitude: centro.latitude, longitude: centro.longitude, latitudeDelta: delta, longitudeDelta: delta };
}

/** Rua, número ou bairro mudaram desde que o pino foi marcado? (o pino deixa de valer) */
export function mudouOLugar(antes, depois) {
  if (!antes) return false;
  const t = (v) => String(v ?? '').trim();
  return t(antes.rua) !== t(depois.rua) || t(antes.numero) !== t(depois.numero) || antes.bairroId !== depois.bairroId;
}

/** Corpo do POST/PUT do endereço: os campos de texto + o pino (os dois null = sem pino). */
export function corpoDoEndereco(dados, pin) {
  const p = pinValido(pin) ? pin : null;
  return { ...dados, latitude: p?.latitude ?? null, longitude: p?.longitude ?? null };
}

/** Mensagem da busca no mapa (resposta da API: `{ pin, aproximado, motivo }`). */
export function mensagemDaBusca({ pin, aproximado, motivo }) {
  if (pin) {
    return aproximado
      ? { tipo: 'aviso', texto: 'Achamos só a região. Arraste o pino até a sua porta.' }
      : { tipo: 'ok', texto: 'Confira o pino e, se precisar, arraste até a sua porta.' };
  }
  const textos = {
    NAO_ENCONTRADO: 'Não achamos esse endereço no mapa. Toque no mapa onde fica a sua porta.',
    COTA: 'A busca no mapa está indisponível agora. Toque no mapa onde fica a sua porta.',
    DESLIGADO: 'Toque no mapa onde fica a sua porta.',
  };
  return { tipo: 'aviso', texto: textos[motivo] ?? 'Não deu para buscar agora. Toque no mapa onde fica a sua porta.' };
}

/** Texto quando a permissão de localização foi negada ou o GPS falhou. */
export function mensagemDaLocalizacao(motivo) {
  if (motivo === 'negada') return 'Sem permissão de localização. Você pode tocar no mapa onde fica a sua porta.';
  return 'Não deu para pegar a sua localização agora. Toque no mapa onde fica a sua porta.';
}

/**
 * Há mapa neste aparelho? Precisa da chave do Maps SDK no build (`extra.mapa`)
 * ou estar no Expo Go (que traz a própria chave). Sem mapa, o endereço funciona sem pino.
 */
export function mapaDisponivel({ plataforma, extra, emExpoGo = false }) {
  if (plataforma !== 'android' && plataforma !== 'ios') return false;
  if (emExpoGo) return true;
  return Boolean(extra?.mapa?.[plataforma]);
}
