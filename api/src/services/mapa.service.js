/**
 * Mapas pelo servidor: geocoding (texto → pino), distância pelas ruas da loja
 * até o cliente, com limite diário por serviço, cache de 30 dias e fallback.
 *
 * Nunca derruba quem chama: o geocoding falho devolve `pin: null` (o cliente
 * posiciona o pino à mão) e a distância falha cai na linha reta × 1,3
 * (`ESTIMADA`). Logs só com contagens e motivos, sem endereço nem pino.
 */
import { arredondar4, distanciaEmLinhaReta, distanciaEstimada, pinValido } from '@restaurante/shared/mapa';
import { diaLocal } from '../lib/fuso.js';
import { criarClienteGoogle, ErroMapa, lerConfigMapas } from '../lib/mapas.js';
import { CONTROLADOR } from '../lib/controlador.js';
import * as mapaRepo from '../repositories/mapa.repository.js';

/** Validade do cache de distâncias (o Google limita por quanto tempo o resultado fica guardado). */
export const VALIDADE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
export const SERVICOS = Object.freeze({ GEOCODING: 'geocoding', ROTAS: 'rotas' });
export const INTERVALO_LIMPEZA_MS = 24 * 60 * 60 * 1000;

/** Texto enviado ao Geocoding: só a rua, o número, o bairro e a cidade (nada do cliente). */
export function textoParaGeocodificar({ rua, numero, bairroNome }, cidade = CONTROLADOR.cidade) {
  return [`${rua.trim()}, ${numero.trim()}`, bairroNome, cidade, 'Brasil'].filter(Boolean).join(' - ');
}

/** O pino está a até `raioAceitoM` do centro configurado? */
export const dentroDoRaio = (pin, config) =>
  pinValido(pin) && distanciaEmLinhaReta(pin, config.centro) <= config.raioAceitoM;

const chaveDaRota = (origem, destino) => ({
  origemLat: arredondar4(origem.latitude),
  origemLng: arredondar4(origem.longitude),
  destinoLat: arredondar4(destino.latitude),
  destinoLng: arredondar4(destino.longitude),
});

/**
 * @param {{ config?: ReturnType<typeof lerConfigMapas>, google?: ReturnType<typeof criarClienteGoogle> | null,
 *           fetch?: typeof fetch, db?: import('@prisma/client').PrismaClient, log?: Pick<Console, 'info' | 'warn'> }} [opcoes]
 *   Sem `google` e com a chave do servidor: cliente real (com o `fetch` dado). Sem chave: nada é chamado.
 */
export function criarServicoMapas({ config = lerConfigMapas(), google, fetch, db, log = console } = {}) {
  const cliente = google !== undefined ? google : config.chaveServidor ? criarClienteGoogle({ chave: config.chaveServidor, fetch }) : null;
  const avisouLimite = new Set(); // "dia|servico": avisa uma vez por dia

  /** Reserva uma chamada do dia (false = limite atingido) e registra a contagem no log. */
  async function reservar(servico, limite, agora) {
    const dia = diaLocal(agora);
    const total = await mapaRepo.reservarChamada(dia, servico, limite, db);
    if (total == null) {
      const chave = `${dia}|${servico}`;
      if (!avisouLimite.has(chave)) {
        avisouLimite.add(chave);
        log.warn(`[mapas] ${dia} ${servico}: limite diário de ${limite} atingido`);
      }
      return false;
    }
    log.info(`[mapas] ${dia} ${servico}: ${total}/${limite}`);
    return true;
  }

  return {
    config,
    /** Há chave do servidor (geocoding e rotas podem ser chamados)? */
    ativo: Boolean(cliente),

    /**
     * Texto do endereço → pino (`textoParaGeocodificar` monta o do cliente). `motivo` quando não há pino: DESLIGADO (sem chave),
     * COTA (limite do dia ou do Google), INDISPONIVEL (Google fora/tempo) ou NAO_ENCONTRADO
     * (sem resultado ou fora do raio da cidade).
     * @returns {Promise<{ pin: { latitude: number, longitude: number } | null, aproximado: boolean, motivo: string | null }>}
     */
    async geocodificar(texto, { agora = new Date() } = {}) {
      const nada = (motivo) => ({ pin: null, aproximado: false, motivo });
      if (!cliente) return nada('DESLIGADO');
      if (!String(texto ?? '').trim()) return nada('NAO_ENCONTRADO');
      try {
        if (!(await reservar(SERVICOS.GEOCODING, config.limiteGeocodingDia, agora))) return nada('COTA');
        const r = await cliente.geocodificar(String(texto).trim(), { centro: config.centro });
        if (!r) return nada('NAO_ENCONTRADO');
        const pin = { latitude: r.latitude, longitude: r.longitude };
        if (!dentroDoRaio(pin, config)) return nada('NAO_ENCONTRADO');
        return { pin, aproximado: r.aproximado, motivo: null };
      } catch (err) {
        const motivo = err instanceof ErroMapa ? err.motivo : 'INDISPONIVEL';
        log.warn(`[mapas] geocoding falhou (${motivo}): ${err instanceof ErroMapa ? err.message : 'erro interno'}`);
        return nada(motivo);
      }
    },

    /**
     * Distância loja → cliente para gravar no pedido. Sem um dos pinos: só as
     * posições que existem, sem distância. Cache de 30 dias; sem chave, limite
     * do dia atingido, Google fora ou demorando: linha reta × 1,3 (ESTIMADA).
     * Nunca lança.
     */
    async distanciaDoPedido({ loja, destino, agora = new Date() }) {
      const campos = {
        latitudeLoja: pinValido(loja) ? loja.latitude : null,
        longitudeLoja: pinValido(loja) ? loja.longitude : null,
        latitudeEntrega: pinValido(destino) ? destino.latitude : null,
        longitudeEntrega: pinValido(destino) ? destino.longitude : null,
        distanciaMetros: null,
        distanciaOrigem: null,
      };
      if (!pinValido(loja) || !pinValido(destino)) return campos;
      const estimada = () => ({ ...campos, distanciaMetros: distanciaEstimada(loja, destino), distanciaOrigem: 'ESTIMADA' });
      try {
        const chave = chaveDaRota(loja, destino);
        const emCache = await mapaRepo.buscarRota(chave, new Date(agora.getTime() - VALIDADE_CACHE_MS), db);
        if (emCache != null) return { ...campos, distanciaMetros: emCache, distanciaOrigem: 'ROTA' };
        if (!cliente) return estimada();
        if (!(await reservar(SERVICOS.ROTAS, config.limiteRotasDia, agora))) return estimada();
        const metros = await cliente.distanciaPelasRuas(loja, destino);
        if (metros == null) {
          log.warn('[mapas] rotas: sem rota entre a loja e o endereço; distância estimada');
          return estimada();
        }
        await mapaRepo.guardarRota(chave, metros, agora, db);
        return { ...campos, distanciaMetros: metros, distanciaOrigem: 'ROTA' };
      } catch (err) {
        const motivo = err instanceof ErroMapa ? `${err.motivo}: ${err.message}` : 'erro interno';
        log.warn(`[mapas] rotas falhou (${motivo}); distância estimada`);
        return estimada();
      }
    },

    /** Uso dos últimos `dias` dias com os limites (rota do ADMIN). */
    async uso({ dias = 30, agora = new Date() } = {}) {
      const dia = (instante) => new Date(`${diaLocal(instante)}T00:00:00.000Z`);
      const linhas = await mapaRepo.usoEntre(dia(new Date(agora.getTime() - (dias - 1) * 86_400_000)), dia(agora), db);
      const porDia = new Map();
      for (const l of linhas) {
        const dia = l.dia.toISOString().slice(0, 10);
        if (!porDia.has(dia)) porDia.set(dia, { dia, geocoding: 0, rotas: 0 });
        if (l.servico in porDia.get(dia)) porDia.get(dia)[l.servico] = l.chamadas;
      }
      return {
        ativo: Boolean(cliente),
        limites: { geocoding: config.limiteGeocodingDia, rotas: config.limiteRotasDia },
        dias: [...porDia.values()],
      };
    },

    /** Apaga o cache de distâncias vencido. */
    limparCacheVencido(agora = new Date()) {
      return mapaRepo.apagarRotasAntigas(new Date(agora.getTime() - VALIDADE_CACHE_MS), db);
    },
  };
}

let padrao = null;
/** Serviço com a configuração do ambiente (criado na primeira vez que é usado). */
export function mapasPadrao() {
  padrao ??= criarServicoMapas();
  return padrao;
}

/** Rotina diária (server.js): apaga o cache vencido. */
export function iniciarLimpezaDoCache({ mapas = mapasPadrao(), intervaloMs = INTERVALO_LIMPEZA_MS } = {}) {
  const rodar = () =>
    mapas
      .limparCacheVencido()
      .then((r) => r.count > 0 && console.log(`[mapas] cache: ${r.count} distâncias vencidas apagadas`))
      .catch((erro) => console.warn(`[mapas] limpeza do cache falhou: ${erro.message}`));
  rodar();
  const timer = setInterval(rodar, intervaloMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
