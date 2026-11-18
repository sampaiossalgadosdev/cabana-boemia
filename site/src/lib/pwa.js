/**
 * PWA no navegador: registra o service worker (só no build de produção) e
 * guarda o `beforeinstallprompt`, que o Chrome dispara cedo (às vezes antes
 * do React montar). Importado no main.jsx antes do render.
 */
import { gravarEscolha } from './instalacao.js';

let promptGuardado = null;
const ouvintes = new Set();
const avisar = () => ouvintes.forEach((fn) => fn());

export function iniciarPwa() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault(); // o convite é o nosso botão, não a barra do Chrome
    promptGuardado = evento;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    promptGuardado = null;
    gravarEscolha({ android: 'instalado' });
    avisar();
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // sem service worker o site funciona igual (só não instala/offline)
      });
    });
  }
}

export const podeInstalar = () => promptGuardado !== null;

/** @returns {() => void} cancela a assinatura */
export function assinarInstalacao(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

/** Abre o diálogo do navegador. Recusou = não oferece mais. */
export async function pedirInstalacao() {
  const evento = promptGuardado;
  if (!evento) return;
  promptGuardado = null; // o evento só pode ser usado uma vez
  try {
    evento.prompt();
    const { outcome } = await evento.userChoice;
    // Recusou: some o botão do cabeçalho e o cartão descansa (CONVITE_PAUSA_MS).
    gravarEscolha(
      outcome === 'accepted' ? { android: 'instalado' } : { android: 'dispensado', conviteFechadoEm: Date.now() },
    );
  } catch {
    // prompt indisponível: só esconde o botão
  }
  avisar();
}
