/**
 * Landing do Taaki Delivery (raiz dos domínios do Taaki; ver lib/dominios.js).
 *
 * HTML e CSS gerados aqui, mobile first, **sem nenhum script executável** (o
 * "Em breve" é uma âncora, o FAQ é <details>, o iPhone é detectado no servidor
 * em /app). O único <script> é o bloco de dados JSON-LD (type
 * application/ld+json), que o navegador não executa: a CSP não precisa liberá-lo.
 * Recursos só do próprio servidor (logo, ícones, imagem de compartilhamento e as
 * fontes: só Montserrat nos títulos e Poppins no texto, dos pacotes @fontsource, OFL).
 *
 * Regras do texto (decisão do dono): nenhum número, depoimento, avaliação, nome
 * de loja ou logo de parceiro inventado; nada que o app ainda não tem
 * (entregadores da plataforma, rastreio no mapa, status do pedido para o
 * cliente). O pagamento é no app, ao finalizar o pedido, pelo Mercado Pago
 * (decisão do dono, 2026-11-26). Conferido em test/dominios.test.js.
 */
import { CORES_TAAKI as C, escapar } from './paginaPublica.js';
import { linkHttps } from './dominios.js';
import { DOCUMENTOS_APP } from './controlador.js';

/** Sem script; imagem, fonte e manifesto só do próprio servidor. */
export const CSP_LANDING =
  "default-src 'none'; img-src 'self'; font-src 'self'; style-src 'unsafe-inline'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const CAMINHO_LOGO_TAAKI = '/taaki/logo.jpg';
export const CAMINHO_FAVICON_TAAKI = '/taaki/favicon.svg';
export const CAMINHO_ICONE_TAAKI = '/taaki/icone-180.png';
export const CAMINHO_COMPARTILHAR_TAAKI = '/taaki/compartilhar.jpg';
export const CAMINHO_MANIFESTO_TAAKI = '/site.webmanifest';
/** Tamanho real de shared/assets/logo-taaki-320.jpg (vai no JSON-LD). */
const LADO_LOGO = 320;
/**
 * Última mudança de conteúdo da landing (vai no <lastmod> do sitemap).
 * Mudou o texto da página: atualizar esta data.
 */
export const ATUALIZADO_LANDING = '2026-11-27';
/**
 * Fontes da landing (só estas duas, decisão do dono): Montserrat 800 nos títulos e
 * Poppins 400/600/700 no texto. Caminho público → arquivo latim do @fontsource.
 */
export const FONTES_TAAKI = {
  '/taaki/montserrat-800.woff2': { pacote: '@fontsource/montserrat', arquivo: 'montserrat-latin-800-normal.woff2', familia: 'Montserrat', peso: 800 },
  '/taaki/poppins-400.woff2': { pacote: '@fontsource/poppins', arquivo: 'poppins-latin-400-normal.woff2', familia: 'Poppins', peso: 400 },
  '/taaki/poppins-600.woff2': { pacote: '@fontsource/poppins', arquivo: 'poppins-latin-600-normal.woff2', familia: 'Poppins', peso: 600 },
  '/taaki/poppins-700.woff2': { pacote: '@fontsource/poppins', arquivo: 'poppins-latin-700-normal.woff2', familia: 'Poppins', peso: 700 },
};
/** Pré-carregadas no <head> (as da primeira dobra). */
const FONTES_PRECARREGAR = ['/taaki/montserrat-800.woff2', '/taaki/poppins-400.woff2'];

/** Favicon: o pino laranja sobre o azul-marinho (nítido a 16 px, ao contrário do logo). */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${C.marinho}"/><path d="M32 9c-9.6 0-17.4 7.6-17.4 17C14.6 38.6 32 55 32 55s17.4-16.4 17.4-29C49.4 16.6 41.6 9 32 9z" fill="${C.laranja}"/><circle cx="32" cy="26.5" r="6.6" fill="${C.marinho}"/></svg>`;

/** Resposta da FAQ do iPhone quando TAAKI_FAQ_IPHONE está vazio. */
export const TEXTO_IPHONE_PADRAO = 'A versão para Android sai primeiro. A de iPhone vem em seguida.';

/**
 * Configuração da landing pelo ambiente:
 *  - TAAKI_APP_LANCADO: "sim" = o app está na loja e "Quero pedir" vai para /app;
 *    qualquer outro valor (ou vazio) = modo "Em breve" (o botão leva à seção que
 *    explica a fase de testes).
 *  - TAAKI_FAQ_IPHONE: resposta da pergunta "O app funciona no iPhone?".
 *  - TAAKI_INSTAGRAM_URL: perfil do Instagram (só https; vazio = sem link).
 */
export function lerConfigLanding(env = process.env) {
  return {
    appLancado: String(env.TAAKI_APP_LANCADO ?? '').trim().toLowerCase() === 'sim',
    textoIphone: String(env.TAAKI_FAQ_IPHONE ?? '').trim() || TEXTO_IPHONE_PADRAO,
    instagramUrl: limparLink(linkHttps(env.TAAKI_INSTAGRAM_URL)),
  };
}

/**
 * Tira parâmetros de rastreio, âncora e a barra final de um link (o do Instagram
 * veio de um QR com ?igsh=…&utm_source=qr): "https://www.instagram.com/taakidelivery".
 */
export function limparLink(url) {
  if (!url) return null;
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/+$/, '');
}

/** Ano corrente em Brasília (rodapé). */
const anoAtual = (agora = new Date()) =>
  new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(agora);

// Ícones (24×24, traço, cor do texto). Decorativos: aria-hidden.
const ICONES = {
  loja: '<path d="M4 4h16l1.5 5h-19z"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/>',
  sacola: '<path d="M5.5 8h13l-1 12h-11z"/><path d="M9 8a3 3 0 0 1 6 0"/><path d="M9.5 13.5l2 2 3.5-3.5"/>',
  casa: '<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
  pino: '<path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  grade: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  nota: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9.5 12h6M9.5 16h6"/>',
  cadeado: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
  impressora: '<path d="M7 9V4h10v5"/><rect x="3.5" y="9" width="17" height="7" rx="2"/><path d="M7 14h10v6H7z"/>',
  ajustes: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  relogio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  lupa: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  email: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
};
const icone = (nome, classe = 'icone') =>
  `<svg class="${classe}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONES[nome]}</svg>`;

const ESTILO = `
${Object.entries(FONTES_TAAKI)
  .map(([url, f]) => `@font-face{font-family:"${f.familia}";src:url(${url}) format("woff2");font-weight:${f.peso};font-style:normal;font-display:swap}`)
  .join('\n')}
:root{--marinho:${C.marinho};--marinho-2:#13213D;--laranja:${C.laranja};--laranja-claro:${C.laranjaClaro};--branco:${C.branco};
--laranja-texto:${C.laranjaTexto};--suave-escuro:${C.textoSuaveEscuro};--suave:#4B5568;--fundo:#F5F7FA;--borda:#DCE2EA;
--titulo:"Montserrat",sans-serif;--alto-topo:60px}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:calc(var(--alto-topo) + 12px)}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;background:var(--branco);color:var(--marinho);font:16px/1.6 "Poppins",sans-serif;overflow-x:hidden}
img,svg{display:block;max-width:100%}
a{color:inherit}
h1,h2,h3{font-family:var(--titulo);font-weight:800;line-height:1.1;letter-spacing:-.02em;margin:0}
p{margin:0}
.envelope{width:100%;max-width:1120px;margin:0 auto;padding:0 16px}
a:focus-visible,summary:focus-visible{outline:3px solid var(--laranja-claro);outline-offset:3px;border-radius:6px}
.pular{position:absolute;left:8px;top:-60px;z-index:20;padding:10px 14px;border-radius:10px;background:var(--laranja);color:var(--marinho);font-weight:700;text-decoration:none}
.pular:focus{top:8px}

/* Topo fixo */
.topo{position:sticky;top:0;z-index:10;background:var(--marinho);color:var(--branco);border-bottom:1px solid rgba(255,255,255,.08)}
.topo .envelope{height:var(--alto-topo);display:flex;align-items:center;gap:10px}
.marca{display:flex;align-items:center;gap:9px;text-decoration:none;margin-right:auto;min-width:0}
.marca img{width:36px;height:36px;border-radius:50%;box-shadow:0 0 0 2px var(--laranja)}
.marca span{font-family:var(--titulo);font-weight:800;font-size:17px;letter-spacing:-.01em;white-space:nowrap}
.topo-parceiro{font-size:14px;font-weight:600;color:var(--suave-escuro);text-decoration:none;padding:8px 4px;white-space:nowrap}
.topo-parceiro:hover{color:var(--branco);text-decoration:underline}
.topo-pedir{padding:9px 14px;border-radius:999px;background:var(--laranja);color:var(--marinho);font-weight:700;font-size:14px;text-decoration:none;white-space:nowrap}
.topo-pedir:hover{background:var(--laranja-claro)}
@media (max-width:429px){.topo .marca-resto{display:none}}

/* Botões */
.botoes{display:grid;gap:12px}
.botao{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px 10px;min-height:54px;padding:12px 22px;border-radius:14px;
font-weight:700;font-size:17px;text-decoration:none;text-align:center;border:2px solid transparent;transition:background-color .15s,border-color .15s}
.botao .icone{width:20px;height:20px}
.botao--principal{background:var(--laranja);color:var(--marinho)}
.botao--principal:hover{background:var(--laranja-claro)}
.botao--contorno{border-color:rgba(255,255,255,.6);color:var(--branco)}
.botao--contorno:hover{border-color:var(--branco);background:rgba(255,255,255,.07)}
.botao--escuro{background:var(--marinho);color:var(--branco)}
.botao--escuro:hover{background:var(--marinho-2)}
.selo{display:inline-block;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.01em;background:var(--marinho);color:var(--laranja-claro);white-space:normal;max-width:100%}
.botao--escuro .selo{background:var(--laranja);color:var(--marinho)}

/* Hero */
.hero{position:relative;background:var(--marinho);color:var(--branco);overflow:hidden;
background-image:radial-gradient(520px 340px at 85% 0%,rgba(242,107,29,.22),transparent 70%),radial-gradient(420px 300px at 0% 100%,rgba(253,149,2,.10),transparent 70%)}
.hero .envelope{display:grid;gap:22px;padding-top:24px;padding-bottom:36px}
.hero-logo{width:112px;height:112px;border-radius:50%;box-shadow:0 0 0 3px var(--laranja),0 14px 44px rgba(242,107,29,.35)}
.hero h1{font-size:clamp(32px,9vw,60px)}
.hero h1 em{font-style:normal;color:var(--laranja-claro)}
.hero .botoes{margin-top:24px}
.hero-sub{margin-top:12px;font-size:18px;color:var(--suave-escuro);max-width:34em}

/* Seções */
.secao{padding:56px 0}
.secao--clara{background:var(--fundo)}
.secao--escura{background:var(--marinho);color:var(--branco)}
.rotulo{display:inline-block;margin-bottom:10px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--laranja-texto)}
.secao--escura .rotulo{color:var(--laranja-claro)}
.secao h2{font-size:clamp(28px,7vw,42px);max-width:20em}
.intro{margin-top:12px;font-size:17px;color:var(--suave);max-width:38em}
.secao--escura .intro{color:var(--suave-escuro)}

/* Em breve */
.em-breve{background:#FFF1E6;border-top:4px solid var(--laranja)}
.em-breve .envelope{display:grid;gap:14px;padding-top:36px;padding-bottom:36px}
.em-breve h2{font-size:clamp(24px,6vw,32px)}
.em-breve p{color:#3A4458;max-width:40em}
.em-breve .acoes{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center}
.link-forte{font-weight:700;color:var(--laranja-texto)}
.em-breve .botao{min-height:46px;padding:10px 18px;font-size:15px}

/* Como funciona */
.passos{list-style:none;margin:32px 0 0;padding:0;display:grid;gap:16px;counter-reset:passo}
.passo{position:relative;padding:22px 20px 22px 20px;border-radius:18px;background:var(--branco);border:1px solid var(--borda)}
.passo-topo{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.bolha{display:grid;place-items:center;width:46px;height:46px;border-radius:14px;background:var(--marinho);color:var(--laranja-claro);flex:none}
.passo-num{font-family:var(--titulo);font-weight:800;font-size:15px;color:var(--laranja-texto)}
.passo h3{font-size:22px}
.passo p{color:var(--suave)}

/* Por que */
.cartoes{display:grid;gap:14px;margin-top:32px}
.cartao{display:flex;gap:14px;padding:20px;border-radius:18px;background:var(--fundo);border:1px solid var(--borda)}
.cartao .bolha{background:var(--laranja);color:var(--marinho);width:44px;height:44px;border-radius:50%}
.secao--clara .cartao{background:var(--branco)}
.cartao h3{font-size:19px;margin-bottom:4px}
.cartao p{color:var(--suave)}

/* Parceiros */
.parceiros{background-image:radial-gradient(500px 320px at 100% 100%,rgba(242,107,29,.18),transparent 70%)}
.parceiros .botao{flex-wrap:nowrap}
.vantagens{list-style:none;margin:28px 0 32px;padding:0;display:grid;gap:12px}
.vantagens li{display:flex;gap:14px;align-items:flex-start;padding:16px;border-radius:16px;background:var(--marinho-2);border:1px solid rgba(255,255,255,.07)}
.vantagens .icone{color:var(--laranja-claro);flex:none;margin-top:2px}
.vantagens strong{display:block;font-size:17px}
.vantagens span{color:var(--suave-escuro)}

/* FAQ */
.faq{margin-top:28px;display:grid;gap:10px;max-width:780px}
.faq details{border:1px solid var(--borda);border-radius:14px;background:var(--branco)}
.faq details[open]{border-color:var(--laranja)}
.faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 18px;font-weight:700;font-size:17px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"";flex:none;width:12px;height:12px;border-right:2.5px solid var(--laranja-texto);border-bottom:2.5px solid var(--laranja-texto);transform:rotate(45deg) translate(-3px,-3px);transition:transform .2s}
.faq details[open] summary::after{transform:rotate(225deg) translate(-3px,-3px)}
.faq details p{padding:0 18px 18px;color:var(--suave)}
.faq a{color:var(--laranja-texto);font-weight:700}

/* Chamada final */
.chamada{background:var(--laranja);color:var(--marinho)}
.chamada .envelope{display:grid;gap:20px;justify-items:start;padding-top:48px;padding-bottom:48px}
.chamada h2{font-size:clamp(28px,7.5vw,46px)}

/* Rodapé */
.rodape{background:#060D1B;color:var(--suave-escuro);font-size:15px}
.rodape .envelope{display:grid;gap:18px;padding-top:36px;padding-bottom:36px}
.rodape .marca span{color:var(--branco);display:inline}
.rodape ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px 20px}
.rodape a{color:var(--branco)}
.rodape .pe{font-size:14px;border-top:1px solid rgba(255,255,255,.1);padding-top:16px}

/* 404 */
.pagina-404{min-height:100vh;display:flex;flex-direction:column}.pagina-404 main{flex:1}
.erro404 .envelope{display:grid;gap:16px;justify-items:start;padding-top:56px;padding-bottom:72px}
.erro404 .rotulo{color:var(--laranja-claro)}
.erro404 h1{font-size:clamp(32px,8vw,52px)}

@media (min-width:640px){
  .botoes{grid-template-columns:repeat(2,minmax(0,max-content))}
  .vantagens,.cartoes{grid-template-columns:1fr 1fr}
}
@media (min-width:900px){
  :root{--alto-topo:68px}
  .marca img{width:40px;height:40px}.marca span{font-size:19px}
  .topo .envelope{gap:18px}.topo-parceiro{font-size:15px}.topo-pedir{font-size:15px;padding:10px 18px}
  .hero .envelope{grid-template-columns:1.25fr .75fr;align-items:center;gap:48px;padding-top:72px;padding-bottom:88px}
  .hero-logo{order:2;justify-self:center;width:300px;height:300px;box-shadow:0 0 0 6px var(--laranja),0 0 0 18px rgba(242,107,29,.14),0 30px 90px rgba(242,107,29,.35)}
  .hero-sub{font-size:20px}
  .secao{padding:88px 0}
  .passos{grid-template-columns:repeat(3,1fr);gap:20px}
  .cartoes{grid-template-columns:repeat(4,1fr)}
  .cartao{flex-direction:column}
  .parceiros .envelope{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto 1fr;gap:28px 56px;align-items:start}
  .parceiros .vantagens{margin:0;grid-column:2;grid-row:1 / span 2;grid-template-columns:1fr}
  .chamada .envelope{grid-template-columns:1fr auto;align-items:center}
  .rodape .envelope{grid-template-columns:1fr auto;align-items:center}
  .rodape .pe{grid-column:1 / -1}
  .erro404 .envelope{grid-template-columns:1fr;gap:20px;padding-top:96px;padding-bottom:96px}
}`;

export const TEXTO_EM_BREVE = 'Em breve na Google Play e na App Store';

/** "Quero pedir" e "Pedir agora": /app com o app lançado; senão a seção "Em breve". */
function destinoPedir(appLancado, pagina = '') {
  return appLancado ? '/app' : `${pagina}#em-breve`;
}

function botaoPedir({ appLancado, classe = 'botao--principal' }) {
  const selo = appLancado ? '' : `<span class="selo">${TEXTO_EM_BREVE}</span>`;
  return `<a class="botao ${classe}" href="${destinoPedir(appLancado)}">Quero pedir${selo}</a>`;
}

function topo({ appLancado, pagina = '' }) {
  return `<a class="pular" href="#conteudo">Pular para o conteúdo</a>
<header class="topo"><div class="envelope">
  <a class="marca" href="/" aria-label="Taaki Delivery, início"><img src="${CAMINHO_LOGO_TAAKI}" width="40" height="40" alt=""><span>Taaki<span class="marca-resto"> Delivery</span></span></a>
  <a class="topo-parceiro" href="${pagina}#parceiros">Sou parceiro</a>
  <a class="topo-pedir" href="${destinoPedir(appLancado, pagina)}">Pedir agora</a>
</div></header>`;
}

function rodape({ email, ano }) {
  const contato = email ? `<p>Contato: <a href="mailto:${escapar(email)}">${escapar(email)}</a></p>` : '';
  return `<footer class="rodape"><div class="envelope">
  <div>
    <a class="marca" href="/"><img src="${CAMINHO_LOGO_TAAKI}" width="40" height="40" alt=""><span>Taaki Delivery · Abatiá-PR</span></a>
  </div>
  <nav aria-label="Documentos"><ul>
    <li><a href="/privacidade-app">Política de privacidade</a></li>
    <li><a href="/termos-app">Termos de uso</a></li>
    <li><a href="/excluir-conta">Excluir conta</a></li>
  </ul></nav>
  <div class="pe">${contato}<p>© ${ano} Taaki Delivery</p></div>
</div></footer>`;
}

function cabecalhoHtml({ titulo, descricao, origem = null, indexar = true, jsonLd = '' }) {
  // origem = https://<domínio principal do Taaki>: canonical e Open Graph sempre nele,
  // mesmo quando a página foi aberta por www. ou api. (evita conteúdo duplicado).
  const base = origem ? escapar(origem) : '';
  const og = origem
    ? `<meta property="og:type" content="website">
<meta property="og:site_name" content="Taaki Delivery">
<meta property="og:locale" content="pt_BR">
<meta property="og:url" content="${base}/">
<meta property="og:title" content="${escapar(titulo)}">
<meta property="og:description" content="${escapar(descricao)}">
<meta property="og:image" content="${base}${CAMINHO_COMPARTILHAR_TAAKI}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="500">
<meta property="og:image:alt" content="Logo do Taaki Delivery">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapar(titulo)}">
<meta name="twitter:description" content="${escapar(descricao)}">
<meta name="twitter:image" content="${base}${CAMINHO_COMPARTILHAR_TAAKI}">
<meta name="twitter:image:alt" content="Logo do Taaki Delivery">
<link rel="canonical" href="${base}/">`
    : '';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
<meta name="description" content="${escapar(descricao)}">
${indexar ? '<meta name="robots" content="index, follow, max-image-preview:large">' : '<meta name="robots" content="noindex">'}
<meta name="theme-color" content="${C.marinho}">
${og}
<link rel="icon" href="${CAMINHO_FAVICON_TAAKI}" type="image/svg+xml">
<link rel="icon" href="${CAMINHO_ICONE_TAAKI}" type="image/png" sizes="180x180">
<link rel="apple-touch-icon" href="${CAMINHO_ICONE_TAAKI}">
<link rel="manifest" href="${CAMINHO_MANIFESTO_TAAKI}">
${FONTES_PRECARREGAR.map((url) => `<link rel="preload" href="${url}" as="font" type="font/woff2" crossorigin>`).join('\n')}
<style>${ESTILO}</style>${jsonLd}</head>`;
}

export const TITULO_LANDING = 'Taaki Delivery · O delivery de Abatiá, num app só';
export const DESCRICAO_LANDING =
  'Veja o cardápio das lojas de Abatiá, faça seu pedido pelo app e receba na sua casa. Pagamento seguro pelo Mercado Pago.';

/**
 * @param {{ email?: string | null, appLancado?: boolean, textoIphone?: string,
 *   instagramUrl?: string | null, host?: string | null, agora?: Date }} [opcoes]
 *   email = CONTATO_TITULAR_EMAIL (vazio: sem contato no rodapé e sem "Quero ser parceiro");
 *   host = host da requisição (só hosts do Taaki chegam aqui);
 *   origem = https://<domínio principal>, para canonical, Open Graph e JSON-LD (padrão: o host).
 */
export function paginaLanding({
  email = null,
  appLancado = false,
  textoIphone = TEXTO_IPHONE_PADRAO,
  instagramUrl = null,
  host = null,
  origem = host ? `https://${host}` : null,
  agora = new Date(),
} = {}) {
  const contatoParceiro = email
    ? `mailto:${escapar(email)}?subject=${encodeURIComponent('Quero ser parceiro do Taaki Delivery')}`
    : null;

  const emBreve = appLancado
    ? ''
    : `<section class="em-breve" id="em-breve" aria-labelledby="titulo-em-breve"><div class="envelope">
  <span class="rotulo">${TEXTO_EM_BREVE}</span>
  <h2 id="titulo-em-breve">O app está em fase de testes</h2>
  <p>O Taaki Delivery ainda não está disponível para baixar. Estamos terminando os testes antes de publicar na Google Play e na App Store, e o lançamento será anunciado no nosso Instagram.</p>
  <div class="acoes">
    ${instagramUrl ? `<a class="botao botao--escuro" href="${escapar(instagramUrl)}" rel="noopener">Seguir no Instagram</a>` : ''}
    <a class="link-forte" href="#parceiros">Tem uma loja? Veja como ser parceiro</a>
  </div>
</div></section>`;

  const passos = [
    ['loja', 'Escolha a loja', 'Veja os cardápios das lojas abertas, com os preços atualizados.'],
    ['sacola', 'Faça o pedido', 'Monte o pedido, adicione observações e escolha um dos seus endereços salvos para a entrega.'],
    ['casa', 'Receba em casa', 'Ao enviar, você vê o número do pedido e a previsão de entrega. Depois é só aguardar; seus pedidos ficam no histórico.'],
  ];
  const motivos = [
    ['pino', 'Feito aqui', 'Um app da nossa região, para valorizar o comércio local.'],
    ['grade', 'Tudo num lugar só', 'Várias lojas no mesmo app, sem salvar um número de WhatsApp para cada uma.'],
    ['nota', 'Sem confusão no pedido', 'O pedido chega escrito para a loja, sem áudio, sem mensagem perdida.'],
    ['cadeado', 'Pagamento seguro', 'Você paga no app ao finalizar o pedido, com a segurança do Mercado Pago.'],
  ];
  const vantagens = [
    ['impressora', 'Pedidos organizados no caixa', 'Chegam no sistema de caixa (PDV) do seu computador e saem impressos.'],
    ['ajustes', 'Você no controle', 'Cardápio, preços, horários e taxas de entrega pelo painel da loja.'],
    ['relogio', 'Menos tempo no WhatsApp', 'Nada de ficar anotando pedido por mensagem ou áudio.'],
    ['lupa', 'Sua loja à vista', 'Ela aparece para quem já está procurando o que comer.'],
  ];

  const respostaParceiro = email
    ? `Mande um e-mail para <a href="${contatoParceiro}">${escapar(email)}</a> ou veja a seção <a href="#parceiros">Para parceiros</a>.`
    : 'Veja a seção <a href="#parceiros">Para parceiros</a>.';
  const perguntas = [
    ['Quais lojas estão no Taaki?', 'As lojas parceiras de Abatiá aparecem direto no app.'],
    ['Como eu pago?', 'O pagamento é feito no próprio app, na hora de finalizar o pedido, de forma segura pelo Mercado Pago.'],
    ['O app funciona no iPhone?', escapar(textoIphone)],
    [
      'Como faço para excluir minha conta?',
      'No app, em Perfil › Excluir minha conta, ou pela página <a href="/excluir-conta">Excluir conta</a>, mesmo sem o app instalado.',
    ],
    ['Tenho uma loja. Como entro no Taaki?', respostaParceiro],
  ];

  return `${cabecalhoHtml({
    titulo: TITULO_LANDING,
    descricao: DESCRICAO_LANDING,
    origem,
    jsonLd: origem ? blocoJsonLd({ origem, email, instagramUrl }) : '',
  })}<body>
${topo({ appLancado })}
<main id="conteudo">
<section class="hero" aria-labelledby="titulo-hero"><div class="envelope">
  <img class="hero-logo" src="${CAMINHO_LOGO_TAAKI}" width="320" height="320" alt="Logo do Taaki Delivery">
  <div>
    <h1 id="titulo-hero">O delivery de Abatiá, <em>num app só.</em></h1>
    <p class="hero-sub">Veja o cardápio das lojas da cidade, faça seu pedido e receba na sua casa.</p>
    <div class="botoes">
      ${botaoPedir({ appLancado })}
      <a class="botao botao--contorno" href="#parceiros">Sou parceiro</a>
    </div>
  </div>
</div></section>
${emBreve}
<section class="secao" id="como-funciona" aria-labelledby="titulo-como"><div class="envelope">
  <span class="rotulo">Como funciona</span>
  <h2 id="titulo-como">Do cardápio até a sua porta</h2>
  <ol class="passos">
    ${passos
      .map(
        ([i, t, d], n) => `<li class="passo"><div class="passo-topo"><span class="bolha">${icone(i)}</span><span class="passo-num">Passo ${n + 1}</span></div><h3>${t}</h3><p>${d}</p></li>`,
      )
      .join('\n    ')}
  </ol>
</div></section>
<section class="secao secao--clara" id="por-que" aria-labelledby="titulo-porque"><div class="envelope">
  <span class="rotulo">Por que pedir pelo Taaki</span>
  <h2 id="titulo-porque">Mais simples para você, melhor para a cidade</h2>
  <div class="cartoes">
    ${motivos
      .map(([i, t, d]) => `<div class="cartao"><span class="bolha">${icone(i)}</span><div><h3>${t}</h3><p>${d}</p></div></div>`)
      .join('\n    ')}
  </div>
</div></section>
<section class="secao secao--escura parceiros" id="parceiros" aria-labelledby="titulo-parceiros"><div class="envelope">
  <div>
    <span class="rotulo">Para parceiros</span>
    <h2 id="titulo-parceiros">Tem um negócio em Abatiá? Venda pelo Taaki.</h2>
    <p class="intro">Seus pedidos chegam prontos para preparar, e você cuida da loja pelo painel.</p>
  </div>
  <ul class="vantagens">
    ${vantagens.map(([i, t, d]) => `<li>${icone(i)}<div><strong>${t}</strong><span>${d}</span></div></li>`).join('\n    ')}
  </ul>
  <div class="botoes">
    ${contatoParceiro ? `<a class="botao botao--principal" href="${contatoParceiro}">${icone('email')}Quero ser parceiro</a>` : ''}
    <a class="botao botao--contorno" href="/parceiro" rel="nofollow">Acessar painel do parceiro${icone('seta')}</a>
  </div>
</div></section>
<section class="secao" id="perguntas" aria-labelledby="titulo-faq"><div class="envelope">
  <span class="rotulo">Dúvidas</span>
  <h2 id="titulo-faq">Perguntas frequentes</h2>
  <div class="faq">
    ${perguntas.map(([p, r]) => `<details><summary>${p}</summary><p>${r}</p></details>`).join('\n    ')}
  </div>
</div></section>
<section class="chamada" aria-labelledby="titulo-chamada"><div class="envelope">
  <h2 id="titulo-chamada">Bateu a fome? Peça pelo Taaki.</h2>
  ${botaoPedir({ appLancado, classe: 'botao--escuro' })}
</div></section>
</main>
${rodape({ email, ano: anoAtual(agora) })}
</body></html>`;
}

/** Página 404 dos domínios do Taaki (o site da Cabana não existe ali), com o topo e o rodapé da landing. */
export function paginaNaoEncontradaTaaki({ email = null, appLancado = false, agora = new Date() } = {}) {
  return `${cabecalhoHtml({ titulo: 'Página não encontrada · Taaki Delivery', descricao: 'Este endereço não existe no Taaki Delivery.', indexar: false })}<body class="pagina-404">
${topo({ appLancado, pagina: '/' })}
<main id="conteudo" class="hero erro404"><div class="envelope">
  <span class="rotulo">Erro 404</span>
  <h1>Página não encontrada</h1>
  <p class="hero-sub">Este endereço não existe no Taaki Delivery.</p>
  <a class="botao botao--principal" href="/">Ir para o início</a>
</div></main>
${rodape({ email, ano: anoAtual(agora) })}
</body></html>`;
}

/**
 * Dados estruturados (schema.org) da home: Organization, WebSite e WebPage.
 * Só fatos do próprio site: nada de telefone, endereço, CNPJ ou avaliação.
 * Sem FAQPage (o Google não mostra mais esse resultado) e sem MobileApplication
 * enquanto o app não estiver publicado.
 * TODO (lançamento, TAAKI_APP_LANCADO=sim): acrescentar um MobileApplication
 * (name, operatingSystem "ANDROID", applicationCategory "FoodApplication",
 * url/installUrl = link da Google Play, offers com price 0 e priceCurrency "BRL").
 */
export function dadosEstruturados({ origem, email = null, instagramUrl = null }) {
  const org = `${origem}/#organization`;
  const site = `${origem}/#website`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org,
        name: 'Taaki Delivery',
        url: `${origem}/`,
        logo: { '@type': 'ImageObject', url: `${origem}${CAMINHO_LOGO_TAAKI}`, width: LADO_LOGO, height: LADO_LOGO },
        image: `${origem}${CAMINHO_COMPARTILHAR_TAAKI}`,
        ...(email && { email }),
        ...(instagramUrl && { sameAs: [instagramUrl] }),
        areaServed: { '@type': 'City', name: 'Abatiá', containedInPlace: { '@type': 'State', name: 'Paraná' } },
      },
      { '@type': 'WebSite', '@id': site, url: `${origem}/`, name: 'Taaki Delivery', inLanguage: 'pt-BR', publisher: { '@id': org } },
      {
        '@type': 'WebPage',
        '@id': `${origem}/#webpage`,
        url: `${origem}/`,
        name: TITULO_LANDING,
        description: DESCRICAO_LANDING,
        inLanguage: 'pt-BR',
        isPartOf: { '@id': site },
        about: { '@id': org },
        primaryImageOfPage: { '@type': 'ImageObject', url: `${origem}${CAMINHO_COMPARTILHAR_TAAKI}` },
      },
    ],
  };
}

/** <script type="application/ld+json"> com "<" escapado (nenhum texto fecha o bloco antes da hora). */
function blocoJsonLd(opcoes) {
  const json = JSON.stringify(dadosEstruturados(opcoes)).replace(/</g, '\\u003c');
  return `\n<script type="application/ld+json">${json}</script>`;
}

/**
 * robots.txt dos hosts do Taaki. O /parceiro (painel) NÃO é bloqueado aqui de
 * propósito: bloqueado, o Google não leria o noindex e poderia listar o endereço
 * sem conteúdo. Ele sai com X-Robots-Tag noindex.
 */
export function textoRobots(origem) {
  return `User-agent: *
Disallow: /api/

Sitemap: ${origem}/sitemap.xml
`;
}

/**
 * sitemap.xml: só as páginas indexáveis (/excluir-conta é noindex e fica de fora).
 * lastmod = data da última mudança de conteúdo (landing: ATUALIZADO_LANDING;
 * páginas legais: a versão dos documentos do app).
 */
export function sitemapXml(origem) {
  const urls = [
    ['/', ATUALIZADO_LANDING, '1.0'],
    ['/privacidade-app', DOCUMENTOS_APP.versao, '0.3'],
    ['/termos-app', DOCUMENTOS_APP.versao, '0.3'],
  ];
  const linhas = urls.map(([c, d, p]) => `  <url><loc>${escapar(origem)}${c}</loc><lastmod>${d}</lastmod><priority>${p}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${linhas.join('\n')}
</urlset>
`;
}

/** llms.txt: resumo em Markdown para assistentes de IA, só com o que já está no site. */
export function textoLlms({ origem, email = null, instagramUrl = null, appLancado = false }) {
  const situacao = appLancado
    ? '- O app Taaki Delivery já pode ser baixado.'
    : '- O app está em fase de testes e ainda não está disponível para baixar. A versão para Android sai primeiro; o lançamento será anunciado no Instagram.';
  return `# Taaki Delivery

> App de delivery de Abatiá-PR: reúne o cardápio das lojas parceiras da cidade num app só. O cliente escolhe a loja, faz o pedido e recebe em casa.

## Situação
${situacao}

## Para clientes
- Veja o cardápio das lojas abertas, com os preços atualizados.
- Monte o pedido, adicione observações e escolha um dos seus endereços salvos para a entrega.
- Ao enviar, você vê o número do pedido e a previsão de entrega; os pedidos ficam no histórico.
- O pagamento é feito no próprio app, ao finalizar o pedido, de forma segura pelo Mercado Pago.

## Para lojas parceiras
- Os pedidos chegam no sistema de caixa (PDV) do computador da loja e saem impressos.
- A loja cuida do cardápio, dos preços, dos horários e das taxas de entrega pelo painel.
${email ? `- Para ser parceiro, escreva para ${email}.\n` : ''}
## Páginas
- [Início](${origem}/)
- [Política de privacidade](${origem}/privacidade-app)
- [Termos de uso](${origem}/termos-app)
- [Excluir conta](${origem}/excluir-conta)
${instagramUrl ? `- [Instagram](${instagramUrl})\n` : ''}`;
}

/** Manifesto simples (nome, ícone e cores). A landing não é um app instalável. */
export function manifestoTaaki() {
  return JSON.stringify({
    name: 'Taaki Delivery',
    short_name: 'Taaki',
    description: DESCRICAO_LANDING,
    lang: 'pt-BR',
    start_url: '/',
    display: 'browser',
    background_color: C.marinho,
    theme_color: C.marinho,
    icons: [{ src: CAMINHO_ICONE_TAAKI, sizes: '180x180', type: 'image/png' }],
  });
}
