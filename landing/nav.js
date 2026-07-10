/*
 * Mobilne menu nawigacji PrzetargAI.
 * Dostępny toggle: aria-expanded, zamykanie po kliknięciu linku, Escape
 * oraz automatyczne zamknięcie przy powrocie do widoku desktop.
 */
(function () {
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('navMenu');
  if (!toggle || !menu) return;

  function setOpen(open) {
    menu.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Zamknij menu' : 'Otwórz menu');
  }

  toggle.addEventListener('click', function () {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  // Zamknij po kliknięciu dowolnego linku w menu.
  menu.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });

  // Escape zamyka menu i wraca fokus na przycisk.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  // Klik poza nagłówkiem zamyka menu.
  document.addEventListener('click', function (e) {
    if (toggle.getAttribute('aria-expanded') === 'true' && !e.target.closest('.nav')) {
      setOpen(false);
    }
  });

  // Powrót do desktopu (>880px) — zawsze domknij, by nie zostawić stanu.
  var mq = window.matchMedia('(min-width: 881px)');
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(function () {
    if (mq.matches) setOpen(false);
  });
})();
