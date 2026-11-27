/**
 * Páginas públicas em HTML puro servidas pela própria API (fora do site e do
 * /api): /excluir-conta, /privacidade-app e /termos-app. Sem script, sem
 * recurso externo, CSP fechada, sem cache. Cores do Taaki Delivery (CORES_TAAKI).
 */
export const CSP_PAGINA = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/**
 * Paleta do Taaki Delivery (do logo): azul-marinho, laranja, laranja claro,
 * branco e o destaque (usar pouco). `laranjaTexto` = laranja escurecido para
 * texto sobre fundo claro (4,5:1 contra o branco; o laranja puro dá só 3:1).
 */
export const CORES_TAAKI = Object.freeze({
  marinho: '#0A1428',
  laranja: '#F26B1D',
  laranjaClaro: '#FD9502',
  branco: '#FFFFFF',
  destaque: '#E02502',
  laranjaTexto: '#B4470A',
  textoSuaveEscuro: '#B7C1D1',
});

export const escapar = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const C = CORES_TAAKI;
// Paleta do Taaki: cabeçalho azul-marinho com filete laranja, fundo claro neutro,
// links e erros em laranja escurecido (legível no branco), botão laranja com
// texto marinho (6:1; o branco sobre o laranja daria só 3:1).
const ESTILO = `
body{margin:0;background:#F5F7FA;color:${C.marinho};font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{background:${C.marinho};color:${C.branco};padding:20px 16px;border-bottom:4px solid ${C.laranja}}header h1{margin:0;font-size:22px}
main{max-width:720px;margin:0 auto;padding:16px}section,form,.ok{background:${C.branco};border:1px solid #DCE2EA;border-radius:14px;padding:16px;margin:16px 0}
h2{font-size:18px;margin:0 0 8px}ul{padding-left:20px;margin:8px 0}li{margin:4px 0}p{margin:8px 0}a{color:${C.laranjaTexto}}
label{display:block;margin:12px 0 0;font-weight:600}
input,textarea{display:block;box-sizing:border-box;width:100%;margin-top:4px;padding:10px;border:1px solid #C9D1DD;border-radius:10px;font:inherit;font-weight:400;color:${C.marinho}}
input:focus,textarea:focus,button:focus-visible,a:focus-visible{outline:3px solid ${C.laranjaClaro};outline-offset:2px}
button{margin-top:16px;width:100%;padding:14px;border:0;border-radius:10px;background:${C.laranja};color:${C.marinho};font:inherit;font-weight:700;cursor:pointer}
button:hover{background:${C.laranjaClaro}}
.erro{color:${C.destaque};margin:4px 0 0}.ok{border-left:4px solid #2E7D4F}.isca{position:absolute;left:-9999px}small,.nota{color:#4B5568}
footer{max-width:720px;margin:0 auto;padding:0 16px 32px;color:#4B5568;font-size:14px}`;

/** Domínio principal do Taaki quando ninguém informa outro (canonical e link do início). */
export const ORIGEM_TAAKI_PADRAO = 'https://taakidelivery.com.br';

/**
 * Documento completo. `corpo` já é HTML (escapar o que vier do usuário antes).
 * `descricao` = meta description; `caminho` = caminho da página, para o canonical
 * absoluto no domínio principal (`origem`): estas páginas também abrem pelo
 * domínio da Cabana e pelo api., e o Google deve indexar uma só.
 */
export function documento({ titulo, corpo, rodape = '', descricao = '', caminho = '', origem = ORIGEM_TAAKI_PADRAO }) {
  const meta = [
    descricao ? `<meta name="description" content="${escapar(descricao)}">` : '',
    caminho ? `<link rel="canonical" href="${escapar(origem)}${escapar(caminho)}">` : '',
  ].filter(Boolean).join('\n');
  const inicio = `<a href="${escapar(origem)}/">Início do Taaki Delivery</a>`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)} · Taaki Delivery</title>
${meta ? `${meta}\n` : ''}<style>${ESTILO}</style></head><body>
<header><h1>${escapar(titulo)} · Taaki Delivery</h1></header>
<main>${corpo}</main>
<footer>${rodape ? `${rodape} · ` : ''}${inicio}</footer>
</body></html>`;
}

export function responderPagina(res, status, html, { indexar = false } = {}) {
  res.status(status).set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': CSP_PAGINA,
    ...(indexar ? {} : { 'X-Robots-Tag': 'noindex' }),
  });
  res.send(html);
}
