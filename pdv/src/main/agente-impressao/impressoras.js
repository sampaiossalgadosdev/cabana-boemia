/**
 * Saídas do agente. Todas têm a mesma forma:
 *   status(): Promise<{ estado: 'ok' | 'sem-papel' | 'erro' | 'offline', mensagem: string }>
 *   imprimir({ bytes, texto, nomeDocumento }): Promise<void>  (lança ErroImpressora)
 * `imprimir` só resolve depois que a impressora aceitou o trabalho; é isso
 * que libera a confirmação na API.
 */
import fs from 'node:fs';
import path from 'node:path';

export class ErroImpressora extends Error {
  /** @param {'sem-papel' | 'erro' | 'offline'} estado */
  constructor(estado, mensagem) {
    super(mensagem);
    this.name = 'ErroImpressora';
    this.estado = estado;
  }
}

// ───────── Status do Windows (winspool) ─────────

/** PRINTER_INFO_2.Status */
export const PRINTER_STATUS = Object.freeze({
  PAUSED: 0x1,
  ERROR: 0x2,
  PAPER_JAM: 0x8,
  PAPER_OUT: 0x10,
  PAPER_PROBLEM: 0x40,
  OFFLINE: 0x80,
  OUTPUT_BIN_FULL: 0x800,
  NOT_AVAILABLE: 0x1000,
  NO_TONER: 0x40000,
  USER_INTERVENTION: 0x100000,
  OUT_OF_MEMORY: 0x200000,
  DOOR_OPEN: 0x400000,
  SERVER_UNKNOWN: 0x800000,
});
/** PRINTER_INFO_2.Attributes: "Usar impressora offline" (o Windows liga quando o USB some). */
export const PRINTER_ATTRIBUTE_WORK_OFFLINE = 0x400;

/** JOB_INFO_1.Status */
export const JOB_STATUS = Object.freeze({
  PAUSED: 0x1,
  ERROR: 0x2,
  DELETING: 0x4,
  OFFLINE: 0x20,
  PAPEROUT: 0x40,
  PRINTED: 0x80,
  DELETED: 0x100,
  BLOCKED_DEVQ: 0x200,
  USER_INTERVENTION: 0x400,
  COMPLETE: 0x1000,
});

/**
 * Status da impressora → estado do indicador. "Sem papel" só aparece se o
 * driver informar; senão cai em "erro" (combinado com o dono).
 */
export function interpretarStatusImpressora({ status = 0, atributos = 0 } = {}) {
  const S = PRINTER_STATUS;
  if (status & (S.PAPER_OUT | S.PAPER_PROBLEM)) return { estado: 'sem-papel', mensagem: 'Sem papel' };
  if (atributos & PRINTER_ATTRIBUTE_WORK_OFFLINE || status & (S.OFFLINE | S.NOT_AVAILABLE | S.SERVER_UNKNOWN)) {
    return { estado: 'offline', mensagem: 'Impressora desligada ou desconectada' };
  }
  if (status & S.PAPER_JAM) return { estado: 'erro', mensagem: 'Papel enroscado' };
  if (status & S.DOOR_OPEN) return { estado: 'erro', mensagem: 'Tampa aberta' };
  if (status & S.PAUSED) return { estado: 'erro', mensagem: 'Impressora pausada no Windows' };
  if (status & (S.ERROR | S.USER_INTERVENTION | S.OUTPUT_BIN_FULL | S.NO_TONER | S.OUT_OF_MEMORY)) {
    return { estado: 'erro', mensagem: 'Erro na impressora' };
  }
  return { estado: 'ok', mensagem: 'Impressora OK' };
}

/** Status do trabalho no spooler → null (ainda andando), 'impresso' ou ErroImpressora. */
export function interpretarStatusJob(status) {
  const J = JOB_STATUS;
  if (status & J.PAPEROUT) return new ErroImpressora('sem-papel', 'Sem papel');
  if (status & J.OFFLINE) return new ErroImpressora('offline', 'Impressora desligada ou desconectada');
  if (status & (J.ERROR | J.BLOCKED_DEVQ | J.USER_INTERVENTION | J.DELETING | J.DELETED)) {
    return new ErroImpressora('erro', 'Erro na impressora');
  }
  if (status & (J.PRINTED | J.COMPLETE)) return 'impresso';
  return null;
}

// ───────── Impressora do Windows (RAW pelo spooler) ─────────

export const TEMPOS_SPOOLER = Object.freeze({ esperaMaxMs: 30_000, intervaloMs: 250 });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @typedef {{
 *   estado(nome: string): { status: number, atributos: number },
 *   enviar(nome: string, documento: string, bytes: Uint8Array): number,
 *   job(nome: string, id: number): { status: number } | null,
 *   apagarJob(nome: string, id: number): void,
 * }} Spooler
 * @param {{ nome: string, spooler: Spooler, tempos?: Partial<typeof TEMPOS_SPOOLER> }} opcoes
 *   `spooler` = winspool.js (koffi) em produção; falso nos testes.
 */
export function criarImpressoraWindows({ nome, spooler, tempos = {} }) {
  const t = { ...TEMPOS_SPOOLER, ...tempos };

  async function status() {
    try {
      return interpretarStatusImpressora(spooler.estado(nome));
    } catch (err) {
      return { estado: 'erro', mensagem: err.message };
    }
  }

  function apagar(jobId) {
    try {
      spooler.apagarJob(nome, jobId);
    } catch {
      // já saiu da fila
    }
  }

  return {
    descricao: nome,
    status,

    /**
     * Envia RAW e espera o trabalho sair da fila do Windows sem erro. Em
     * erro ou demora, APAGA o trabalho da fila: senão ele sairia sozinho
     * quando a impressora voltasse, e o agente imprimiria de novo.
     */
    async imprimir({ bytes, nomeDocumento }) {
      const antes = await status();
      if (antes.estado !== 'ok') throw new ErroImpressora(antes.estado, antes.mensagem);

      let jobId;
      try {
        jobId = spooler.enviar(nome, nomeDocumento, bytes);
      } catch (err) {
        throw new ErroImpressora('erro', `Não foi possível enviar: ${err.message}`);
      }

      const limite = Date.now() + t.esperaMaxMs;
      for (;;) {
        let job;
        try {
          job = spooler.job(nome, jobId);
        } catch (err) {
          apagar(jobId);
          throw new ErroImpressora('erro', err.message);
        }
        if (!job) return; // saiu da fila do Windows: entregue à impressora
        const r = interpretarStatusJob(job.status);
        if (r === 'impresso') return;
        if (r instanceof ErroImpressora) {
          apagar(jobId);
          throw r;
        }
        if (Date.now() >= limite) {
          apagar(jobId);
          const agora = await status();
          throw agora.estado !== 'ok'
            ? new ErroImpressora(agora.estado, agora.mensagem)
            : new ErroImpressora('erro', 'A impressora não respondeu (trabalho parado na fila do Windows)');
        }
        await esperar(t.intervaloMs);
      }
    },
  };
}

// ───────── Modo teste: arquivo .txt ─────────

const carimbo = (d) => d.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);

/** Grava cada cupom em `<pasta>/<data UTC>_<documento>.txt` (UTF-8). */
export function criarImpressoraArquivo({ pasta, agora = () => new Date() }) {
  return {
    descricao: pasta,
    status: async () => ({ estado: 'ok', mensagem: 'Modo teste: cupons em arquivo .txt' }),
    async imprimir({ texto, nomeDocumento }) {
      try {
        await fs.promises.mkdir(pasta, { recursive: true });
        const destino = path.join(pasta, `${carimbo(agora())}_${nomeDocumento.replace(/[^\w.-]+/g, '-')}.txt`);
        await fs.promises.writeFile(`${destino}.tmp`, texto, 'utf8');
        await fs.promises.rename(`${destino}.tmp`, destino);
      } catch (err) {
        throw new ErroImpressora('erro', `Não foi possível gravar o arquivo: ${err.message}`);
      }
    },
  };
}
