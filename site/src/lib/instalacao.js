/**
 * Convite para instalar o site como app (PWA). Lógica pura, testada.
 * - Android/Chrome: botão "Instalar app" quando o navegador oferece
 *   (`beforeinstallprompt`); some depois de instalado ou recusado.
 * - iPhone/iPad no Safari: dica "Compartilhar › Adicionar à Tela de Início"
 *   até o cliente fechar (uma vez só).
 * - Já aberto como app: nada.
 */
import { gravarTexto, lerTexto } from './armazenamento.js';

export const CHAVE_INSTALACAO = 'cabana-boemia:instalacao:v1';

/** Site aberto pelo ícone da tela inicial (Android: display-mode; iOS: navigator.standalone). */
export function estaComoApp(win = globalThis) {
  try {
    if (win.navigator?.standalone === true) return true;
    return Boolean(win.matchMedia?.('(display-mode: standalone)').matches);
  } catch {
    return false;
  }
}

/**
 * Safari do iPhone/iPad (o iPad se apresenta como Mac, mas tem toque).
 * Chrome/Firefox/Edge do iOS ficam de fora: o caminho para instalar é outro.
 */
export function ehSafariDoIos({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (!ios) return false;
  return /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Instagram|FBAN|FBAV/.test(userAgent);
}

/** @returns {{ android?: 'instalado' | 'dispensado', ios?: 'fechado' }} */
export function lerEscolha(storage) {
  try {
    const valor = JSON.parse(lerTexto(CHAVE_INSTALACAO, storage) ?? '{}');
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
  } catch {
    return {};
  }
}

export function gravarEscolha(mudanca, storage) {
  return gravarTexto(CHAVE_INSTALACAO, JSON.stringify({ ...lerEscolha(storage), ...mudanca }), storage);
}

/**
 * @param {{ comoApp: boolean, safariIos: boolean, podeInstalar: boolean, escolha: object }} estado
 * @returns {'botao' | 'dica-ios' | null}
 */
export function oQueMostrar({ comoApp, safariIos, podeInstalar, escolha = {} }) {
  if (comoApp) return null;
  if (podeInstalar && !escolha.android) return 'botao';
  if (safariIos && !escolha.ios) return 'dica-ios';
  return null;
}
