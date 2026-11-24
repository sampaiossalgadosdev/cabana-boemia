/**
 * Landing do Taaki Delivery (raiz dos domínios do Taaki; ver lib/dominios.js).
 * HTML puro gerado aqui: sem script, sem recurso externo (só o logo, do próprio
 * servidor), leve e responsivo. Nenhum número, depoimento ou dado inventado.
 */
import { CORES_TAAKI as C, escapar } from './paginaPublica.js';

/** Imagem e scripts só do próprio servidor; nada de script. */
export const CSP_LANDING =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const CAMINHO_LOGO_TAAKI = '/taaki/logo.jpg';

const ESTILO = `
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;display:flex;flex-direction:column;background:${C.marinho};color:${C.branco};
font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{flex:1;width:100%;max-width:560px;margin:0 auto;padding:48px 16px 32px;text-align:center}
.logo{display:block;width:152px;height:152px;margin:0 auto 20px;border-radius:50%;box-shadow:0 0 0 4px ${C.laranja},0 12px 40px rgba(242,107,29,.25)}
h1{margin:0;font-size:32px;line-height:1.2;font-weight:800;letter-spacing:-.01em}
.frase{margin:8px 0 36px;font-size:18px;color:${C.laranjaClaro};font-weight:600}
nav{display:grid;gap:14px}
.caminho{display:block;padding:18px 20px;border-radius:16px;text-decoration:none;text-align:left;border:2px solid transparent}
.caminho strong{display:block;font-size:20px;line-height:1.3}
.caminho span{display:block;margin-top:2px;font-size:15px}
.pedir{background:${C.laranja};color:${C.marinho}}
.pedir:hover{background:${C.laranjaClaro}}
.parceiro{border-color:rgba(255,255,255,.55);color:${C.branco}}
.parceiro:hover{border-color:${C.branco};background:rgba(255,255,255,.06)}
.parceiro span{color:${C.textoSuaveEscuro}}
a:focus-visible{outline:3px solid ${C.laranjaClaro};outline-offset:3px}
footer{width:100%;max-width:560px;margin:0 auto;padding:24px 16px 32px;text-align:center;font-size:14px;color:${C.textoSuaveEscuro};border-top:1px solid rgba(255,255,255,.12)}
footer ul{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px}
footer a{color:${C.branco}}
footer p{margin:4px 0}
@media (min-width:600px){main{padding-top:72px}.logo{width:176px;height:176px}h1{font-size:40px}nav{grid-template-columns:1fr 1fr}}`;

/**
 * @param {{ email?: string | null }} [opcoes] e-mail de contato (CONTATO_TITULAR_EMAIL;
 *   vazio = o rodapé fica só com os links).
 */
export function paginaLanding({ email = null } = {}) {
  const contato = email ? `<p>Contato: <a href="mailto:${escapar(email)}">${escapar(email)}</a></p>` : '';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Taaki Delivery · Delivery das lojas de Abatiá e região</title>
<meta name="description" content="Taaki Delivery: delivery das lojas de Abatiá e região. Baixe o app para pedir ou acesse o painel da sua loja.">
<meta name="theme-color" content="${C.marinho}">
<meta property="og:title" content="Taaki Delivery">
<meta property="og:description" content="Delivery das lojas de Abatiá e região">
<link rel="icon" href="${CAMINHO_LOGO_TAAKI}" type="image/jpeg">
<link rel="apple-touch-icon" href="${CAMINHO_LOGO_TAAKI}">
<style>${ESTILO}</style></head><body>
<main>
  <img class="logo" src="${CAMINHO_LOGO_TAAKI}" width="176" height="176" alt="Logo do Taaki Delivery">
  <h1>Taaki Delivery</h1>
  <p class="frase">Delivery das lojas de Abatiá e região</p>
  <nav aria-label="Escolha como continuar">
    <a class="caminho pedir" href="/app"><strong>Quero pedir</strong><span>Baixe o app e faça seu pedido.</span></a>
    <a class="caminho parceiro" href="/parceiro"><strong>Sou parceiro</strong><span>Acesse o painel da sua loja.</span></a>
  </nav>
</main>
<footer>
  <ul>
    <li><a href="/privacidade-app">Política de privacidade</a></li>
    <li><a href="/termos-app">Termos de uso</a></li>
    <li><a href="/excluir-conta">Excluir conta</a></li>
  </ul>
  ${contato}
</footer>
</body></html>`;
}

/** Página 404 dos domínios do Taaki (o site da Cabana não existe ali). */
export function paginaNaoEncontradaTaaki() {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Página não encontrada · Taaki Delivery</title>
<meta name="robots" content="noindex">
<style>${ESTILO}</style></head><body>
<main>
  <img class="logo" src="${CAMINHO_LOGO_TAAKI}" width="176" height="176" alt="Logo do Taaki Delivery">
  <h1>Página não encontrada</h1>
  <p class="frase">Este endereço não existe no Taaki Delivery.</p>
  <nav><a class="caminho pedir" href="/"><strong>Ir para o início</strong></a></nav>
</main>
</body></html>`;
}
