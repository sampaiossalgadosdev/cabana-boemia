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

const DEV = !app.isPackaged;
const URL_DEV_RENDERER = process.env.ELECTRON_RENDERER_URL;

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
    });

    let tempoReal;
    const api = criarClienteApi({
      apiUrl: config.apiUrl,
      armazem: criarArmazemRefresh({ caminho: path.join(dados, 'sessao.bin'), safeStorage }),
      aoSessaoExpirar: (erro) => {
        tempoReal?.desligar();
        enviar('sessao:expirou', { mensagem: erro.message, codigo: erro.codigo });
      },
    });
    tempoReal = criarTempoReal({
      io,
      apiUrl: config.apiUrl,
      accessToken: api.accessToken,
      renovar: api.renovar,
      aoStatus: (status) => enviar('socket:status', status),
      aoEvento: enviar,
    });

    const handlers = criarHandlers({ config, api, tempoReal, versao: app.getVersion() });
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
    if (!DEV) app.setLoginItemSettings({ openAtLogin: true });

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
    title: 'Cabana Boemia PDV',
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
