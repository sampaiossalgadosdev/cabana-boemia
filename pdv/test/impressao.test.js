import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarAgente } from '../src/main/agente-impressao/agente.js';
import { criarFilaLocal } from '../src/main/agente-impressao/fila.js';
import { criarHeartbeat, esperaBackoff } from '../src/main/agente-impressao/conexao.js';
import { cupomParaEscPos } from '../src/main/agente-impressao/formatacao.js';
import { PADRAO_IMPRESSAO, validarConfigImpressao } from '../src/main/agente-impressao/configuracao.js';
import {
  ErroImpressora,
  JOB_STATUS,
  PRINTER_ATTRIBUTE_WORK_OFFLINE,
  PRINTER_STATUS,
  criarImpressoraArquivo,
  criarImpressoraWindows,
  interpretarStatusImpressora,
} from '../src/main/agente-impressao/impressoras.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarAte(condicao, mensagem, limiteMs = 3000) {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) assert.fail(`tempo esgotado: ${mensagem}`);
    await esperar(5);
  }
}

/** API falsa em memória: pendentes, confirmar (idempotente) e falha. */
function criarServidorFalso() {
  const trabalhos = new Map();
  let fora = false;
  let proximoId = 1;
  const confirmacoes = [];
  const falhas = [];
  const ignorarConfirmacao = new Set();
  const semConexao = () => Object.assign(new Error('Sem conexão com o servidor'), { status: 0, codigo: 'SEM_CONEXAO' });

  return {
    trabalhos,
    confirmacoes,
    falhas,
    derrubar: () => {
      fora = true;
    },
    religar: () => {
      fora = false;
    },
    /** Simula confirmação que "sumiu" no servidor: o trabalho continua PENDENTE. */
    ignorarConfirmacaoDe: (id) => ignorarConfirmacao.add(id),
    novo(tipo = 'PEDIDO') {
      const id = proximoId++;
      trabalhos.set(id, {
        id,
        tipo,
        status: 'PENDENTE',
        tentativas: 0,
        criadoEm: '2026-11-14T23:15:00.000Z',
        pedido: {
          id: 100 + id,
          numeroDia: id,
          canal: 'SITE',
          nomeCliente: `Cliente ${id}`,
          telefone: '43999990000',
          enderecoTexto: 'Rua A, 10',
          bairroNome: 'Centro',
          subtotalCentavos: 1200,
          taxaEntregaCentavos: 500,
          totalCentavos: 1700,
          formaPagamento: 'PIX',
          trocoParaCentavos: null,
          tempoEstimadoMin: 40,
          criadoEm: '2026-11-14T23:15:00.000Z',
          itens: [{ id, nome: 'Coca-Cola 1L', quantidade: 1, precoUnitarioCentavos: 1200, totalCentavos: 1200, observacao: 'gelada' }],
        },
      });
      return id;
    },
    /** Trabalho FECHAMENTO: sem pedido, com o resumo do caixa. */
    novoFechamento() {
      const id = proximoId++;
      trabalhos.set(id, {
        id,
        tipo: 'FECHAMENTO',
        status: 'PENDENTE',
        tentativas: 0,
        criadoEm: '2026-11-16T02:31:00.000Z',
        pedidoId: null,
        caixaId: 7,
        caixa: {
          id: 7,
          abertoEm: '2026-11-15T13:58:00.000Z',
          abertoPor: { id: 2, nome: 'Ana' },
          valorInicialCentavos: 10000,
          fechadoEm: '2026-11-16T02:30:00.000Z',
          fechadoPor: { id: 2, nome: 'Ana' },
          valorContadoCentavos: 14500,
          observacao: null,
          movimentos: [],
          totaisPorForma: [{ forma: 'DINHEIRO', quantidade: 2, totalCentavos: 4500 }],
        },
      });
      return id;
    },
    ping: async () => {
      if (fora) throw semConexao();
    },
    api: {
      async requisitar(metodo, rota, corpo) {
        await esperar(1);
        if (fora) throw semConexao();
        if (metodo === 'POST' && rota === '/equipe/impressoes/reservar') {
          assert.match(corpo?.agente ?? '', /^[A-Za-z0-9._:-]{1,64}$/, 'reserva com o agente');
          const lista = [...trabalhos.values()].filter((t) => t.status === 'PENDENTE').sort((a, b) => a.id - b.id);
          return { restaurante: { nome: 'Cabana Boemia' }, limite: 50, trabalhos: structuredClone(lista) };
        }
        const m = /^\/equipe\/impressoes\/(\d+)\/(confirmar|falha)$/.exec(rota);
        if (metodo === 'POST' && m) {
          assert.ok(corpo?.agente, 'confirmar/falha levam o agente');
          const t = trabalhos.get(Number(m[1]));
          if (!t) throw Object.assign(new Error('não encontrado'), { status: 404 });
          if (m[2] === 'confirmar') {
            confirmacoes.push(t.id);
            const jaConfirmado = t.status === 'IMPRESSO';
            if (!ignorarConfirmacao.has(t.id)) t.status = 'IMPRESSO';
            return { trabalho: t, jaConfirmado };
          }
          if (t.status !== 'PENDENTE') throw Object.assign(new Error('impresso'), { status: 409 });
          t.tentativas += 1;
          falhas.push({ id: t.id, erro: corpo?.erro });
          return { trabalho: t };
        }
        throw new Error(`rota inesperada ${metodo} ${rota}`);
      },
    },
  };
}

/** Impressora falsa: guarda os ids impressos; pode ficar "sem papel". */
function criarImpressoraFalsa() {
  const impressos = [];
  const documentos = [];
  let problema = null;
  return {
    impressos,
    documentos,
    semPapel: () => {
      problema = new ErroImpressora('sem-papel', 'Sem papel');
    },
    normal: () => {
      problema = null;
    },
    aoImprimir: null,
    async status() {
      return problema ? { estado: problema.estado, mensagem: problema.message } : { estado: 'ok', mensagem: 'Impressora OK' };
    },
    async imprimir(doc) {
      await esperar(2);
      if (problema) throw problema;
      assert.ok(doc.bytes instanceof Uint8Array && doc.bytes.length > 0, 'bytes ESC/POS');
      assert.match(doc.texto, /PEDIDO #|FECHAMENTO DE CAIXA/);
      impressos.push(doc.trabalhoId);
      documentos.push(doc.nomeDocumento);
      this.aoImprimir?.(doc.trabalhoId);
    },
  };
}

const TEMPOS_RAPIDOS = {
  intervaloMs: 15,
  backoffInicialMs: 10,
  backoffMaxMs: 40,
  timeoutPingMs: 50,
  statusMs: 10_000,
  varreduraMs: 10_000,
  retentativaInicialMs: 10,
  retentativaMaxMs: 40,
};

const agentes = [];
function montarAgente({ servidor, impressora, modo = 'impressora' }) {
  const status = [];
  const agente = criarAgente({
    api: servidor.api,
    ping: servidor.ping,
    configuracao: () => ({ ...PADRAO_IMPRESSAO, modo, impressora: 'EPSON TM-T20' }),
    criarSaida: async () => impressora,
    aoStatus: (s) => status.push(s),
    tempos: TEMPOS_RAPIDOS,
    log: { error() {}, warn() {} },
  });
  agentes.push(agente);
  return { agente, status, ultimo: () => status.at(-1) };
}

afterEach(() => {
  while (agentes.length) agentes.pop().desligar();
});

describe('agente de impressão', () => {
  test('API cai, 3 pedidos entram, API volta: os 3 imprimem uma vez cada', async () => {
    const servidor = criarServidorFalso();
    const impressora = criarImpressoraFalsa();
    const { agente, ultimo } = montarAgente({ servidor, impressora });

    agente.ligar();
    await esperarAte(() => ultimo().conexao === 'online', 'API online');

    servidor.derrubar();
    await esperarAte(() => ultimo().conexao === 'offline', 'heartbeat marca offline');
    const ids = [servidor.novo(), servidor.novo(), servidor.novo()];
    // Avisos chegando com a API fora (ou atrasados): nada sai e nada se perde.
    for (let i = 0; i < 3; i++) agente.aoImpressaoNova();
    await esperar(60);
    assert.deepEqual(impressora.impressos, []);

    servidor.religar();
    await esperarAte(() => servidor.confirmacoes.length === 3, 'confirmar os 3');
    assert.equal(ultimo().conexao, 'online');

    // Avisos e reconexões depois disso não imprimem de novo.
    await Promise.all([agente.aoImpressaoNova(), agente.aoReconectar(), agente.sincronizar(), agente.aoImpressaoNova()]);
    await esperar(60);

    assert.deepEqual(impressora.impressos, ids, 'cada um uma vez, em ordem');
    assert.deepEqual(servidor.confirmacoes, ids, 'confirmados uma vez cada');
    assert.ok([...servidor.trabalhos.values()].every((t) => t.status === 'IMPRESSO'));
    assert.equal(ultimo().pendentes, 0);
  });

  test('FECHAMENTO de caixa (sem pedido) imprime na ordem e confirma, com nome de documento do caixa', async () => {
    const servidor = criarServidorFalso();
    const impressora = criarImpressoraFalsa();
    const { agente } = montarAgente({ servidor, impressora });
    const ids = [servidor.novo(), servidor.novoFechamento()];
    agente.ligar();
    await esperarAte(() => servidor.confirmacoes.length === 2, 'confirmar os 2');
    assert.deepEqual(impressora.impressos, ids);
    assert.deepEqual(impressora.documentos, [`pedido-1_pedido_trabalho-${ids[0]}`, `caixa-7_fechamento_trabalho-${ids[1]}`]);
  });

  test('avisos simultâneos não duplicam (um ciclo de cada vez)', async () => {
    const servidor = criarServidorFalso();
    const impressora = criarImpressoraFalsa();
    const { agente } = montarAgente({ servidor, impressora });
    agente.ligar();
    await esperar(30);
    const ids = [servidor.novo(), servidor.novo(), servidor.novo()];
    await Promise.all(Array.from({ length: 10 }, () => agente.aoImpressaoNova()));
    await esperarAte(() => impressora.impressos.length >= 3, 'imprimir');
    await esperar(40);
    assert.deepEqual(impressora.impressos, ids);
  });

  test('só confirma depois que a impressora aceitou', async () => {
    const servidor = criarServidorFalso();
    const impressora = criarImpressoraFalsa();
    const estadoNaHora = [];
    impressora.aoImprimir = (id) => estadoNaHora.push(servidor.trabalhos.get(id).status);
    const { agente } = montarAgente({ servidor, impressora });
    servidor.novo();
    agente.ligar();
    await esperarAte(() => servidor.confirmacoes.length === 1, 'confirmar');
    assert.deepEqual(estadoNaHora, ['PENDENTE'], 'ainda pendente quando o papel saiu');
  });

  test('id já impresso na sessão nunca sai de novo, mesmo se a API devolver ele', async () => {
    const servidor = criarServidorFalso();
    const impressora = criarImpressoraFalsa();
    const { agente } = montarAgente({ servidor, impressora });
    const id = servidor.novo();
    servidor.ignorarConfirmacaoDe(id); // a API "perde" a confirmação: continua PENDENTE
    agente.ligar();
    await esperarAte(() => impressora.impressos.length === 1, 'primeira impressão');
    for (let i = 0; i < 3; i++) await agente.sincronizar();
    assert.equal(servidor.trabalhos.get(id).status, 'PENDENTE', 'a API segue devolvendo o id');
    assert.deepEqual(impressora.impressos, [id], 'segunda trava: memória da sessão');
  });

  test('API cai logo depois de imprimir: confirma quando voltar, sem reimprimir', async () => {
    const servidor = criarServidorFalso();
    const impressora = criarImpressoraFalsa();
    impressora.aoImprimir = () => servidor.derrubar();
    const { agente, ultimo } = montarAgente({ servidor, impressora });
    const id = servidor.novo();
    agente.ligar();
    await esperarAte(() => impressora.impressos.length === 1, 'imprimir');
    await esperarAte(() => ultimo().conexao === 'offline', 'offline');
    assert.equal(servidor.trabalhos.get(id).status, 'PENDENTE');
    assert.equal(ultimo().pendentes, 1, 'falta confirmar');

    impressora.aoImprimir = null;
    servidor.religar();
    await esperarAte(() => servidor.trabalhos.get(id).status === 'IMPRESSO', 'confirmar ao voltar');
    await agente.sincronizar();
    assert.deepEqual(impressora.impressos, [id]);
  });

  test('sem papel: registra falha, mantém a ordem e imprime ao voltar o papel', async () => {
    const servidor = criarServidorFalso();
    const impressora = criarImpressoraFalsa();
    const { agente, ultimo } = montarAgente({ servidor, impressora });
    impressora.semPapel();
    const ids = [servidor.novo(), servidor.novo()];
    agente.ligar();
    await esperarAte(() => servidor.falhas.length >= 2, 'falhas com retentativa');
    assert.equal(ultimo().estado, 'sem-papel');
    assert.equal(ultimo().mensagem, 'Sem papel');
    assert.ok(servidor.falhas.every((f) => f.id === ids[0] && f.erro === 'Sem papel'), 'para no primeiro: não pula a ordem');
    assert.ok(servidor.trabalhos.get(ids[0]).tentativas >= 2, 'tentativas incrementadas');
    assert.deepEqual(impressora.impressos, []);

    impressora.normal();
    await esperarAte(() => servidor.confirmacoes.length === 2, 'imprimir depois do papel');
    assert.deepEqual(impressora.impressos, ids);
    assert.equal(ultimo().estado, 'ok');
  });

  test('evento perdido: a varredura de segurança acha o pendente', async () => {
    const servidor = criarServidorFalso();
    const impressora = criarImpressoraFalsa();
    const agente = criarAgente({
      api: servidor.api,
      ping: servidor.ping,
      configuracao: () => ({ ...PADRAO_IMPRESSAO, modo: 'impressora', impressora: 'X' }),
      criarSaida: async () => impressora,
      tempos: { ...TEMPOS_RAPIDOS, varreduraMs: 30 },
      log: { error() {}, warn() {} },
    });
    agentes.push(agente);
    agente.ligar();
    await esperar(20);
    const id = servidor.novo(); // nenhum aviso chega
    await esperarAte(() => impressora.impressos.length === 1, 'varredura');
    assert.deepEqual(impressora.impressos, [id]);
  });

  test('desligado (padrão) não busca nem imprime nada', async () => {
    const servidor = criarServidorFalso();
    const impressora = criarImpressoraFalsa();
    const { agente, ultimo } = montarAgente({ servidor, impressora, modo: 'desligado' });
    servidor.novo();
    agente.ligar();
    await agente.aoImpressaoNova();
    await esperar(30);
    assert.deepEqual(impressora.impressos, []);
    assert.equal(ultimo().estado, 'desligado');
    await assert.rejects(agente.testar(), /Escolha a impressora/);
  });

  test('modo teste: cada cupom vira um .txt', async () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-impressoes-'));
    const servidor = criarServidorFalso();
    const arquivo = criarImpressoraArquivo({ pasta });
    const { agente } = montarAgente({ servidor, impressora: arquivo, modo: 'arquivo' });
    servidor.novo();
    servidor.novo('CANCELAMENTO');
    agente.ligar();
    await esperarAte(() => servidor.confirmacoes.length === 2, 'gravar os dois');
    const nomes = fs.readdirSync(pasta).sort();
    assert.equal(nomes.length, 2);
    assert.ok(nomes.every((n) => n.endsWith('.txt')));
    const textos = nomes.map((n) => fs.readFileSync(path.join(pasta, n), 'utf8'));
    assert.ok(textos.some((t) => t.includes('PEDIDO #1') && t.includes('OBS: gelada')));
    assert.ok(textos.some((t) => t.includes('PEDIDO CANCELADO')));

    await agente.testar();
    assert.equal(fs.readdirSync(pasta).length, 3, 'cupom de teste também');
  });
});

describe('fila local', () => {
  test('ordem por id, sem repetidos, e impresso nunca volta', () => {
    const f = criarFilaLocal();
    assert.equal(f.adicionar([{ id: 3 }, { id: 1 }, { id: 2 }, { id: 1 }, { id: 'x' }]), 3);
    assert.equal(f.proximo().id, 1);
    f.marcarImpresso(1);
    assert.equal(f.proximo().id, 2);
    assert.equal(f.adicionar([{ id: 1 }]), 0, 'impresso não volta');
    assert.deepEqual(f.paraConfirmar(), [1]);
    f.marcarConfirmado(1);
    assert.deepEqual(f.paraConfirmar(), []);
    f.esvaziar();
    assert.equal(f.tamanho(), 0);
    assert.equal(f.adicionar([{ id: 1 }]), 0, 'a trava sobrevive ao esvaziar');
  });
});

describe('heartbeat', () => {
  test('backoff 2 s, 4 s, 8 s ... até 60 s', () => {
    assert.deepEqual(
      Array.from({ length: 8 }, (_, i) => esperaBackoff(i) / 1000),
      [2, 4, 8, 16, 32, 60, 60, 60],
    );
  });

  test('ping a cada 5 s; sem resposta, offline e backoff; ao voltar, online e 5 s de novo', async () => {
    const agendados = [];
    const timers = {
      setTimeout: (fn, ms) => {
        agendados.push({ fn, ms });
        return agendados.length;
      },
      clearTimeout() {},
    };
    let fora = false;
    const eventos = [];
    const hb = criarHeartbeat({
      ping: async () => {
        if (fora) throw new Error('offline');
      },
      aoOnline: () => eventos.push('online'),
      aoOffline: () => eventos.push('offline'),
      timers,
    });
    const rodarProximo = async () => agendados.at(-1).fn();

    hb.ligar();
    await esperar(1);
    fora = true;
    for (let i = 0; i < 7; i++) await rodarProximo();
    fora = false;
    await rodarProximo();
    await rodarProximo();
    hb.desligar();

    assert.deepEqual(
      agendados.map((a) => a.ms / 1000),
      [5, 2, 4, 8, 16, 32, 60, 60, 5, 5],
    );
    assert.deepEqual(eventos, ['online', 'offline', 'online'], 'avisa só na mudança');
  });
});

describe('impressora do Windows (spooler falso)', () => {
  function spoolerFalso({ status = 0, atributos = 0, jobs = [] } = {}) {
    const s = {
      enviados: [],
      apagados: [],
      estado: () => ({ status, atributos }),
      enviar(nome, documento, bytes) {
        s.enviados.push({ nome, documento, bytes });
        return 77;
      },
      job: () => (jobs.length ? { status: jobs.shift() } : null),
      apagarJob: (nome, id) => s.apagados.push(id),
    };
    return s;
  }
  const doc = { bytes: new Uint8Array([0x1b, 0x40]), nomeDocumento: 'pedido-1' };
  const rapido = { esperaMaxMs: 50, intervaloMs: 1 };

  test('sucesso só quando o trabalho sai da fila do Windows', async () => {
    const IMPRIMINDO = 0x10; // JOB_STATUS_PRINTING
    const sp = spoolerFalso({ jobs: [IMPRIMINDO, IMPRIMINDO] });
    await criarImpressoraWindows({ nome: 'EPSON', spooler: sp, tempos: rapido }).imprimir(doc);
    assert.equal(sp.enviados.length, 1);
    assert.equal(sp.enviados[0].nome, 'EPSON');
    assert.deepEqual(sp.apagados, []);
  });

  test('sem papel no meio: apaga o trabalho da fila (não sai sozinho depois) e acusa', async () => {
    const sp = spoolerFalso({ jobs: [0x10, JOB_STATUS.PAPEROUT] }); // imprimindo → acabou o papel
    await assert.rejects(
      criarImpressoraWindows({ nome: 'EPSON', spooler: sp, tempos: rapido }).imprimir(doc),
      (e) => e instanceof ErroImpressora && e.estado === 'sem-papel',
    );
    assert.deepEqual(sp.apagados, [77]);
  });

  test('parado na fila além do limite: apaga e dá erro', async () => {
    const sp = spoolerFalso({ jobs: Array(1000).fill(0) });
    await assert.rejects(
      criarImpressoraWindows({ nome: 'EPSON', spooler: sp, tempos: rapido }).imprimir(doc),
      /não respondeu/,
    );
    assert.deepEqual(sp.apagados, [77]);
  });

  test('impressora offline: nem envia', async () => {
    const sp = spoolerFalso({ atributos: PRINTER_ATTRIBUTE_WORK_OFFLINE });
    await assert.rejects(
      criarImpressoraWindows({ nome: 'EPSON', spooler: sp, tempos: rapido }).imprimir(doc),
      (e) => e.estado === 'offline',
    );
    assert.equal(sp.enviados.length, 0);
  });

  test('status: sem papel quando o driver informa; senão erro', () => {
    const S = PRINTER_STATUS;
    assert.equal(interpretarStatusImpressora({ status: 0 }).estado, 'ok');
    assert.equal(interpretarStatusImpressora({ status: S.PAPER_OUT }).estado, 'sem-papel');
    assert.equal(interpretarStatusImpressora({ status: S.ERROR }).estado, 'erro', 'driver sem "sem papel" cai em erro');
    assert.equal(interpretarStatusImpressora({ status: S.OFFLINE }).estado, 'offline');
    assert.equal(interpretarStatusImpressora({ status: S.PAUSED }).mensagem, 'Impressora pausada no Windows');
    assert.equal(interpretarStatusImpressora({ status: S.DOOR_OPEN }).estado, 'erro');
  });
});

describe('formatação ESC/POS', () => {
  const linhas = [
    { texto: 'CABANA BOEMIA'.padEnd(24), negrito: true, grande: true },
    { texto: 'Ação'.padEnd(48) },
    { texto: '   OBS: sem cebola'.padEnd(48), negrito: true },
  ];
  const hex = (b) => Buffer.from(b).toString('hex');

  test('tabela, negrito, tamanho duplo e guilhotina', () => {
    const b = hex(cupomParaEscPos(linhas, { largura: 48, tabela: 'cp860', guilhotina: true }));
    assert.ok(b.startsWith('1b40'), 'ESC @ inicializa');
    assert.ok(b.includes('1b7403'), 'ESC t 3 = cp860 (Epson)');
    assert.ok(b.includes('4187846f'), '"Ação" em cp860: ç = 0x87, ã = 0x84');
    assert.ok(b.includes('1b4501') && b.includes('1b4500'), 'negrito liga e desliga');
    assert.ok(b.includes('1d2111'), 'GS ! 0x11 = largura e altura dupla');
    assert.ok(b.includes('1d5601'), 'GS V corte parcial');
  });

  test('cp850 e sem guilhotina (só avança o papel)', () => {
    const b = hex(cupomParaEscPos(linhas, { largura: 48, tabela: 'cp850', guilhotina: false }));
    assert.ok(b.includes('1b7402'), 'ESC t 2 = cp850');
    assert.ok(!b.includes('1d56'), 'sem comando de corte');
  });

  test('linha com a largura exata não vira duas', () => {
    const b = Buffer.from(cupomParaEscPos([{ texto: 'x'.repeat(48) }], { largura: 48, tabela: 'cp860', guilhotina: false }));
    const corpo = b.toString('latin1');
    assert.equal(corpo.split('x'.repeat(48)).length, 2);
    assert.ok(!/x\r?\n\r?x/.test(corpo));
  });

  test('config: padrões do dono e validação', () => {
    assert.deepEqual(PADRAO_IMPRESSAO, { modo: 'desligado', impressora: '', largura: 48, tabela: 'cp860', guilhotina: true });
    assert.throws(() => validarConfigImpressao({ modo: 'impressora' }), /Escolha a impressora/);
    assert.deepEqual(validarConfigImpressao({ modo: 'arquivo' }), { ...PADRAO_IMPRESSAO, modo: 'arquivo' });
  });
});
