import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/*
 * STRONA PRODUKTU (landing/index.html) — spójność danych i linków (2026-10-03).
 *
 * Strona nie miała żadnego testu, a rozjeżdżała się po cichu: cena 49 zł „netto" w danych
 * strukturalnych przy 99 zł w cenniku, adres kanoniczny na domenie, która nie serwuje
 * strony, główny przycisk prowadzący do cennika zamiast do pobrania. Test czyta ŹRÓDŁO —
 * bez sieci i bez przeglądarki — i pilnuje tego, co da się sprawdzić w samym pliku.
 */

const LANDING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'landing');
const html = fs.readFileSync(path.join(LANDING, 'index.html'), 'utf8');
const DOMENA = 'https://przetarg-ai.pl';

/** Treść widoczna dla człowieka: bez komentarzy, skryptów i znaczników. */
const widoczne = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ');

const jsonLd = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const wezel = (typ) => jsonLd['@graph'].find((w) => w['@type'] === typ);

/** Tekst elementu bez znaczników i nadmiarowych spacji. */
const czysty = (fragment) => fragment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

test('adres kanoniczny, Open Graph i dane strukturalne wskazują jedną, potwierdzoną domenę', () => {
  assert.match(html, new RegExp(`<link rel="canonical" href="${DOMENA}/" />`));
  assert.match(html, new RegExp(`<meta property="og:url" content="${DOMENA}/" />`));
  assert.match(html, new RegExp(`<meta property="og:image" content="${DOMENA}/og-image.png" />`));
  assert.match(html, new RegExp(`<meta name="twitter:image" content="${DOMENA}/og-image.png" />`));
  assert.equal(wezel('Organization').url, `${DOMENA}/`);
  assert.equal(wezel('Organization')['@id'], `${DOMENA}/#organization`);
  assert.ok(fs.existsSync(path.join(LANDING, 'og-image.png')), 'obraz podglądu istnieje w landing/');
  // Żadnej innej domeny własnej w adresach — ani wygasłej, ani niepotwierdzonej.
  assert.doesNotMatch(html, /https?:\/\/(www\.)?przetargai\.pl/);
  assert.doesNotMatch(html, /https?:\/\/przetargai\.web\.app/);
});

test('cena planu Standard: 99 zł brutto w cenniku i w danych strukturalnych', () => {
  const oferty = wezel('SoftwareApplication').offers;
  const standard = oferty.find((o) => o.name === 'Standard');
  const free = oferty.find((o) => o.name === 'Free');
  assert.equal(standard.price, '99');
  assert.equal(standard.priceCurrency, 'PLN');
  assert.match(standard.description, /brutto/);
  assert.doesNotMatch(standard.description, /netto/);
  assert.equal(free.price, '0');

  assert.match(html, /<span class="amount">99 zł<\/span><span class="period">\/ miesiąc<\/span>/);
  assert.doesNotMatch(widoczne, /\b49\s*zł/);
  assert.doesNotMatch(html, /"price":\s*"49"/);
});

test('główne przyciski prowadzą do pobierania, nie do cennika', () => {
  const glowne = [...html.matchAll(/<a class="([^"]*)" href="([^"]*)">Zacznij za darmo<\/a>/g)];
  assert.equal(glowne.length, 3, 'menu, pasek nawigacji i hero');
  for (const [, klasy, href] of glowne) assert.equal(href, '#pobierz', `przycisk „${klasy}"`);
});

test('linki do sklepów i pliku instalacyjnego zostały na miejscu', () => {
  assert.match(html, /href="https:\/\/play\.google\.com\/store\/apps\/details\?id=pl\.przetargai\.app"/);
  assert.match(html, /href="https:\/\/apps\.apple\.com\/pl\/app\/id6773018962"/);
  assert.match(html, /href="\/PrzetargAI\.apk" download/);
  assert.match(html, /href="\/pobierz"/);
});

test('każda kotwica na stronie ma swój cel, a pliki lokalne istnieją', () => {
  const identyfikatory = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const kotwice = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(kotwice.length > 0);
  for (const cel of kotwice) assert.ok(identyfikatory.has(cel), `brak elementu o id="${cel}"`);

  for (const plik of ['styles.css', 'nav.js', 'config.js', 'pobierz.html', 'regulamin.html', 'polityka-prywatnosci.html']) {
    assert.ok(fs.existsSync(path.join(LANDING, plik)), `brak pliku landing/${plik}`);
  }
  assert.match(html, /href="\/regulamin"/);
  assert.match(html, /href="\/polityka-prywatnosci"/);
});

test('sekcja FAQ i dane strukturalne FAQPage mówią to samo', () => {
  const naStronie = [...html.matchAll(/<details class="faq">\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)]
    .map((m) => ({ pytanie: czysty(m[1]), odpowiedz: czysty(m[2]) }));
  const wDanych = wezel('FAQPage').mainEntity
    .map((q) => ({ pytanie: q.name, odpowiedz: q.acceptedAnswer.text }));
  assert.ok(naStronie.length > 0);
  assert.deepEqual(wDanych, naStronie);
});

test('bez nieudowodnionych liczb, wyróżników i obietnicy wygranej', () => {
  for (const zakazane of [
    /~\s*2\s*h/, /300\+/, /Najczęściej wybierany/i, /przegapisz/i, /nie przegap żadnego/i,
    /nic Ci nie umknie/i, /wygrywać przetargi/i, /gwarantuj/i,
  ]) {
    assert.doesNotMatch(widoczne, zakazane);
    assert.doesNotMatch(JSON.stringify(jsonLd), zakazane);
  }
  for (const meta of [...html.matchAll(/<meta [^>]*content="([^"]*)"/g)].map((m) => m[1])) {
    assert.doesNotMatch(meta, /nie przegap żadnego|wygrywa/i);
  }
  // „Gwarancja" pada na stronie wyłącznie w zaprzeczeniu.
  for (const m of widoczne.matchAll(/gwarancj\w*/gi)) {
    assert.match(widoczne.slice(Math.max(0, m.index - 6), m.index), /nie\s$/i, 'słowo „gwarancja" bez zaprzeczenia');
  }
});

test('hero i sekcja pierwszej oferty opisują pomoc: wymagania, dokumenty, następny krok', () => {
  const hero = html.match(/<section class="hero">([\s\S]*?)<\/section>/)[1];
  assert.match(czysty(hero), /wymagania SWZ/);
  assert.match(czysty(hero), /dokumenty na dzień składania/);
  assert.match(czysty(hero), /następny krok/);
  assert.match(czysty(hero), /nie gwarancja wygranej/);

  const sekcja = html.match(/<section class="section" id="pierwsza-oferta">([\s\S]*?)<\/section>/);
  assert.ok(sekcja, 'sekcja #pierwsza-oferta istnieje');
  const tekst = czysty(sekcja[1].replace(/<!--[\s\S]*?-->/g, ''));
  assert.match(tekst, /Radar SWZ/);
  assert.match(tekst, /Co musisz mieć do dnia składania/);
  assert.match(tekst, /nie porada prawna i nie gwarancja wygranej/);
  assert.match(tekst, /może być niepełna; wiążąca jest treść SWZ/);
  assert.match(sekcja[1], /href="#pobierz"/);
  // Żadnych liczb „z powietrza": w sekcji są tylko numery trzech kroków.
  assert.deepEqual(tekst.match(/\d+/g), ['1', '2', '3']);
});

test('sitemap i robots wskazują tę samą domenę co strona, a każdy adres ma swój plik', () => {
  const sitemap = fs.readFileSync(path.join(LANDING, 'sitemap.xml'), 'utf8');
  const robots = fs.readFileSync(path.join(LANDING, 'robots.txt'), 'utf8');

  const adresy = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(adresy, [
    `${DOMENA}/`, `${DOMENA}/regulamin`, `${DOMENA}/polityka-prywatnosci`, `${DOMENA}/pobierz`,
  ]);
  for (const adres of adresy) {
    const sciezka = adres.slice(DOMENA.length);
    const plik = sciezka === '/' ? 'index.html' : `${sciezka.slice(1)}.html`;
    assert.ok(fs.existsSync(path.join(LANDING, plik)), `sitemap wskazuje ${sciezka}, a nie ma landing/${plik}`);
    const strona = fs.readFileSync(path.join(LANDING, plik), 'utf8');
    assert.ok(strona.includes(`<link rel="canonical" href="${adres}" />`), `adres kanoniczny ${plik} odpowiada mapie strony`);
  }

  assert.match(robots, new RegExp(`^Sitemap: ${DOMENA}/sitemap\\.xml\\s*$`, 'm'));
  assert.match(robots, /^Disallow: \/upgrade$/m, 'strony płatności zostają poza indeksem');
  for (const plik of [sitemap, robots]) {
    assert.doesNotMatch(plik, /przetargai\.pl|przetargai\.web\.app/);
  }
  // Adres kanoniczny strony głównej jest pierwszym adresem mapy.
  assert.match(html, new RegExp(`<link rel="canonical" href="${adresy[0]}" />`));
});

test('licznik ogłoszeń: bez pobranej wartości strona nie pokazuje żadnej liczby', () => {
  // Licznik z 7 dni (2026-11-07): w weekend dobowa liczba spadała do ~200 i wyglądała jak martwa baza.
  const liczba = html.match(/<div class="stat__num" data-stat="nowe7dni">([^<]*)<\/div>/);
  const opis = html.match(/<p data-stat-opis="nowe7dni">([^<]*)<\/p>/);
  assert.ok(liczba && opis, 'pole licznika i jego opis istnieją');
  assert.doesNotMatch(liczba[1], /\d/, 'w HTML nie ma liczby „na zapas"');
  assert.doesNotMatch(opis[1], /na żywo|ostatniej dobie|ostatnich 7 dniach/, 'opis zastępczy nie udaje statystyki');
  assert.doesNotMatch(widoczne, /300\+/);

  // Skrypt wstawia liczbę i opis „na żywo" razem, dopiero po poprawnej odpowiedzi.
  const skrypt = html.slice(html.lastIndexOf('<script>'));
  assert.match(skrypt, /if \(!d \|\| typeof d\.nowe7dni !== 'number' \|\| !\(d\.nowe7dni > 0\)\) return;/);
  assert.match(skrypt, /el\.textContent = [\s\S]*opis\.textContent = 'nowych ogłoszeń w ostatnich 7 dniach — na żywo z naszej bazy';/);
  assert.match(skrypt, /\.catch\(function \(\) \{\}\)/, 'błąd pobierania zostawia tekst z HTML');
});

test('powiadomienia są obiecywane tylko w opisie planów i przy pilnowaniu ZAPISANYCH (cennik: Standard z miesięczną próbą)', () => {
  // 2026-11-10: alerty o zmianach zapisanych przetargów (SWZ, termin, wyjaśnienia, wynik) i przypomnienia 7/3/1
  // działają w KAŻDYM planie (push, awaryjnie e-mail) — pas „Pilnuje tego, co weźmiesz” i pytanie w FAQ mogą o nich mówić.
  const bezCennika = html
    .replace(/<section class="section" id="cennik">[\s\S]*?<\/section>/, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')
    .replace(/<div class="pilnuje">[\s\S]*?<\/ul>\s*<\/div>\s*<\/div>/, '')
    .replace(/<details class="faq">\s*<summary>Czy dowiem się, że zamawiający zmienił SWZ albo termin\?<\/summary>[\s\S]*?<\/details>/, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(czysty(bezCennika), /push|powiadomieni|powiadamia/i);
  assert.doesNotMatch(wezel('SoftwareApplication').description, /powiadamia/i);
  // Cennik i opis planu w danych strukturalnych — Standard po zmianie selekcji (spec §8), z próbą bez karty.
  assert.match(html, /<li>Przegląd co 3 godziny i <strong>powiadomienia od razu<\/strong><\/li>/);
  assert.match(html, /Miesiąc \(30 dni\) Standard za darmo po rejestracji — bez karty\./);
  assert.doesNotMatch(html, /7 dni (próby|planu Standard|pełny plan|masz pełny)|przez 7 dni/, 'próba trwa miesiąc — bez starych „7 dni”');
  assert.match(html, /Subskrypcję aktywujesz z poziomu aplikacji\./);
  // Faktury nie są dziś wystawiane automatycznie (FAKTUROWANIE_ENABLED=false) — strona nie może tego obiecywać (audyt 2026-11-10).
  assert.doesNotMatch(html, /fakturę VAT|Faktura VAT/i);
  assert.match(html, /<div class="pilnuje">[\s\S]*Pilnuje tego, co weźmiesz/);
});

test('limity i kanały opisane tak, jak działa backend (review Codexa 2026-11-11)', () => {
  // Standard: pytania do SWZ idą przez Railway i dzielą dobową pulę AI 30/użytkownika (PRZETARG_AI_DAILY_LIMIT_PER_USER)
  // z analizą SWZ — strona nie może obiecywać „bez limitu”. Free: 3 pytania dziennie (limit w Functions i w moście).
  assert.doesNotMatch(html, /SWZ[^<"]{0,40}bez (dziennego )?limitu/i, 'pytania do SWZ mają dobowy limit także w Standard');
  assert.match(html, /<li>Zapytaj SWZ i analizy SWZ — do 30 dziennie<\/li>/);
  assert.match(html, /<li>Zapytaj SWZ — 3 pytania dziennie<\/li>/);
  // E-mail zapasowy: przy braku zgody na powiadomienia (brak tokenu) albo odrzuconej wysyłce push
  // (`dostarcz` w jobs/monitorWyszukiwan.js) — nie „gdy powiadomienie nie dotrze” (niedoręczeń po przyjęciu nie wykrywamy).
  const pytanie = wezel('FAQPage').mainEntity.find((q) => q.name === 'Czy dowiem się, że zamawiający zmienił SWZ albo termin?');
  assert.ok(pytanie, 'pytanie o zmiany jest w danych strukturalnych');
  assert.match(pytanie.acceptedAnswer.text, /nie ma zgody na powiadomienia/);
  assert.doesNotMatch(html, /gdy powiadomienie nie dotrze|gdy push nie dotrze/i);
});

test('źródła ogłoszeń: trzy rejestry w FAQ i w stopce, z działającymi adresami urzędowymi', () => {
  const faq = wezel('FAQPage').mainEntity.find((q) => q.name === 'Skąd pochodzą dane o przetargach?');
  for (const rejestr of [/Biuletynu Zamówień Publicznych/, /TED/, /Bazy Konkurencyjności/]) {
    assert.match(faq.acceptedAnswer.text, rejestr);
  }
  assert.match(html, /href="https:\/\/bazakonkurencyjnosci\.funduszeeuropejskie\.gov\.pl"/);
});

test('strona pobierania jest zgodna z produkcją: sklepy zamiast „wkrótce"', () => {
  const pobierz = fs.readFileSync(path.join(LANDING, 'pobierz.html'), 'utf8');
  assert.match(pobierz, /href="https:\/\/play\.google\.com\/store\/apps\/details\?id=pl\.przetargai\.app"/);
  assert.match(pobierz, /href="https:\/\/apps\.apple\.com\/pl\/app\/id6773018962"/);
  assert.doesNotMatch(pobierz.replace(/<style[\s\S]*?<\/style>/, ''), /wkrótce/i);
});

test('strona pobierania: wersja APK = wersja aplikacji, a suma SHA-256 to suma wydanego pliku', () => {
  const pobierz = fs.readFileSync(path.join(LANDING, 'pobierz.html'), 'utf8');
  const wersjaAplikacji = JSON.parse(fs.readFileSync(path.join(LANDING, '..', 'mobile', 'app.json'), 'utf8')).expo.version;

  // Wersja przy linku do pliku musi iść w parze z wydaniem — inaczej strona podpisuje
  // nowy plik starą wersją (albo odwrotnie).
  const link = pobierz.match(/<a href="\/PrzetargAI\.apk" download>Pobierz APK ([\d.]+)<\/a> \(ok\.&nbsp;(\d+)&nbsp;MB/);
  assert.ok(link, 'link do APK z wersją i rozmiarem');
  assert.equal(link[1], wersjaAplikacji, 'wersja APK na stronie = expo.version z mobile/app.json');

  // Dokładnie jedna suma kontrolna i jest to suma APK 1.2.8 (vc31) podpisanego kluczem przesyłania
  // (CN=PrzetargAI, O=Jakatora; build lokalny 2026-11-10, 68068383 B).
  const sumy = [...pobierz.matchAll(/<code>([0-9a-f]{64})<\/code>/g)].map((m) => m[1]);
  assert.deepEqual(sumy, ['a90817f10b949e6052c9af92b669c1f9c6943f1bef84834fcbc8247e87743c1a']);
  assert.equal(Number(link[2]), Math.round(68068383 / 1024 / 1024), 'rozmiar w MB zgodny z plikiem');
  assert.doesNotMatch(pobierz, /8f9c92799fd27919df294ea7e567e7833cd100c00976cec9ff95a9a9de0e26b9/, 'suma poprzedniego APK (1.2.1) usunięta');

  // Jeśli plik leży obok strony (katalog hostingu / lokalna kopia; w repo go nie ma),
  // jego rzeczywista suma i rozmiar MUSZĄ zgadzać się z tym, co strona obiecuje.
  const plik = path.join(LANDING, 'PrzetargAI.apk');
  if (fs.existsSync(plik)) {
    const zawartosc = fs.readFileSync(plik);
    assert.equal(crypto.createHash('sha256').update(zawartosc).digest('hex'), sumy[0], 'suma landing/PrzetargAI.apk');
    assert.equal(Math.round(zawartosc.length / 1024 / 1024), Number(link[2]), 'rozmiar landing/PrzetargAI.apk');
  }
});

test('strony prawne: dane usługodawcy zamiast szablonu, z datą aktualizacji', () => {
  // Do 25.10.2026 repo miało tu szablony z „[PEŁNA NAZWA FIRMY]", a wersje z danymi żyły tylko
  // na hostingu — deploy z repo cofnąłby je bez żadnego błędu. Od wniesienia wersji live
  // ten test pilnuje, że szablon nie wróci (np. przez przywrócenie starego pliku).
  for (const plik of ['regulamin.html', 'polityka-prywatnosci.html']) {
    const strona = fs.readFileSync(path.join(LANDING, plik), 'utf8');
    const tekst = czysty(strona.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, ''));
    for (const szablon of [/\[PEŁNA NAZWA/, /\[ADRES/, /\[NIP\]/, /support@przetargai\.pl/, /dokument jest wzorem/i]) {
      assert.doesNotMatch(strona, szablon, `${plik}: pozostałość szablonu`);
    }
    assert.match(
      strona,
      /<p class="updated">Ostatnia aktualizacja: \d{1,2} [a-ząćęłńóśźż]+ 20\d{2} r\.<\/p>/,
      `${plik}: data ostatniej aktualizacji`,
    );
    // Usługodawca/administrator jest wskazany z NIP-em i działającym adresem kontaktowym.
    assert.match(tekst, /NIP \d{10}/, `${plik}: NIP usługodawcy`);
    assert.match(strona, /href="mailto:[^"@\s]+@[^"\s]+"/, `${plik}: adres e-mail do kontaktu`);
    assert.match(strona, /<link rel="stylesheet" href="styles\.css" \/>/, `${plik}: wspólny arkusz stylów landingu`);
  }
});

test('ekrany aplikacji (2026-11-07): każdy zrzut istnieje, ma opis, wymiary i leniwe ładowanie; sekcja mówi, że dane są przykładowe', () => {
  const sekcja = html.match(/<section class="section aplikacja" id="aplikacja">([\s\S]*?)<\/section>/);
  assert.ok(sekcja, 'sekcja #aplikacja istnieje');
  assert.match(czysty(sekcja[1]), /Dane firmy i przetargów na zrzutach są przykładowe/);
  const obrazy = [...sekcja[1].matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  assert.ok(obrazy.length >= 3, 'co najmniej trzy ekrany');
  for (const img of obrazy) {
    const src = img.match(/src="([^"]+)"/)[1];
    assert.ok(fs.existsSync(path.join(LANDING, src)), `brak pliku ${src}`);
    assert.match(img, /alt="[^"]{20,}"/, `${src}: opis dla czytnika ekranu`);
    assert.match(img, /width="\d+" height="\d+"/, `${src}: wymiary (bez skoku układu)`);
    assert.match(img, /loading="lazy"/, `${src}: leniwe ładowanie`);
  }
  assert.match(html, /<a href="#aplikacja">/, 'link w nawigacji');
});

test('treści z żywej strony nie zostały cofnięte', () => {
  assert.match(html, /<section class="section section--soft" id="narzedzia">/);
  assert.match(html, /data-stat="nowe7dni"/);
  assert.match(html, /api \+ '\/stats\/public'/);
  assert.match(html, /Baza Konkurencyjności/);
  assert.match(html, /PrzetargAI jest niezależną, prywatną aplikacją\./);
  assert.match(html, /href="https:\/\/ezamowienia\.gov\.pl"/);
  assert.match(html, /href="https:\/\/ted\.europa\.eu"/);
});

test('wersja.json na stronie = wersja aplikacji (baner „jest nowa wersja” dla APK/Windows)', () => {
  const wersjaAplikacji = JSON.parse(fs.readFileSync(path.join(LANDING, '..', 'mobile', 'app.json'), 'utf8')).expo.version;
  const plik = JSON.parse(fs.readFileSync(path.join(LANDING, 'wersja.json'), 'utf8'));
  assert.equal(plik.wersja, wersjaAplikacji, 'landing/wersja.json musi być podbijane razem z app.json');
  assert.equal(plik.pobierz, 'https://przetarg-ai.pl/pobierz');
  assert.match(plik.data, /^\d{4}-\d{2}-\d{2}$/);
});

test('hosting oddaje wersja.json z CORS (baner „jest nowa wersja” w apce Windows ma origin app://przetargai — smoke 2026-10-26)', () => {
  const firebase = JSON.parse(fs.readFileSync(path.join(LANDING, '..', 'firebase', 'firebase.json'), 'utf8'));
  const hosting = Array.isArray(firebase.hosting) ? firebase.hosting[0] : firebase.hosting;
  const regula = (hosting.headers ?? []).find((h) => h.source === '/wersja.json');
  assert.ok(regula, 'firebase.json: brak nagłówków dla /wersja.json');
  const cors = regula.headers.find((h) => h.key === 'Access-Control-Allow-Origin');
  assert.equal(cors?.value, '*');
});


test('powrót ze Stripe nie potwierdza płatności samym adresem strony', () => {
  const relative = 'upgrade/success.html';
  const page = fs.readFileSync(path.join(LANDING, relative), 'utf8');
  assert.match(page, /Ta strona nie potwierdza opłacenia subskrypcji/);
  assert.match(page, /po potwierdzeniu płatności przez operatora/);
  assert.doesNotMatch(page, /została aktywowana|Masz teraz nielimitowane|Faktura VAT trafi|Subskrypcja aktywna/);
  assert.match(page, /href="\/styles\.css"/);
  assert.ok(fs.existsSync(path.join(LANDING, 'styles.css')));
  assert.match(page, /href="mailto:jakatora68@gmail\.com"/);
});
