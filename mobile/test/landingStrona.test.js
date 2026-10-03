import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
const DOMENA = 'https://przetargai.web.app';

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
  assert.doesNotMatch(html, /https?:\/\/(www\.)?przetarg-ai\.pl/);
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
  }

  assert.match(robots, new RegExp(`^Sitemap: ${DOMENA}/sitemap\\.xml\\s*$`, 'm'));
  assert.match(robots, /^Disallow: \/upgrade$/m, 'strony płatności zostają poza indeksem');
  for (const plik of [sitemap, robots]) {
    assert.doesNotMatch(plik, /przetargai\.pl|przetarg-ai\.pl/);
  }
  // Adres kanoniczny strony głównej jest pierwszym adresem mapy.
  assert.match(html, new RegExp(`<link rel="canonical" href="${adresy[0]}" />`));
});

test('licznik ogłoszeń: bez pobranej wartości strona nie pokazuje żadnej liczby', () => {
  const liczba = html.match(/<div class="stat__num" data-stat="nowe24h">([^<]*)<\/div>/);
  const opis = html.match(/<p data-stat-opis="nowe24h">([^<]*)<\/p>/);
  assert.ok(liczba && opis, 'pole licznika i jego opis istnieją');
  assert.doesNotMatch(liczba[1], /\d/, 'w HTML nie ma liczby „na zapas"');
  assert.doesNotMatch(opis[1], /na żywo|ostatniej dobie/, 'opis zastępczy nie udaje statystyki');
  assert.doesNotMatch(widoczne, /300\+/);

  // Skrypt wstawia liczbę i opis „na żywo" razem, dopiero po poprawnej odpowiedzi.
  const skrypt = html.slice(html.lastIndexOf('<script>'));
  assert.match(skrypt, /if \(!d \|\| typeof d\.nowe24h !== 'number' \|\| !\(d\.nowe24h > 0\)\) return;/);
  assert.match(skrypt, /el\.textContent = [\s\S]*opis\.textContent = 'nowych ogłoszeń w ostatniej dobie — na żywo z naszej bazy';/);
  assert.match(skrypt, /\.catch\(function \(\) \{\}\)/, 'błąd pobierania zostawia tekst z HTML');
});

test('powiadomienia push nie są obiecywane poza opisem planów (cennik zostaje nietknięty)', () => {
  const bezCennika = html
    .replace(/<section class="section" id="cennik">[\s\S]*?<\/section>/, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(czysty(bezCennika), /push|powiadomieni|powiadamia/i);
  assert.doesNotMatch(wezel('SoftwareApplication').description, /powiadamia/i);
  // Cennik i opis planu w danych strukturalnych — bez zmian w tej rundzie.
  assert.match(html, /<li><strong>Powiadomienia push<\/strong> o nowych przetargach<\/li>/);
  assert.match(html, /Subskrypcję aktywujesz z poziomu aplikacji\. Faktura VAT automatycznie\./);
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

test('treści z żywej strony nie zostały cofnięte', () => {
  assert.match(html, /<section class="section section--soft" id="narzedzia">/);
  assert.match(html, /data-stat="nowe24h"/);
  assert.match(html, /api \+ '\/stats\/public'/);
  assert.match(html, /Baza Konkurencyjności/);
  assert.match(html, /PrzetargAI jest niezależną, prywatną aplikacją\./);
  assert.match(html, /href="https:\/\/ezamowienia\.gov\.pl"/);
  assert.match(html, /href="https:\/\/ted\.europa\.eu"/);
});
