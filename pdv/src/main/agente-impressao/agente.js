/**
 * Agente de impressão (processo main do PDV do balcão).
 *
 * Fluxo: ao receber "impressao:nova", ao (re)conectar o socket, quando o
 * heartbeat vê a API voltar e numa varredura de segurança a cada 30 s
 * (evento perdido), busca TODOS os pendentes e imprime em ordem de
 * id, um de cada vez. Só confirma na API depois que a impressora aceitou.
 * Nunca imprime um id duas vezes na mesma sessão (fila.js guarda os ids
 * impressos, mesmo que a confirmação ainda não tenha chegado na API).
 *
 * Módulos: fila.js (fila local), conexao.js (heartbeat/backoff),
 * formatacao.js (ESC/POS e texto), impressoras.js (Windows e .txt).
 */
import { montarCupom } from '@restaurante/shared/cupom';
import { cupomParaEscPos, cupomParaTexto } from './formatacao.js';
import { criarFilaLocal } from './fila.js';
import { criarHeartbeat, esperaBackoff } from './conexao.js';
import { ErroImpressora } from './impressoras.js';

export const TEMPOS_AGENTE = Object.freeze({
  /** Consulta do status da impressora (indicador), com o agente parado. */
  statusMs: 5_000,
  /** Varredura de segurança: busca pendentes mesmo sem aviso (evento perdido). */
  varreduraMs: 30_000,
  /** Nova tentativa depois de erro na impressora: 5 s, 10 s ... até 60 s. */
  retentativaInicialMs: 5_000,
  retentativaMaxMs: 60_000,
});

const RESTAURANTE_PADRAO = 'Cabana Boemia';

/** Cupom de teste (botão "Imprimir teste"): mostra acentos, negrito, grande e o corte. */
export function trabalhoDeTeste(agora = new Date()) {
  return {
    id: 0,
    tipo: 'PEDIDO',
    criadoEm: agora.toISOString(),
    pedido: {
      id: 0,
      numeroDia: 0,
      canal: 'WHATSAPP',
      nomeCliente: 'TESTE DE IMPRESSÃO',
      telefone: '43999990000',
      enderecoTexto: 'Acentuação: ç ã õ á é í ó ú â ê ô à ü Ç Ã É',
      bairroNome: 'Centro',
      subtotalCentavos: 2500,
      taxaEntregaCentavos: 500,
      totalCentavos: 3000,
      formaPagamento: 'DINHEIRO',
      trocoParaCentavos: 5000,
      tempoEstimadoMin: 40,
      criadoEm: agora.toISOString(),
      itens: [
        {
          id: 0,
          nome: 'Item de teste',
          quantidade: 1,
          pesoGramas: null,
          precoUnitarioCentavos: 2500,
          totalCentavos: 2500,
          observacao: 'observação em negrito',
        },
      ],
    },
  };
}

/**
 * @param {{
 *   api: { requisitar(metodo: string, rota: string, corpo?: unknown): Promise<any> },
 *   ping: () => Promise<void>,
 *   configuracao: () => import('./configuracao.js').PADRAO_IMPRESSAO,
 *   criarSaida: (cfg: object) => Promise<{ status(): Promise<{ estado: string, mensagem: string }>, imprimir(doc: object): Promise<void> }>,
 *   aoStatus?: (status: object) => void,
 *   tempos?: Partial<typeof TEMPOS_AGENTE & import('./conexao.js').TEMPOS_CONEXAO>,
 *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout },
 *   log?: Pick<Console, 'error' | 'warn'>,
 * }} opcoes
 */
export function criarAgente({
  api,
  ping,
  configuracao,
  criarSaida,
  aoStatus = () => {},
  tempos = {},
  timers = globalThis,
  log = console,
}) {
  const t = { ...TEMPOS_AGENTE, ...tempos };
  const fila = criarFilaLocal();
  /** Cupom que não deu para montar: não trava a fila, fica pendente na API com o erro. */
  const invalidos = new Set();

  let sessao = false; // logado
  let ativo = false; // logado e com modo de impressão
  let cfg = configuracao();
  let saida = null;
  let chaveSaida = null;
  let restaurante = RESTAURANTE_PADRAO;
  let rodando = null;
  let deNovo = false;
  let falhasImpressora = 0;
  let timerRetentativa = null;
  let timerStatus = null;
  let timerVarredura = null;

  let estado = { modo: cfg.modo, impressora: cfg.impressora, conexao: null, estado: 'desligado', mensagem: '', pendentes: 0 };

  function publicar(mudancas = {}) {
    estado = { ...estado, ...mudancas, pendentes: fila.tamanho() + fila.paraConfirmar().length };
    aoStatus(estado);
  }

  const heartbeat = criarHeartbeat({
    ping,
    tempos,
    timers,
    aoOnline: () => {
      publicar({ conexao: 'online' });
      sincronizar();
    },
    aoOffline: () => publicar({ conexao: 'offline' }),
  });

  // ───────── Saída (impressora ou arquivo) ─────────

  async function obterSaida() {
    const chave = JSON.stringify(cfg);
    if (saida && chave === chaveSaida) return saida;
    try {
      saida = await criarSaida(cfg);
      chaveSaida = chave;
      return saida;
    } catch (err) {
      saida = null;
      publicar({ estado: 'erro', mensagem: err.message });
      agendarRetentativa();
      return null;
    }
  }

  function documento(trabalho) {
    const linhas = montarCupom(trabalho, { colunas: cfg.largura, restaurante });
    const numero = trabalho.pedido?.numeroDia ?? 0;
    return {
      trabalhoId: trabalho.id,
      linhas,
      bytes: cupomParaEscPos(linhas, cfg),
      texto: cupomParaTexto(linhas, cfg.largura),
      nomeDocumento: `pedido-${numero}_${trabalho.tipo.toLowerCase()}_trabalho-${trabalho.id}`,
    };
  }

  // ───────── API ─────────

  /** Erro de rede: o heartbeat confere na hora e assume (offline + backoff). */
  function erroApi(err) {
    if (!err?.status) heartbeat.verificarAgora();
    else if (err.status !== 401) log.warn(`[impressão] API: ${err.message}`);
  }

  async function confirmar(id) {
    try {
      await api.requisitar('POST', `/equipe/impressoes/${id}/confirmar`);
      fila.marcarConfirmado(id);
      return true;
    } catch (err) {
      if (err?.status === 404) {
        fila.marcarConfirmado(id); // apagado no servidor: nada a confirmar
        return true;
      }
      erroApi(err);
      return false;
    }
  }

  async function confirmarAtrasados() {
    for (const id of fila.paraConfirmar()) if (!(await confirmar(id))) return false;
    return true;
  }

  async function reportarFalha(id, mensagem) {
    try {
      await api.requisitar('POST', `/equipe/impressoes/${id}/falha`, { erro: mensagem });
    } catch (err) {
      if (err?.status !== 409) erroApi(err);
    }
  }

  // ───────── Impressão ─────────

  function agendarRetentativa() {
    timers.clearTimeout(timerRetentativa);
    const espera = esperaBackoff(falhasImpressora, {
      backoffInicialMs: t.retentativaInicialMs,
      backoffMaxMs: t.retentativaMaxMs,
    });
    falhasImpressora += 1;
    timerRetentativa = timers.setTimeout(() => sincronizar(), espera);
  }

  /** @returns {Promise<boolean>} false = parou (impressora com erro) */
  async function processarFila() {
    const s = await obterSaida();
    if (!s) return false;
    for (let trab = fila.proximo(); trab && ativo; trab = fila.proximo()) {
      // Segunda trava: id que a impressora já aceitou nesta sessão nunca sai de novo.
      if (fila.jaImpresso(trab.id) || invalidos.has(trab.id)) {
        fila.remover(trab.id);
        continue;
      }

      let doc;
      try {
        doc = documento(trab);
      } catch (err) {
        invalidos.add(trab.id);
        fila.remover(trab.id);
        log.error(`[impressão] cupom ${trab.id} inválido:`, err);
        await reportarFalha(trab.id, `Cupom inválido: ${err.message}`);
        continue;
      }

      try {
        await s.imprimir(doc);
      } catch (err) {
        const e = err instanceof ErroImpressora ? err : new ErroImpressora('erro', err?.message ?? 'Erro na impressora');
        publicar({ estado: e.estado, mensagem: e.message });
        await reportarFalha(trab.id, e.message);
        agendarRetentativa();
        return false; // para aqui: a ordem é mantida e tenta de novo depois
      }

      fila.marcarImpresso(trab.id);
      falhasImpressora = 0;
      timers.clearTimeout(timerRetentativa);
      publicar({ estado: 'ok', mensagem: cfg.modo === 'arquivo' ? 'Modo teste (arquivo .txt)' : 'Impressora OK' });
      // Sem rede, a confirmação fica para quando a API voltar; o papel já saiu.
      await confirmar(trab.id);
    }
    return true;
  }

  async function rodada() {
    if (!(await confirmarAtrasados())) return;
    for (;;) {
      let r;
      try {
        r = await api.requisitar('GET', '/equipe/impressoes/pendentes');
      } catch (err) {
        erroApi(err);
        return;
      }
      if (estado.conexao !== 'online') publicar({ conexao: 'online' });
      if (r?.restaurante?.nome) restaurante = r.restaurante.nome;
      const trabalhos = Array.isArray(r?.trabalhos) ? r.trabalhos : [];
      fila.adicionar(trabalhos);
      publicar();
      if (!(await processarFila())) return;
      // Veio cheio: pode haver mais depois do limite.
      if (!r.limite || trabalhos.length < r.limite) return;
    }
  }

  /** Um ciclo de cada vez; pedido durante um ciclo roda mais uma vez no fim. */
  function sincronizar() {
    if (!ativo) return Promise.resolve();
    if (rodando) {
      deNovo = true;
      return rodando;
    }
    rodando = (async () => {
      do {
        deNovo = false;
        try {
          await rodada();
        } catch (err) {
          log.error('[impressão] falha inesperada:', err);
        }
      } while (deNovo && ativo);
    })().finally(() => {
      rodando = null;
      publicar();
    });
    return rodando;
  }

  // ───────── Status da impressora (indicador) ─────────

  async function consultarStatus() {
    if (!ativo || rodando) return;
    const s = await obterSaida();
    if (!s || !ativo || rodando) return;
    const r = await s.status();
    const voltou = r.estado === 'ok' && estado.estado !== 'ok';
    publicar({ estado: r.estado, mensagem: r.mensagem });
    // Papel trocado / impressora religada: imprime o que ficou parado.
    if (voltou && (fila.tamanho() || timerRetentativa)) sincronizar();
  }

  function agendarStatus() {
    timers.clearTimeout(timerStatus);
    if (!ativo) return;
    timerStatus = timers.setTimeout(async () => {
      try {
        await consultarStatus();
      } catch (err) {
        log.warn(`[impressão] status: ${err.message}`);
      }
      agendarStatus();
    }, t.statusMs);
  }

  function agendarVarredura() {
    timers.clearTimeout(timerVarredura);
    if (!ativo) return;
    timerVarredura = timers.setTimeout(() => {
      if (heartbeat.online()) sincronizar();
      agendarVarredura();
    }, t.varreduraMs);
  }

  // ───────── Liga/desliga ─────────

  function iniciar() {
    cfg = configuracao();
    ativo = sessao && cfg.modo !== 'desligado';
    if (!ativo) {
      publicar({ modo: cfg.modo, impressora: cfg.impressora, conexao: null, estado: 'desligado', mensagem: '' });
      return;
    }
    falhasImpressora = 0;
    publicar({ modo: cfg.modo, impressora: cfg.impressora, conexao: 'verificando', estado: 'verificando', mensagem: '' });
    heartbeat.ligar(); // ao ver a API online, sincroniza
    consultarStatus().catch(() => {});
    agendarStatus();
    agendarVarredura();
  }

  function parar() {
    ativo = false;
    heartbeat.desligar();
    timers.clearTimeout(timerRetentativa);
    timers.clearTimeout(timerStatus);
    timers.clearTimeout(timerVarredura);
    timerRetentativa = null;
    fila.esvaziar();
  }

  return {
    /** Depois do login. */
    ligar() {
      sessao = true;
      parar();
      iniciar();
    },
    /** Ao sair ou quando a sessão expira. */
    desligar() {
      sessao = false;
      parar();
      publicar({ conexao: null, estado: 'desligado', mensagem: '' });
    },
    /** Configuração da impressora mudou. */
    reconfigurar() {
      parar();
      saida = null;
      chaveSaida = null;
      iniciar();
    },
    aoImpressaoNova: () => sincronizar(),
    aoReconectar: () => sincronizar(),
    sincronizar,
    status: () => estado,

    /** Cupom de teste direto na saída configurada (não passa pela API). */
    async testar() {
      cfg = configuracao();
      if (cfg.modo === 'desligado') throw new Error('Escolha a impressora (ou o modo teste) e salve antes de testar');
      await rodando; // não mistura com a fila
      const s = await obterSaida();
      if (!s) throw new Error(estado.mensagem || 'Impressora indisponível');
      try {
        await s.imprimir(documento(trabalhoDeTeste()));
      } catch (err) {
        if (err instanceof ErroImpressora) publicar({ estado: err.estado, mensagem: err.message });
        throw err;
      }
      return { ok: true };
    },
  };
}
