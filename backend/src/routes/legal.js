import { Router } from 'express';

/**
 * Strony prawne (polityka prywatności + regulamin) — serwowane przez backend.
 * Bez landingu (D-016) backend hostuje dokumenty wymagane przez App Store / Google Play.
 */

const router = Router();

const COMPANY = {
  name: 'Krzysztof Kapusta',
  address: 'Jagiełła 68, 37-203 Gniewczyna Tryniecka',
  nip: '7941844550',
  email: 'jakatora68@gmail.com',
  lastUpdate: '25 maja 2026 r.',
};

function legalShell(title, body) {
  return `<!DOCTYPE html>
<html lang="pl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — PrzetargAI</title>
<style>
*,*::before,*::after{box-sizing:border-box}html,body{margin:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#14213d;background:#fff;line-height:1.65;-webkit-font-smoothing:antialiased}
main{max-width:760px;margin:0 auto;padding:32px 24px 80px}
h1{font-size:28px;margin:0 0 10px;color:#0f2557}
h2{font-size:18px;margin:32px 0 10px;color:#0f2557;font-weight:600}
.updated{color:#5b6577;font-size:14px;margin:0 0 24px}
p,ul,ol{margin:0 0 14px}ul,ol{padding-left:22px}li{margin-bottom:6px}
a{color:#2563eb}strong{font-weight:600}
.footer{margin-top:48px;padding-top:24px;border-top:1px solid #e3e8f2;color:#5b6577;font-size:13px;text-align:center}
@media(max-width:480px){main{padding:24px 18px 60px}h1{font-size:24px}}
</style></head><body><main>${body}
<p class="footer">PrzetargAI — ${COMPANY.name}, NIP ${COMPANY.nip}</p>
</main></body></html>`;
}

router.get('/polityka-prywatnosci', (_req, res) => {
  res.type('html').send(legalShell('Polityka prywatności', `
<h1>Polityka prywatności</h1>
<p class="updated">Ostatnia aktualizacja: ${COMPANY.lastUpdate}</p>
<h2>1. Administrator danych</h2>
<p>Administratorem danych osobowych jest <strong>${COMPANY.name}</strong>, ${COMPANY.address},
NIP ${COMPANY.nip}, e-mail: <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>
(dalej „Administrator" lub „PrzetargAI").</p>
<h2>2. Jakie dane przetwarzamy</h2>
<ul>
<li><strong>Dane konta i firmy:</strong> adres e-mail, hasło (zaszyfrowane), NIP, nazwa firmy, słowa kluczowe i kody CPV opisujące profil firmy.</li>
<li><strong>Dane rozliczeniowe:</strong> dane do faktury VAT; płatność obsługuje Stripe — nie przechowujemy danych karty.</li>
<li><strong>Dane techniczne:</strong> adres IP, dziennik audytu, token push (jeśli aktywne).</li>
</ul>
<h2>3. Cele i podstawy prawne</h2>
<ul>
<li>świadczenie usługi — art. 6 ust. 1 lit. b RODO;</li>
<li>rozliczenia podatkowe — art. 6 ust. 1 lit. c RODO;</li>
<li>bezpieczeństwo i audyt — art. 6 ust. 1 lit. f RODO.</li>
</ul>
<h2>4. Odbiorcy danych</h2>
<p>Korzystamy z zaufanych dostawców usług, którzy przetwarzają dane w naszym imieniu:</p>
<ul>
<li>Railway — hosting backendu;</li>
<li>Stripe — obsługa płatności subskrypcyjnych;</li>
<li>Fakturownia — wystawianie faktur VAT;</li>
<li>Resend — wysyłka wiadomości transakcyjnych e-mail;</li>
<li>Anthropic (Claude) — analiza dopasowania przetargów przez AI;</li>
<li>Backblaze B2 — zaszyfrowane kopie zapasowe;</li>
<li>Sentry — monitorowanie błędów technicznych.</li>
</ul>
<h2>5. Przekazywanie danych poza EOG</h2>
<p>Część dostawców (Anthropic, Backblaze, Sentry, Stripe) może przetwarzać dane poza Europejskim
Obszarem Gospodarczym, na podstawie standardowych klauzul umownych zatwierdzonych przez Komisję Europejską.</p>
<h2>6. Okres przechowywania</h2>
<p>Dane konta — przez czas korzystania z usługi oraz po jej zakończeniu w zakresie niezbędnym do rozliczeń.
Dane rozliczeniowe — 5 lat od końca roku, w którym wystawiono fakturę.</p>
<h2>7. Twoje prawa</h2>
<ul>
<li>dostęp do danych i otrzymanie kopii;</li>
<li>sprostowanie, usunięcie lub ograniczenie przetwarzania;</li>
<li>przenoszenie danych;</li>
<li>sprzeciw wobec przetwarzania;</li>
<li>skarga do Prezesa UODO (ul. Stawki 2, 00-193 Warszawa).</li>
</ul>
<p>Realizacja praw: <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>.</p>
<h2>8. Pliki cookies</h2>
<p>Aplikacja mobilna nie wykorzystuje plików cookies. Strony prawne stosują wyłącznie pliki techniczne
niezbędne do działania serwisu.</p>
<h2>9. Źródło danych o przetargach</h2>
<p>Dane o przetargach pochodzą z publicznego BZP (ezamowienia.gov.pl) i nie stanowią danych osobowych
użytkowników aplikacji.</p>
<h2>10. Kontakt</h2>
<p>W sprawach ochrony danych: <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>.</p>
`));
});

router.get('/regulamin', (_req, res) => {
  res.type('html').send(legalShell('Regulamin', `
<h1>Regulamin</h1>
<p class="updated">Ostatnia aktualizacja: ${COMPANY.lastUpdate}</p>
<h2>§1. Postanowienia ogólne</h2>
<p>Regulamin określa zasady korzystania z aplikacji mobilnej i serwisu PrzetargAI. Usługodawcą jest
<strong>${COMPANY.name}</strong>, ${COMPANY.address}, NIP ${COMPANY.nip}. Kontakt:
<a href="mailto:${COMPANY.email}">${COMPANY.email}</a>.</p>
<h2>§2. Definicje</h2>
<ul>
<li><strong>Usługa</strong> — monitoring i dopasowywanie przetargów BZP do profilu firmy Użytkownika.</li>
<li><strong>Użytkownik</strong> — przedsiębiorca korzystający z Usługi.</li>
<li><strong>Konto</strong> — indywidualny profil Użytkownika.</li>
</ul>
<h2>§3. Rodzaj i zakres usług</h2>
<p>Automatyczna analiza publicznych ogłoszeń o przetargach i prezentowanie Użytkownikowi tych
dopasowanych do profilu firmy, wraz z oceną trafności i uzasadnieniem generowanym przez AI
(Claude — model Anthropic).</p>
<h2>§4. Konto i rejestracja</h2>
<ul>
<li>Korzystanie wymaga rejestracji i podania prawdziwych danych firmy (NIP, nazwa, e-mail).</li>
<li>Usługa przeznaczona dla przedsiębiorców (B2B).</li>
<li>Użytkownik odpowiada za poufność hasła i działania na Koncie.</li>
</ul>
<h2>§5. Plany i ceny</h2>
<ul>
<li><strong>Plan Free</strong> — bezpłatny i bezterminowy, do 5 dopasowanych przetargów dziennie, bez powiadomień push.</li>
<li><strong>Plan Standard</strong> — 199 zł netto miesięcznie + VAT 23%; nielimitowane dopasowania oraz powiadomienia push.</li>
</ul>
<h2>§6. Płatności i faktury</h2>
<p>Płatności obsługuje Stripe Inc. Subskrypcja odnawiana miesięcznie. Po opłaceniu Użytkownik otrzymuje
fakturę VAT na e-mail. Płatność dokonywana przez stronę internetową operatora płatności, nie przez
zakupy w aplikacji mobilnej.</p>
<h2>§7. Czas trwania i rezygnacja</h2>
<p>Subskrypcja Standard na okresy miesięczne. Rezygnacja możliwa w dowolnym momencie przez ekran konta.
Po okresie opłaconym — Konto wraca do planu Free bez utraty danych. Plan Free obowiązuje bezterminowo.</p>
<h2>§8. Obowiązki Użytkownika</h2>
<ul>
<li>korzystanie zgodne z prawem i Regulaminem;</li>
<li>niezakłócanie działania Usługi (m.in. nadmierna automatyzacja);</li>
<li>podanie i aktualizowanie prawdziwych danych firmy.</li>
</ul>
<h2>§9. Odpowiedzialność</h2>
<p>PrzetargAI to narzędzie wspomagające. Dane z BZP mogą podlegać zmianom po stronie zamawiających.
Usługodawca dokłada starań, ale nie gwarantuje kompletności danych ani wyniku udziału w przetargu.
Decyzje biznesowe Użytkownik podejmuje samodzielnie.</p>
<h2>§10. Reklamacje</h2>
<p>Reklamacje: <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>. Rozpatrywane w terminie 14 dni.</p>
<h2>§11. Dane osobowe</h2>
<p>Zasady przetwarzania określa <a href="/polityka-prywatnosci">Polityka prywatności</a>.</p>
<h2>§12. Zmiany Regulaminu</h2>
<p>Usługodawca może zmienić Regulamin z ważnych przyczyn. O zmianach Użytkownik zostanie poinformowany
z co najmniej 14-dniowym wyprzedzeniem drogą e-mail.</p>
<h2>§13. Postanowienia końcowe</h2>
<p>W sprawach nieuregulowanych stosuje się prawo polskie. Spory rozstrzyga sąd właściwy dla
siedziby Usługodawcy.</p>
`));
});

export default router;
