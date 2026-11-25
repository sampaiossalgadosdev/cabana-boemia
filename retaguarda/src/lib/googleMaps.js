/**
 * Carrega o Google Maps JavaScript uma vez (sob demanda, só nas telas com mapa).
 * A chave é a da RETAGUARDA (GOOGLE_MAPS_WEB_KEY, restrita aos domínios de /admin),
 * entregue pela API; a do servidor nunca chega aqui.
 */
let carregando = null;

export function carregarGoogleMaps(chave) {
  if (!chave) return Promise.reject(new Error('Mapa não configurado.'));
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (carregando) return carregando;
  carregando = new Promise((resolve, reject) => {
    const nome = '__taakiMapaPronto';
    window[nome] = () => {
      delete window[nome];
      resolve(window.google.maps);
    };
    const script = document.createElement('script');
    const q = new URLSearchParams({ key: chave, v: 'weekly', language: 'pt-BR', region: 'BR', loading: 'async', callback: nome });
    script.src = `https://maps.googleapis.com/maps/api/js?${q}`;
    script.async = true;
    script.onerror = () => {
      carregando = null;
      reject(new Error('Não foi possível carregar o mapa.'));
    };
    document.head.appendChild(script);
  });
  return carregando;
}
