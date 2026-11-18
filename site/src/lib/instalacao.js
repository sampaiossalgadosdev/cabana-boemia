/**
 * Convite para instalar o site como app (PWA). Lógica pura, testada.
 * - Cabeçalho: botão "Instalar app" quando o navegador oferece
 *   (`beforeinstallprompt`, Chrome/Edge/Samsung); some depois de instalado ou recusado.
 * - Celular: CONVITE_APOS_MS depois de entrar, sobe um cartão com o passo a
 *   passo do navegador de quem está vendo (ou o botão "Instalar", quando há).
 *   "Agora não" esconde por CONVITE_PAUSA_MS.
 * - Já aberto como app: nada.
 */
import { gravarTexto, lerTexto } from './armazenamento.js';

export const CHAVE_INSTALACAO = 'cabana-boemia:instalacao:v1';
export const CONVITE_APOS_MS = 10_000;
export const CONVITE_PAUSA_MS = 7 * 24 * 3600 * 1000;

/** Site aberto pelo ícone da tela inicial (Android: display-mode; iOS: navigator.standalone). */
export function estaComoApp(win = globalThis) {
  try {
    if (win.navigator?.standalone === true) return true;
    return Boolean(win.matchMedia?.('(display-mode: standalone)').matches);
  } catch {
    return false;
  }
}

const APP_INTERNO = /Instagram|FBAN|FBAV|FB_IAB|Line\/|WhatsApp|musical_ly|TikTok/;

/**
 * @returns {'ios-safari' | 'ios-outro' | 'android' | 'android-samsung' | 'app-interno' | 'computador'}
 * (o iPad se apresenta como Mac, mas tem toque)
 */
export function detectarNavegador({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  const android = /Android/.test(userAgent);
  if (!ios && !android) return 'computador';
  if (APP_INTERNO.test(userAgent)) return 'app-interno';
  if (ios) {
    const safari = /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(userAgent);
    return safari ? 'ios-safari' : 'ios-outro';
  }
  return /SamsungBrowser/.test(userAgent) ? 'android-samsung' : 'android';
}

/** @returns {{ android?: 'instalado' | 'dispensado', conviteFechadoEm?: number }} */
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

/** Botão "Instalar app" do cabeçalho: só quando o navegador oferece a instalação. */
export function mostrarBotaoCabecalho({ comoApp, podeInstalar, escolha = {} }) {
  return !comoApp && podeInstalar && !escolha.android;
}

/** Cartão com o passo a passo (depois de CONVITE_APOS_MS): só no celular. */
export function mostrarConvite({ comoApp, navegador, escolha = {}, agora = Date.now() }) {
  if (comoApp || navegador === 'computador') return false;
  if (escolha.android === 'instalado') return false;
  const fechado = Number(escolha.conviteFechadoEm);
  return !(fechado && agora - fechado < CONVITE_PAUSA_MS);
}

/**
 * Texto do cartão. Com `podeInstalar` o navegador instala num toque (botão);
 * sem, o passo a passo do menu daquele navegador.
 * @returns {{ texto: string, passos: string[], nota?: string, botaoInstalar: boolean }}
 */
export function passosDoConvite(navegador, podeInstalar) {
  const texto = 'Tenha a Cabana Boemia na tela inicial e faça seu pedido em um toque.';
  if (podeInstalar) return { texto, passos: [], botaoInstalar: true };
  switch (navegador) {
    case 'ios-safari':
      return {
        texto,
        passos: [
          'Toque em Compartilhar (o quadrado com a seta para cima, na barra do Safari).',
          'Role e toque em Adicionar à Tela de Início.',
          'Toque em Adicionar.',
        ],
        botaoInstalar: false,
      };
    case 'ios-outro':
      return {
        texto,
        passos: [
          'Toque em Compartilhar (o quadrado com a seta para cima, ao lado do endereço).',
          'Toque em Adicionar à Tela de Início.',
        ],
        nota: 'Não achou? Abra este site no Safari e faça o mesmo.',
        botaoInstalar: false,
      };
    case 'app-interno':
      return {
        texto,
        passos: [
          'Toque nos três pontinhos no canto da tela.',
          'Escolha Abrir no navegador (Chrome ou Safari).',
          'No navegador, siga o aviso que vai aparecer.',
        ],
        botaoInstalar: false,
      };
    case 'android-samsung':
      return {
        texto,
        passos: ['Toque no menu ≡ (embaixo, à direita).', 'Toque em Adicionar página a.', 'Escolha Tela inicial.'],
        botaoInstalar: false,
      };
    default:
      return {
        texto,
        passos: [
          'Toque no menu ⋮ (no canto de cima, à direita).',
          'Toque em Instalar app ou Adicionar à tela inicial.',
        ],
        nota: 'Abriu pelo WhatsApp? No menu ⋮, toque antes em Abrir no Chrome.',
        botaoInstalar: false,
      };
  }
}
