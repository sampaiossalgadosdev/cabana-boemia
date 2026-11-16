/**
 * Conexão do agente com a API: ping (GET /health) a cada `intervaloMs`.
 * Sem resposta: marca offline e tenta de novo com espera crescente
 * (2 s, 4 s, 8 s ... até 60 s). Ao voltar: avisa `aoOnline` (o agente
 * busca tudo o que estiver pendente).
 */

export const TEMPOS_CONEXAO = Object.freeze({
  intervaloMs: 5_000,
  backoffInicialMs: 2_000,
  backoffMaxMs: 60_000,
  timeoutPingMs: 4_000,
});

/** Espera da n-ésima tentativa (0, 1, 2...): 2 s, 4 s, 8 s ... até o máximo. */
export function esperaBackoff(tentativa, { backoffInicialMs, backoffMaxMs } = TEMPOS_CONEXAO) {
  return Math.min(backoffInicialMs * 2 ** Math.min(tentativa, 30), backoffMaxMs);
}

/** Ping na API sem token (a rota /health é pública). */
export function criarPing({ apiUrl, fetch = globalThis.fetch, timeoutMs = TEMPOS_CONEXAO.timeoutPingMs }) {
  return async () => {
    const base = apiUrl();
    if (!base) throw new Error('Servidor não configurado');
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!res.ok) throw new Error(`Servidor respondeu ${res.status}`);
  };
}

/**
 * @param {{
 *   ping: () => Promise<void>,
 *   aoOnline?: () => void,
 *   aoOffline?: (erro: Error) => void,
 *   tempos?: Partial<typeof TEMPOS_CONEXAO>,
 *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout },
 * }} opcoes
 */
export function criarHeartbeat({ ping, aoOnline = () => {}, aoOffline = () => {}, tempos = {}, timers = globalThis }) {
  const t = { ...TEMPOS_CONEXAO, ...tempos };
  let ligado = false;
  /** @type {boolean | null} null = ainda não sabe */
  let online = null;
  let falhas = 0;
  let timer = null;
  let verificando = null;

  function agendar(ms) {
    timers.clearTimeout(timer);
    if (ligado) timer = timers.setTimeout(verificar, ms);
  }

  /** Um ping de cada vez; chamadas simultâneas esperam o mesmo. */
  function verificar() {
    verificando ??= (async () => {
      try {
        await ping();
        if (!ligado) return;
        falhas = 0;
        const voltou = online !== true;
        online = true;
        agendar(t.intervaloMs);
        if (voltou) aoOnline();
      } catch (err) {
        if (!ligado) return;
        const caiu = online !== false;
        online = false;
        agendar(esperaBackoff(falhas, t));
        falhas += 1;
        if (caiu) aoOffline(err);
      }
    })().finally(() => {
      verificando = null;
    });
    return verificando;
  }

  return {
    ligar() {
      if (ligado) return;
      ligado = true;
      online = null;
      falhas = 0;
      verificar();
    },
    desligar() {
      ligado = false;
      online = null;
      timers.clearTimeout(timer);
    },
    /** Uma requisição falhou por rede: confere agora (cai em offline e no backoff). */
    // Já offline: quem manda é o backoff (não martela a API a cada erro).
    verificarAgora: () => (ligado && online !== false ? verificar() : Promise.resolve()),
    online: () => online,
  };
}
