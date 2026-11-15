/**
 * Google Identity Services (botão "Entrar com Google"). O script é carregado
 * só quando o checkout pede login, uma vez por página.
 */
const URL_SCRIPT = 'https://accounts.google.com/gsi/client';

let carregando = null;

/** @returns {Promise<typeof window.google.accounts.id>} */
export function carregarGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  carregando ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = URL_SCRIPT;
    s.async = true;
    s.onload = () =>
      window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('GIS ausente'));
    s.onerror = () => {
      carregando = null; // permite tentar de novo
      s.remove();
      reject(new Error('Falha ao carregar o login do Google'));
    };
    document.head.appendChild(s);
  });
  return carregando;
}

// initialize() deve ser chamado uma vez por client ID; o callback muda a cada
// montagem do botão, então passa por esta referência.
let clientIdIniciado = null;
let aoReceberCredencial = () => {};

/**
 * Desenha o botão oficial em `elemento`. `onCredencial` recebe o ID token.
 * @returns {Promise<void>}
 */
export async function desenharBotaoGoogle(elemento, { clientId, onCredencial, largura }) {
  const gis = await carregarGoogle();
  aoReceberCredencial = onCredencial;
  if (clientIdIniciado !== clientId) {
    gis.initialize({
      client_id: clientId,
      callback: (resposta) => aoReceberCredencial(resposta.credential),
      auto_select: false,
      cancel_on_tap_outside: true,
      context: 'signin',
      ux_mode: 'popup',
      use_fedcm_for_button: true,
    });
    clientIdIniciado = clientId;
  }
  gis.renderButton(elemento, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    logo_alignment: 'left',
    locale: 'pt-BR',
    width: Math.min(400, Math.max(200, Math.round(largura || 320))),
  });
}
