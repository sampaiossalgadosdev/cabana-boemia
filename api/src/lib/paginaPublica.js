/**
 * Páginas públicas em HTML puro servidas pela própria API (fora do site e do
 * /api): /excluir-conta, /privacidade-app e /termos-app. Sem script, sem
 * recurso externo, CSP fechada, sem cache. Cores da identidade atual.
 */
export const CSP_PAGINA = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export const escapar = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ESTILO = `
body{margin:0;background:#FBF3E8;color:#111;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{background:#C8102E;color:#FBF3E8;padding:20px 16px}header h1{margin:0;font-size:22px}
main{max-width:720px;margin:0 auto;padding:16px}section,form,.ok{background:#fff;border:1px solid #EADED0;border-radius:14px;padding:16px;margin:16px 0}
h2{font-size:18px;margin:0 0 8px}ul{padding-left:20px;margin:8px 0}li{margin:4px 0}p{margin:8px 0}a{color:#9E0B22}
label{display:block;margin:12px 0 0;font-weight:600}
input,textarea{display:block;box-sizing:border-box;width:100%;margin-top:4px;padding:10px;border:1px solid #EADED0;border-radius:10px;font:inherit;font-weight:400}
button{margin-top:16px;width:100%;padding:14px;border:0;border-radius:10px;background:#C8102E;color:#fff;font:inherit;font-weight:700}
.erro{color:#9E0B22;margin:4px 0 0}.ok{border-left:4px solid #2E7D4F}.isca{position:absolute;left:-9999px}small,.nota{color:#5E5249}
footer{max-width:720px;margin:0 auto;padding:0 16px 32px;color:#5E5249;font-size:14px}`;

/** Documento completo. `corpo` já é HTML (escapar o que vier do usuário antes). */
export function documento({ titulo, corpo, rodape = '' }) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)} · Delivery Abatiá</title>
<style>${ESTILO}</style></head><body>
<header><h1>${escapar(titulo)} · Delivery Abatiá</h1></header>
<main>${corpo}</main>
${rodape ? `<footer>${rodape}</footer>` : ''}
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
