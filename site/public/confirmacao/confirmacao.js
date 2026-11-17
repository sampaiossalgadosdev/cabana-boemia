/* Animação de pedido confirmado — Cabana Boemia
   Uso: CBConfirmacao.mostrar({ numero: '1234' }).then(() => { ...ir pra tela do pedido... })
   Opções: numero, titulo, subtitulo, coroa (caminho da imagem da coroa),
   dentro (onde pôr o overlay; padrão document.body. Num <dialog> modal aberto,
   passe o próprio dialog: o que fica fora dele aparece por trás) */
(function (w) {
  var CORO_PADRAO = '/confirmacao/logo-coroa.webp';

  var icones = {
    lanche: '<svg viewBox="-45 -40 90 80"><path d="M-40 0Q-40-34 0-34Q40-34 40 0Z" fill="#fff"/><rect x="-42" y="4" width="84" height="12" rx="6" fill="#fff"/><rect x="-40" y="20" width="80" height="12" rx="5" fill="#fff"/></svg>',
    batata: '<svg viewBox="-40 -45 80 90"><g fill="#fff"><rect x="-22" y="-40" width="8" height="40" rx="3"/><rect x="-10" y="-44" width="8" height="44" rx="3"/><rect x="2" y="-42" width="8" height="42" rx="3"/><rect x="14" y="-38" width="8" height="38" rx="3"/></g><path d="M-30-8H30L24 40H-24Z" fill="#fff"/></svg>',
    lata: '<svg viewBox="-30 -45 60 90"><rect x="-17" y="-38" width="34" height="76" rx="7" fill="#fff"/></svg>',
    marmita: '<svg viewBox="-50 -40 100 80"><rect x="-44" y="-16" width="88" height="10" rx="3" fill="#fff"/><path d="M-40-4H40L34 22H-34Z" fill="#fff"/><path d="M-12-24q-4-6 0-12M0-26q-4-6 0-12M12-24q-4-6 0-12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
    copo: '<svg viewBox="-35 -50 70 100"><rect x="2" y="-48" width="6" height="30" rx="3" fill="#fff" transform="rotate(14)"/><rect x="-28" y="-24" width="56" height="10" rx="4" fill="#fff"/><path d="M-24-14H24L18 44H-18Z" fill="#fff"/></svg>'
  };
  function faixa(cls) {
    var seq = icones.lanche + icones.batata + icones.copo + icones.marmita + icones.lata, h = '';
    for (var i = 0; i < 6; i++) h += seq;
    return '<div class="cbc-faixa ' + cls + '">' + h + '</div>';
  }

  function cena(coroa) {
    return '' +
'<svg class="cbc-cena" viewBox="40 92 220 250" aria-hidden="true">' +
' <ellipse cx="150" cy="330" rx="88" ry="9" fill="rgba(0,0,0,.18)"/>' +
' <g class="cbc-saco">' +
    /* fundo/boca do saco */
'  <g class="cbc-boca"><path d="M80 150 L84 112 96 108 108 112 120 108 132 112 144 108 156 112 168 108 180 112 192 108 204 112 216 108 L216 112 L220 150 Z" fill="#a8733f"/></g>' +
    /* itens caindo (somem atrás da frente do saco) */
'  <g transform="translate(160 200)"><g class="cbc-cai i5">' +
'   <path d="M-40-8H40L34 20H-34Z" fill="#b9c0c8"/>' +
'   <path d="M-30-4V16M-18-4V18M-6-4V18M6-4V18M18-4V18M30-4V16" stroke="#a3abb4" stroke-width="2"/>' +
'   <rect x="-44" y="-16" width="88" height="10" rx="3" fill="#e4e8ec"/>' +
'   <rect x="-44" y="-8" width="88" height="3" fill="#c9cfd6"/>' +
'   <path d="M-12-26q-4-6 0-12M0-28q-4-6 0-12M12-26q-4-6 0-12" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".85"/>' +
'  </g></g>' +
'  <g transform="translate(126 214)"><g class="cbc-cai i4">' +
'   <rect x="3" y="-64" width="5" height="46" rx="2.5" fill="#22b357" transform="rotate(10)"/>' +
'   <path d="M-21-30H21L16 36H-16Z" fill="rgba(255,255,255,.6)" stroke="#fff" stroke-width="2"/>' +
'   <path d="M-19-16H19L15.3 34H-15.3Z" fill="#ff9f1a"/>' +
'   <rect x="-14" y="-12" width="4" height="40" rx="2" fill="#fff" opacity=".45"/>' +
'   <circle cx="-20" cy="-30" r="10" fill="#ffb52e" stroke="#fff3c4" stroke-width="2.5"/>' +
'   <path d="M-20-30v-8M-20-30l7 4M-20-30l-7 4M-20-30l7-4M-20-30l-7-4M-20-30v8" stroke="#fff3c4" stroke-width="1.3"/>' +
'  </g></g>' +
'  <g transform="translate(184 214)"><g class="cbc-cai i3">' +
'   <rect x="-18.5" y="-35.5" width="37" height="73" rx="8" fill="#fff" opacity=".85"/><rect x="-17" y="-34" width="34" height="70" rx="7" fill="#b5121b"/>' +
'   <rect x="-17" y="-28" width="34" height="58" fill="#e3242b"/>' +
'   <path d="M-17 6 Q-6-6 4 4 T17 0 V10 Q8 16-2 8 T-17 14Z" fill="#fff"/>' +
'   <rect x="-13" y="-28" width="5" height="58" fill="#fff" opacity=".28"/>' +
'   <rect x="-15" y="-38" width="30" height="7" rx="3" fill="#d6dbe0"/><rect x="-15" y="33" width="30" height="5" rx="2" fill="#c3c8ce"/>' +
'  </g></g>' +
'  <g transform="translate(118 210)"><g class="cbc-cai i2">' +
'   <g fill="#ffc83d" stroke="#e8a91c" stroke-width="1.5"><rect x="-20" y="-46" width="8" height="44" rx="3"/><rect x="-9" y="-52" width="8" height="50" rx="3"/><rect x="2" y="-49" width="8" height="47" rx="3"/><rect x="13" y="-44" width="8" height="42" rx="3"/></g>' +
'   <path d="M-28-12H28L22 36H-22Z" fill="#fff8ec"/><path d="M-26 2H26L25 12H-25Z" fill="#d7261e"/><path d="M-24 20H24L23 28H-23Z" fill="#d7261e"/>' +
'  </g></g>' +
'  <g transform="translate(150 205)"><g class="cbc-cai i1">' +
'   <path d="M-42 0Q-42-36 0-36Q42-36 42 0Z" fill="#e9a23b"/>' +
'   <g fill="#fff3d6"><ellipse cx="-18" cy="-22" rx="3" ry="1.8"/><ellipse cx="0" cy="-28" rx="3" ry="1.8"/><ellipse cx="17" cy="-20" rx="3" ry="1.8"/><ellipse cx="-4" cy="-14" rx="3" ry="1.8"/><ellipse cx="26" cy="-10" rx="3" ry="1.8"/></g>' +
'   <path d="M-44 2q6 7 12 0t12 0 12 0 12 0 12 0 12 0 12 0v6h-88z" fill="#6cc04a"/>' +
'   <path d="M-40 8H40L30 18 22 10 10 18 0 10-12 18-22 10-32 18Z" fill="#ffd23f"/>' +
'   <rect x="-41" y="10" width="82" height="14" rx="7" fill="#6b3a1e"/>' +
'   <rect x="-40" y="25" width="80" height="13" rx="6" fill="#e9a23b"/>' +
'  </g></g>' +
    /* frente do saco */
'  <path d="M70 147 l10-5 10 5 10-5 10 5 10-5 10 5 10-5 10 5 10-5 10 5 10-5 10 5 10-5 10 5 10-5 10 5 V318 Q230 330 218 330 H82 Q70 330 70 318Z" fill="#c99459"/>' +
'  <path d="M70 147 l10-5 10 5 V330 H82 Q70 330 70 318Z" fill="#b8844b"/>' +
'  <path d="M210 146 l10-4 10 5 V318 Q230 330 218 330 H210Z" fill="#b8844b"/>' +
    /* dobra que fecha o saco */
'  <g class="cbc-dobra"><path d="M70 140 H230 L230 172 220 178 210 172 200 178 190 172 180 178 170 172 160 178 150 172 140 178 130 172 120 178 110 172 100 178 90 172 80 178 70 172 Z" fill="#a8733f"/>' +
'   <rect x="70" y="140" width="160" height="5" fill="#8f6033"/></g>' +
    /* selo com a coroa */
'  <g class="cbc-selo"><circle cx="150" cy="252" r="38" fill="#d7261e" stroke="#e9c46a" stroke-width="3.5"/>' +
'   <circle cx="150" cy="252" r="31" fill="none" stroke="#fff3d6" stroke-width="1.6" stroke-dasharray="4 4" opacity=".8"/>' +
'   <image href="' + coroa + '" x="122" y="236" width="56" height="32"/></g>' +
' </g>' +
    /* check */
' <g class="cbc-ok"><circle cx="226" cy="140" r="24" fill="#22b357" stroke="#fff" stroke-width="4"/>' +
'  <path d="M214 141 l8 8 16-17" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>' +
'</svg>';
  }

  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function mostrar(op) {
    op = op || {};
    return new Promise(function (resolver) {
      var el = document.createElement('div');
      el.className = 'cbc';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.innerHTML =
        faixa('a') + faixa('b') + faixa('c') + faixa('d') +
        cena(op.coroa || CORO_PADRAO) +
        '<div class="cbc-texto">' +
        '<p class="cbc-titulo">' + esc(op.titulo || 'Pedido confirmado!') + '</p>' +
        '<p class="cbc-sub">' + esc(op.subtitulo || 'Já estamos preparando tudo pra você') + '</p>' +
        '<span class="cbc-num">' + (op.numero ? 'Pedido #' + esc(op.numero) : '') + '</span>' +
        '</div>';

      var html = document.documentElement, feito = false;
      function fim() {
        if (feito) return; feito = true;
        html.classList.remove('cbc-travado');
        if (el.parentNode) el.parentNode.removeChild(el);
        resolver();
      }
      el.addEventListener('animationend', function (e) {
        if (e.target === el && e.animationName === 'cbc-sai') fim();
      });
      el.addEventListener('click', function () { el.classList.add('cbc-pular'); });
      setTimeout(fim, 5000); // segurança

      html.classList.add('cbc-travado');
      (op.dentro || document.body).appendChild(el);
    });
  }

  // pré-carrega a coroa pra não piscar na hora
  function preCarregar(src) { var i = new Image(); i.src = src || CORO_PADRAO; }

  w.CBConfirmacao = { mostrar: mostrar, preCarregar: preCarregar };
})(window);
