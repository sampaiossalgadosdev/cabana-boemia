/*
 * Service worker do site (modelo). O build (pwa/plugin-sw.js) grava o
 * dist/sw.js com a VERSAO e a lista ARQUIVOS preenchidas.
 *
 * Cacheia só arquivos estáticos do build (JS, CSS, fontes, imagens, ícones,
 * splash, animação de confirmação e a página offline).
 * NUNCA intercepta /api (cardápio, preços, saldo, pedidos, login), /admin,
 * /socket.io, métodos que não são GET nem outros domínios (Google, fotos):
 * esses vão direto para a rede, como sem service worker.
 * Páginas (HTML): sempre da rede e nunca guardadas; sem rede, offline.html.
 * Versão nova: instala, entra na hora e apaga os caches das versões antigas.
 */
const VERSAO = '__VERSAO__';
const PREFIXO = 'cabana-site-';
const CACHE = PREFIXO + VERSAO;
const ARQUIVOS = /*ARQUIVOS*/[]/*FIM*/;
const OFFLINE = '/offline.html';
const NUNCA = /^\/(api|admin|socket\.io)(\/|$)/;
const ESTATICOS = /^\/(assets|icones|splash|confirmacao)\//;

/** @returns {'pagina' | 'estatico' | null} null = não intercepta */
function estrategia(req) {
  if (req.method !== 'GET') return null;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return null;
  if (NUNCA.test(url.pathname)) return null;
  if (req.mode === 'navigate') return 'pagina';
  if (ESTATICOS.test(url.pathname) || url.pathname === OFFLINE) return 'estatico';
  return null;
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ARQUIVOS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(nomes.filter((n) => n.startsWith(PREFIXO) && n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

function pagina(req) {
  return fetch(req).catch(() =>
    caches.match(OFFLINE, { cacheName: CACHE }).then((r) => r || Response.error()),
  );
}

function estatico(req) {
  return caches.match(req, { cacheName: CACHE }).then(
    (guardado) =>
      guardado ||
      fetch(req).then((resposta) => {
        if (resposta.ok && resposta.type === 'basic') {
          const copia = resposta.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copia)).catch(() => {});
        }
        return resposta;
      }),
  );
}

self.addEventListener('fetch', (evento) => {
  const tipo = estrategia(evento.request);
  if (tipo === 'pagina') evento.respondWith(pagina(evento.request));
  else if (tipo === 'estatico') evento.respondWith(estatico(evento.request));
});
