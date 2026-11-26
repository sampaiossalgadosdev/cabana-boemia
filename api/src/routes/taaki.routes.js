import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ehHostTaaki, destinoDoApp } from '../lib/dominios.js';
import { createRequire } from 'node:module';
import {
  CAMINHO_COMPARTILHAR_TAAKI,
  CAMINHO_FAVICON_TAAKI,
  CAMINHO_ICONE_TAAKI,
  CAMINHO_LOGO_TAAKI,
  CSP_LANDING,
  FAVICON_SVG,
  FONTES_TAAKI,
  lerConfigLanding,
  paginaLanding,
  paginaNaoEncontradaTaaki,
} from '../lib/landing.js';

/**
 * Raiz dos domínios do Taaki (TAAKI_HOSTS). Montado no app.js depois da API, de
 * /excluir-conta e das páginas legais do app e ANTES do site da Cabana: em host
 * do Taaki responde tudo que não é /api, /admin ou /socket.io, então nada do
 * site da Cabana (index.html, /assets, manifest, sw.js, ícones, splash,
 * /privacidade, /termos, rotas da SPA) aparece ali. Em outro host não faz nada.
 *
 *   /           landing do Taaki (modo "Em breve" enquanto TAAKI_APP_LANCADO != "sim")
 *   /taaki/*    logo, favicon, ícone, imagem de compartilhamento e fonte da landing
 *   /app        302 para o app (TAAKI_APP_URL / TAAKI_APP_URL_IOS) com TAAKI_APP_LANCADO=sim;
 *               antes disso, para /#em-breve
 *   /parceiro   302 para a retaguarda (/admin/)
 *   /privacidade, /termos  302 para as do app (as do site são da Cabana)
 *   /sw.js      service worker que se desfaz (se alguém abriu o site da Cabana
 *               por este host antes da separação, o worker antigo sai)
 *   resto       404 em HTML do Taaki
 */
const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'shared', 'assets');
const ARQUIVOS = {
  [CAMINHO_LOGO_TAAKI]: path.join(ASSETS, 'logo-taaki-320.jpg'),
  [CAMINHO_ICONE_TAAKI]: path.join(ASSETS, 'taaki-icone-180.png'),
  [CAMINHO_COMPARTILHAR_TAAKI]: path.join(ASSETS, 'taaki-compartilhar-1024x500.jpg'),
  // Fontes (Montserrat e Poppins, latim, OFL), dos pacotes @fontsource da API.
  ...Object.fromEntries(
    Object.entries(FONTES_TAAKI).map(([url, f]) => [url, createRequire(import.meta.url).resolve(`${f.pacote}/files/${f.arquivo}`)]),
  ),
};

/** Caminhos que continuam iguais em todos os hosts. */
const COMPARTILHADOS = /^\/(api|admin|socket\.io)(\/|$)/;

/** Apaga os caches do site da Cabana e cancela o próprio registro. */
export const SW_QUE_SE_DESFAZ = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter((c) => c.startsWith('cabana-site-')).map((c) => caches.delete(c)));
    await self.registration.unregister();
  })());
});
`;

function html(res, status, corpo) {
  res.status(status).set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': CSP_LANDING,
  });
  res.send(corpo);
}

/**
 * @param {{ hosts: string[], destinosApp: { padrao: string, ios: string | null }, email?: string | null,
 *   landing?: ReturnType<typeof lerConfigLanding> }} opcoes
 */
export function criarRotasTaaki({ hosts, destinosApp, email = null, landing = lerConfigLanding() }) {
  const rotas = Router();

  rotas.use((req, res, next) => {
    if (!ehHostTaaki(req, hosts) || COMPARTILHADOS.test(req.path)) return next('router');
    if (req.method !== 'GET' && req.method !== 'HEAD') return next('router');
    return next();
  });

  // Gerada a cada pedido: o Open Graph usa o host (só hosts do Taaki chegam aqui) e o rodapé o ano.
  rotas.get('/', (req, res) => html(res, 200, paginaLanding({ ...landing, email, host: req.hostname })));
  rotas.get('/app', (req, res) => {
    // Antes do lançamento (TAAKI_APP_LANCADO != "sim") o app não está na loja: /app leva à seção "Em breve".
    const destino = landing.appLancado ? destinoDoApp(req.get('user-agent'), destinosApp) : '/#em-breve';
    res.set('Cache-Control', 'no-store').redirect(302, destino);
  });
  rotas.get('/parceiro', (req, res) => res.set('Cache-Control', 'no-store').redirect(302, '/admin/'));
  rotas.get('/privacidade', (req, res) => res.redirect(302, '/privacidade-app'));
  rotas.get('/termos', (req, res) => res.redirect(302, '/termos-app'));
  for (const [caminho, arquivo] of Object.entries(ARQUIVOS)) {
    rotas.get(caminho, (req, res, next) => {
      res.sendFile(arquivo, { headers: { 'Cache-Control': 'public, max-age=86400' } }, (erro) => erro && next(erro));
    });
  }
  rotas.get(CAMINHO_FAVICON_TAAKI, (req, res) => {
    res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }).send(FAVICON_SVG);
  });
  rotas.get('/sw.js', (req, res) => {
    res.status(200).set({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }).send(SW_QUE_SE_DESFAZ);
  });
  rotas.use((req, res) => html(res, 404, paginaNaoEncontradaTaaki({ email, appLancado: landing.appLancado })));
  return rotas;
}
