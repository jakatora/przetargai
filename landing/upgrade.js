/*
 * Przepływ aktywacji subskrypcji.
 * Strona jest otwierana z aplikacji mobilnej:
 *   /upgrade?user_id=<id>&token=<magic-link>
 * Po kliknięciu woła backend POST /upgrade i przekierowuje na Stripe Checkout.
 */
(function () {
  var params = new URLSearchParams(window.location.search);
  var userId = params.get('user_id');
  var token = params.get('token');
  var apiUrl = (window.PRZETARGAI && window.PRZETARGAI.API_URL) || '';

  var statusEl = document.getElementById('status');
  var btn = document.getElementById('payBtn');

  function showError(msg) {
    statusEl.textContent = msg;
    statusEl.className = 'status status--error';
  }

  if (!userId || !token) {
    btn.disabled = true;
    showError('Brakuje danych w linku. Otwórz tę stronę przyciskiem „Przejdź na Standard" w aplikacji PrzetargAI.');
    return;
  }

  btn.addEventListener('click', async function () {
    btn.disabled = true;
    btn.textContent = 'Przekierowywanie…';
    statusEl.textContent = '';
    statusEl.className = 'status';

    try {
      var res = await fetch(apiUrl + '/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, token: token }),
      });
      var data = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        throw new Error((data.error && data.error.message) || 'Nie udało się rozpocząć płatności.');
      }
      if (!data.checkout_url) {
        throw new Error('Brak adresu płatności w odpowiedzi serwera.');
      }
      window.location.href = data.checkout_url;
    } catch (err) {
      showError(err.message || 'Wystąpił błąd. Spróbuj ponownie.');
      btn.disabled = false;
      btn.textContent = 'Przejdź do płatności';
    }
  });
})();
