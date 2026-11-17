/* Splash de abertura — Cabana Boemia */
(function () {
  var el = document.getElementById('cb-splash');
  var html = document.documentElement;
  if (!el || html.classList.contains('cb-sem-splash')) return;

  html.classList.add('cb-travado');
  var acabou = false;

  function fim() {
    if (acabou) return;
    acabou = true;
    html.classList.remove('cb-travado');
    try { localStorage.setItem('cbSplash', Date.now()); } catch (e) {} // não repete por 3h (ver <head>)
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  function comecar() { el.classList.add('cb-pronto'); }

  // espera as imagens (no máx. 1,2s) antes de começar
  var imgs = el.querySelectorAll('img'), faltam = imgs.length;
  function carregou() { if (--faltam <= 0) comecar(); }
  imgs.forEach(function (img) {
    if (img.complete) carregou();
    else { img.addEventListener('load', carregou); img.addEventListener('error', carregou); }
  });
  setTimeout(comecar, 1200);

  el.addEventListener('animationend', function (e) {
    if (e.target === el && e.animationName === 'cb-sai') fim();
  });
  el.addEventListener('click', function () { el.classList.add('cb-pular'); });
  setTimeout(fim, 5000); // segurança
})();
