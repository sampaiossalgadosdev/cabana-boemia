/**
 * Processo main do PDV: janela, sessão, rede (HTTP + Socket.IO) e IPC.
 * Tokens e rede ficam SÓ aqui; o renderer fala pelo preload (window.pdv).
 */
import path from 'node:path';
import { app, BrowserWindow, Menu, ipcMain, safeStorage, session } from 'electron';
import { io } from 'socket.io-client';
import { criarConfig } from './config.js';
import { criarArmazemRefresh } from './armazemRefresh.js';
import { criarClienteApi } from './clienteApi.js';
import { criarTempoReal } from './tempoReal.js';
import { criarHandlers, executar } from './ipc.js';
import { criarAgente } from './agente-impressao/agente.js';
import { criarPing } from './agente-impressao/conexao.js';
import { criarImpressoraArquivo, criarImpressoraWindows } from './agente-impressao/impressoras.js';
import { carregarSpooler } from './agente-impressao/winspool.js';
import { criarRegistro } from './registro.js';
import { criarEstadoLoja } from './loja.js';
import { PASTA_DO_PDV_ANTIGO, importarDoPdvAntigo } from './migracao.js';

const DEV = !app.isPackaged;
/** Servidor de produção: já vem preenchido (editável) na primeira execução do app instalado. */
const SERVIDOR_PRODUCAO = 'https://cabana.managerpix.com.br';
const URL_DEV_RENDERER = process.env.ELECTRON_RENDERER_URL;

/** Nome da entrada "abrir com o Windows" (HKCU\...\Run); o desinstalador apaga por ele. */
const NOME_INICIO = 'PDVdoAbatia';
/** A do programa antigo "Cabana Boemia PDV": apagada para não abrirem os dois. */
const NOME_INICIO_ANTIGO = 'CabanaBoemiaPDV';

// Primeiro uso no computador do PDV antigo: importa servidor, impressora e login
// ANTES de o Chromium iniciar (a chave da sessão cifrada mora no "Local State").
// PDV_PASTA_ANTIGA só para testes (aponta outra pasta como "a do programa antigo").
// Em desenvolvimento só com PDV_PASTA_ANTIGA (a pasta real do antigo aponta para produção).
const importacao =
  app.isPackaged || process.env.PDV_PASTA_ANTIGA
    ? importarDoPdvAntigo({
        dadosNovos: app.getPath('userData'),
        dadosAntigos: process.env.PDV_PASTA_ANTIGA || path.join(app.getPath('appData'), PASTA_DO_PDV_ANTIGO),
      })
    : { importou: false, motivo: 'desenvolvimento' };

// Uma instância só: o atalho/inicialização abre a janela que já existe.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  iniciar();
}

function iniciar() {
  /** @type {BrowserWindow | null} */
  let janela = null;

  const enviar = (canal, dados) => {
    if (janela && !janela.isDestroyed()) janela.webContents.send(canal, dados);
  };

  app.on('second-instance', () => {
    if (!janela) return;
    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();
  });

  app.whenReady().then(() => {
    const dados = app.getPath('userData');
    const config = criarConfig({
      caminho: path.join(dados, 'config.json'),
      // Produção: sem padrão; a tela de configuração pede a URL na primeira execução.
      apiUrlPadrao: DEV ? 'http://localhost:3000' : null,
      apiUrlSugerido: DEV ? null : SERVIDOR_PRODUCAO,
    });

    let tempoReal;
    let agente;
    let handlers;
    // Loja deste PDV: a do login (DONO/ATENDENTE) ou a escolhida pelo ADMIN (X-Loja).
    const loja = criarEstadoLoja({ servidor: config.servidor });
    const api = criarClienteApi({
      apiUrl: config.apiUrl,
      lojaInformada: loja.informada,
      armazem: criarArmazemRefresh({ caminho: path.join(dados, 'sessao.bin'), safeStorage }),
      aoSessaoExpirar: (erro) => {
        tempoReal?.desligar();
        agente?.desligar();
        enviar('sessao:expirou', { mensagem: erro.message, codigo: erro.codigo });
      },
    });

    // Log do agente de impressão em userData/logs (impressao.log + 5 antigos de 1 MB).
    const logImpressao = criarRegistro({ pasta: path.join(dados, 'logs'), nome: 'impressao', espelho: DEV ? console : null });
    logImpressao.info(`[pdv] versão ${app.getVersion()} iniciada`);
    if (importacao.importou) logImpressao.info(`[pdv] configuração importada do programa antigo: ${importacao.arquivos.join(', ')}`);
    else if (importacao.motivo === 'erro') logImpressao.warn(`[pdv] não deu para importar do programa antigo: ${importacao.erro}`);

    // Agente de impressão: só imprime neste computador se a impressora (ou o
    // modo teste) estiver configurada na tela "Impressora".
    agente = criarAgente({
      log: logImpressao,
      api,
      idAgente: config.idAgente,
      ping: criarPing({ apiUrl: config.apiUrl }),
      configuracao: config.impressao,
      criarSaida: async (cfg) =>
        cfg.modo === 'arquivo'
          ? criarImpressoraArquivo({ pasta: path.join(dados, 'impressoes-teste') })
          : criarImpressoraWindows({ nome: cfg.impressora, spooler: await carregarSpooler() }),
      aoStatus: (status) => enviar('impressao:status', status),
    });

    tempoReal = criarTempoReal({
      io,
      apiUrl: config.apiUrl,
      accessToken: api.accessToken,
      renovar: api.renovar,
      lojaInformada: loja.informada,
      aoStatus: (status) => {
        enviar('socket:status', status);
        // Eventos emitidos durante a queda não voltam: busca tudo o que está pendente.
        if (status === 'conectado') agente.aoReconectar();
      },
      aoEvento: (nome, dados) => {
        if (nome === 'impressao:nova') agente.aoImpressaoNova();
        else enviar(nome, dados);
        // A retaguarda trocou o nome, a logo ou a cor da loja: tema novo na hora.
        if (nome === 'cardapio:atualizado' && dados?.origem === 'loja') {
          handlers['loja:atual']()
            .then((identidade) => identidade && enviar('loja:atualizada', identidade))
            .catch(() => {});
        }
      },
    });

    const listarImpressoras = async () => {
      if (!janela || janela.isDestroyed()) return [];
      const lista = await janela.webContents.getPrintersAsync();
      return lista.map((p) => p.name).sort((a, b) => a.localeCompare(b));
    };

    handlers = criarHandlers({ config, api, tempoReal, agente, listarImpressoras, versao: app.getVersion(), loja });
    for (const [canal, handler] of Object.entries(handlers)) {
      ipcMain.handle(canal, (evento, ...args) => {
        // Só a nossa janela, com a nossa página, fala com o main.
        if (!janela || evento.sender !== janela.webContents || !origemConfiavel(evento.senderFrame?.url)) {
          return { ok: false, erro: { mensagem: 'Origem não autorizada', codigo: 'PROIBIDO', status: 403 } };
        }
        return executar(handler, args);
      });
    }

    // Nenhuma permissão do navegador (câmera, notificações...) é necessária.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, responder) => responder(false));

    // Abre com o Windows (só no app instalado: em dev registraria o electron.exe).
    // Nome fixo da entrada em HKCU\...\Run: o desinstalador apaga por ele (recursos/installer.nsh).
    if (!DEV) {
      app.setLoginItemSettings({ openAtLogin: true, name: NOME_INICIO });
      // O programa antigo não abre mais com o Windows (senão abririam os dois PDVs).
      app.setLoginItemSettings({ openAtLogin: false, name: NOME_INICIO_ANTIGO });
    }

    Menu.setApplicationMenu(null);
    janela = criarJanela();
    janela.on('closed', () => {
      janela = null;
    });
  });

  app.on('window-all-closed', () => app.quit());
}

function origemConfiavel(url = '') {
  if (URL_DEV_RENDERER && url.startsWith(URL_DEV_RENDERER)) return true;
  return url.startsWith('file://');
}

function criarJanela() {
  const janela = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'PDV do Abatiá',
    backgroundColor: '#FBF3E8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // O alerta de pedido novo toca mesmo sem clique (PDV abre sozinho com o Windows).
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  janela.once('ready-to-show', () => {
    janela.maximize();
    janela.show();
  });

  // Nada de abrir janelas nem navegar para fora do app.
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janela.webContents.on('will-navigate', (evento, url) => {
    if (!origemConfiavel(url)) evento.preventDefault();
  });

  if (URL_DEV_RENDERER) janela.loadURL(URL_DEV_RENDERER);
  else janela.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  return janela;
}
