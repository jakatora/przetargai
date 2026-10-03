/*
 * IZOLOWANY TEST ZACHOWANIA UI: przetarg → Radar SWZ → powiązanie → checklista (2026-10-03).
 *
 * Uruchamia eksport WEBOWY aplikacji w przeglądarce na lokalnej ATRAPIE API. Nie ma tu
 * produkcji: żadnych kont, AI, e-maili ani pushy. Adres API jest wkompilowany w bundel,
 * więc eksport trzeba zbudować pod atrapę — skrypt sam sprawdza bundel i odmawia pracy,
 * jeśli znajdzie w nim inny adres. Dodatkowo każde żądanie przeglądarki poza 127.0.0.1
 * jest blokowane i kończy test błędem.
 *
 * Eksport (z katalogu mobile/; `--clear` jest KONIECZNE — Metro nie uwzględnia zmiennych
 * EXPO_PUBLIC_* w kluczu pamięci podręcznej i bez niego wkleja adres z poprzedniego buildu):
 *
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:47811/atrapa-api \
 *     npx expo export --platform web --clear --output-dir <katalog>
 *
 * Test (playwright-core nie jest zależnością projektu — podaj ścieżkę do pakietu):
 *
 *   PLAYWRIGHT_CORE=<ścieżka do node_modules/playwright-core> \
 *     node scripts/ui-sciezka-swz.mjs <katalog>
 *
 * PO TEŚCIE, przed buildem Windows/web: `npx expo export --platform web --clear` bez tej
 * zmiennej — inaczej w pamięci podręcznej Metro zostaje adres atrapy.
 *
 * To NIE jest test na urządzeniu: sprawdza logikę ekranów w react-native-web, a nie
 * wygląd ani zachowanie natywne (klawiatura, gesty, SecureStore, powiadomienia).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { zbudujCheckliste, ocenBramke } from '../../backend/src/lib/bramkaOferty.js';
import { terminPytanSwz } from '../../backend/src/lib/terminPytanSwz.js';
import { TYPY_DOKUMENTOW } from '../../backend/src/config/dokumentyKatalog.js';
import { zbudujChecklisteOferty } from '../../firebase/functions/src/lib/checklistaOferty.js';
import { zbudujKalendarz } from '../../firebase/functions/src/lib/kalendarzPrzetargu.js';

const PORT = 47811;
const BAZA = `http://127.0.0.1:${PORT}`;
const API = '/atrapa-api';
const KATALOG = process.argv[2];
const ZRZUTY = process.env.ZRZUTY ?? null;

if (!KATALOG || !fs.existsSync(path.join(KATALOG, 'index.html'))) {
  console.error('Podaj katalog eksportu webowego (z index.html). Instrukcja w nagłówku pliku.');
  process.exit(2);
}
if (!process.env.PLAYWRIGHT_CORE) {
  console.error('Ustaw PLAYWRIGHT_CORE na ścieżkę pakietu playwright-core.');
  process.exit(2);
}

// ── Strażnik bundla: jedyny adres API w kodzie to atrapa ─────────────────────
const katalogJs = path.join(KATALOG, '_expo', 'static', 'js', 'web');
const bundel = fs.readdirSync(katalogJs).map((f) => fs.readFileSync(path.join(katalogJs, f), 'utf8')).join('\n');
assert.ok(bundel.includes(`${BAZA}${API}`), 'bundel nie wskazuje atrapy API — zbuduj eksport wg nagłówka (z --clear)');
for (const zakazany of ['cloudfunctions.net', 'up.railway.app']) {
  assert.ok(!bundel.includes(zakazany), `bundel zawiera adres produkcyjny (${zakazany}) — odmawiam uruchomienia`);
}

// ── Dane atrapy ──────────────────────────────────────────────────────────────
const TERMIN = new Date(Date.now() + 30 * 86_400_000);
TERMIN.setUTCHours(9, 0, 0, 0);
const TERMIN_ISO = TERMIN.toISOString();
const PRZETARG = {
  id: 'bzp:ui-test-1',
  title: 'Remont drogi gminnej w Nowej Wsi',
  organization: 'Gmina Testowa',
  budget: null, currency: 'PLN', deadline: TERMIN_ISO, url: 'http://127.0.0.1/ogloszenie',
  cpv: '45233000', source: 'bzp', zrodlo: null, wojewodztwo: null,
  wadium_wymagane: null, wadium_kwota: null, wadium_wiele_czesci: false,
  kryterium_oceny: null, liczba_czesci: null,
};
const DOPASOWANIE = {
  id: 'm-ui-1', confidence_score: 82, reasoning: 'Zgodność kodu CPV z profilem firmy.',
  scorer: 'heurystyka', created_at: new Date().toISOString(), tender: PRZETARG,
};
const UZYTKOWNIK = {
  id: 'u-ui-test', email: 'ui-test@example.invalid', company_nip: null, company_name: 'Firma Testowa',
  premium_tier: 'free', keywords: ['drogi'], cpv_codes: ['45233000'],
};
const SWZ = 'Wykonawca złoży informację z Krajowego Rejestru Karnego oraz zaświadczenie z ZUS o niezaleganiu w opłacaniu składek na ubezpieczenia społeczne.';
const nazwaTypu = (id) => TYPY_DOKUMENTOW.find((t) => t.id === id)?.nazwa ?? id;

/** Stan serwera-atrapy + dziennik żądań (do asercji). */
const stan = {
  postepowania: [],
  trescSwz: new Map(),        // postepowanieId → 'wklejona'
  powiazanie: null,           // { tender_id, postepowanie_id, nazwa }
  zepsuteOdczytyPowiazania: 0, // ile kolejnych GET powiązania ma zwrócić 503
  zapisyPowiazania: 0,
  dziennik: [],
};

function odpowiedzApi(metoda, sciezka, cialo) {
  const blad = (status, message) => ({ status, json: { error: { code: 'ATRAPA', message } } });
  const ok = (json, status = 200) => ({ status, json });

  if (sciezka === '/auth/me' && metoda === 'GET') return ok({ user: UZYTKOWNIK });
  if (sciezka === '/stats/public') return ok({ lacznie: 0, nowe24h: 0, nowe7dni: 0 });
  if (sciezka === '/matches' && metoda === 'GET') return ok({ matches: [DOPASOWANIE], next_before: null });
  if (sciezka === '/matches/statystyki') return ok({ dzis: 1, w_tym_tygodniu: 1, limit_dzienny: 5, zacheta: null });
  if (sciezka === '/matches/saved/ids') return ok({ ids: [] });
  if (sciezka === `/matches/${DOPASOWANIE.id}/wyniki`) return ok({ wyniki: null });
  if (sciezka === '/api/przetarg/podprogowe/preferencje') return ok({ preferencje: null });

  // ── Radar SWZ (kształty z backend/src/routes/radarSwz.js) ──
  if (sciezka === '/api/przetarg/swz/postepowania' && metoda === 'GET') {
    return ok({ postepowania: stan.postepowania.map((p) => ({
      id: p.id, nazwa: p.nazwa, data_ogloszenia: p.data_ogloszenia, termin_skladania_ofert: p.termin_skladania_ofert,
      termin_pytania: terminPytanSwz({ dataOgloszenia: p.data_ogloszenia, terminSkladaniaOfert: p.termin_skladania_ofert }),
      liczba_pytan: 0, liczba_zmian: 0, do_odznaczenia: 0,
    })) });
  }
  if (sciezka === '/api/przetarg/swz/postepowania' && metoda === 'POST') {
    const termin = cialo?.termin_skladania_ofert ? new Date(cialo.termin_skladania_ofert).toISOString() : null;
    const p = {
      id: `p-ui-${stan.postepowania.length + 1}`, nazwa: String(cialo?.nazwa ?? '').trim(),
      data_ogloszenia: cialo?.data_ogloszenia ? new Date(cialo.data_ogloszenia).toISOString() : null,
      termin_skladania_ofert: termin,
    };
    stan.postepowania.push(p);
    return ok({ postepowanie: p }, 201);
  }
  const detal = sciezka.match(/^\/api\/przetarg\/swz\/postepowania\/([^/]+)$/);
  if (detal && metoda === 'GET') {
    const p = stan.postepowania.find((x) => x.id === detal[1]);
    if (!p) return blad(404, 'Nie znaleziono postępowania SWZ o podanym id.');
    const checklista = zbudujCheckliste([]);
    return ok({
      postepowanie: p,
      termin_pytania: terminPytanSwz({ dataOgloszenia: p.data_ogloszenia, terminSkladaniaOfert: p.termin_skladania_ofert }),
      pytania: [], zmiany: [], checklista, bramka: ocenBramke(checklista),
      tresc_swz: { zrodlo: stan.trescSwz.get(p.id) ?? 'brak', zapisana_at: stan.trescSwz.has(p.id) ? new Date().toISOString() : null },
    });
  }
  const analiza = sciezka.match(/^\/api\/przetarg\/swz\/postepowania\/([^/]+)\/analiza$/);
  if (analiza && metoda === 'POST') {
    // Jak prawdziwy backend: treść zapamiętana PRZED AI, a AI w tym teście „nie działa".
    if (typeof cialo?.swz === 'string' && cialo.swz.trim() && !stan.trescSwz.has(analiza[1])) {
      stan.trescSwz.set(analiza[1], 'wklejona');
    }
    return { status: 503, json: { error: {
      code: 'SERVICE_UNAVAILABLE', message: 'Analiza SWZ chwilowo niedostępna — spróbuj ponownie za chwilę.',
      details: { tresc_swz: { zrodlo: stan.trescSwz.get(analiza[1]) ?? 'brak' } },
    } } };
  }

  // ── Sejf ──
  if (sciezka === '/api/przetarg/sejf/dokumenty' && metoda === 'GET') {
    return ok({ dokumenty: [{ id: 'd-1', typ_dokumentu: 'krk', nazwaTypu: nazwaTypu('krk'), dataWaznosci: '2099-12-31', status: 'gotowy' }] });
  }
  if (sciezka === '/api/przetarg/sejf/katalog') {
    return ok({ typy: TYPY_DOKUMENTOW.map((t) => ({ id: t.id, nazwa: t.nazwa })) });
  }
  const dopasowanie = sciezka.match(/^\/api\/przetarg\/sejf\/dopasowanie\/([^/]+)$/);
  if (dopasowanie && metoda === 'POST') {
    const zrodlo = stan.trescSwz.get(dopasowanie[1]) ?? 'brak';
    return ok({
      postepowanie_id: dopasowanie[1], dzien_zlozenia: TERMIN_ISO.slice(0, 10),
      wymagane_typy: zrodlo === 'brak' ? [] : ['krk', 'zus'],
      swieze: [], przeterminuja_sie: [], brakuje: [],
      zrodlo_swz: zrodlo, wymagania_heurystyczne: true,
    });
  }

  // ── Powiązanie i checklista (kształty z firebase/functions/src/routes/wygrywalnosc.js) ──
  const swz = sciezka.match(/^\/wygrywalnosc\/tender\/([^/]+)\/swz$/);
  if (swz && metoda === 'GET') {
    if (stan.zepsuteOdczytyPowiazania > 0) {
      stan.zepsuteOdczytyPowiazania -= 1;
      return blad(503, 'Odczyt powiązania chwilowo niedostępny (atrapa).');
    }
    return ok({ powiazanie: stan.powiazanie });
  }
  if (swz && metoda === 'PUT') {
    // UTRATA ODPOWIEDZI: serwer ZAPISUJE powiązanie, a klient dostaje 502 — i następny
    // odczyt też pada. Aplikacja nie może wtedy twierdzić ani „powiązano", ani „nie powiązano".
    const p = stan.postepowania.find((x) => x.id === cialo?.postepowanie_id);
    if (!p) return blad(404, 'Nie znaleziono tej analizy SWZ na Twoim koncie');
    stan.powiazanie = { tender_id: decodeURIComponent(swz[1]), postepowanie_id: p.id, nazwa: p.nazwa, powiazano_o: new Date().toISOString() };
    stan.zapisyPowiazania += 1;
    stan.zepsuteOdczytyPowiazania = 1;
    return blad(502, 'Moduł analizy SWZ jest chwilowo niedostępny. Spróbuj za chwilę.');
  }
  const lista = sciezka.match(/^\/wygrywalnosc\/tender\/([^/]+)\/checklista$/);
  if (lista && metoda === 'POST') {
    const teraz = Date.now();
    return ok({
      checklista: zbudujChecklisteOferty({ tender: PRZETARG, wymagania: cialo?.wymagania ?? [], dokumenty: cialo?.dokumenty ?? [], teraz }),
      kalendarz: zbudujKalendarz(PRZETARG, { teraz: new Date(teraz).toISOString() }),
    });
  }
  return blad(404, `atrapa: brak trasy ${metoda} ${sciezka}`);
}

const TYPY_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf' };
const serwer = http.createServer((req, res) => {
  const url = new URL(req.url, BAZA);
  if (url.pathname.startsWith(`${API}/`)) {
    let surowe = '';
    req.on('data', (c) => { surowe += c; });
    req.on('end', () => {
      let cialo = null;
      try { cialo = surowe ? JSON.parse(surowe) : null; } catch { cialo = null; }
      const sciezka = url.pathname.slice(API.length);
      const { status, json } = odpowiedzApi(req.method, sciezka, cialo);
      stan.dziennik.push({ metoda: req.method, sciezka, status, cialo });
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(json));
    });
    return;
  }
  const wzgledna = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let plik = path.join(KATALOG, wzgledna);
  if (!plik.startsWith(path.resolve(KATALOG)) || !fs.existsSync(plik) || fs.statSync(plik).isDirectory()) {
    plik = path.join(KATALOG, 'index.html'); // SPA
  }
  res.writeHead(200, { 'Content-Type': TYPY_MIME[path.extname(plik)] ?? 'application/octet-stream' });
  fs.createReadStream(plik).pipe(res);
});

// ── Sterownik przeglądarki ───────────────────────────────────────────────────
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const LIMIT = 20_000;
const wyniki = [];
const zewnetrzne = [];

async function nowaStrona(przegladarka) {
  const kontekst = await przegladarka.newContext({ locale: 'pl-PL', viewport: { width: 420, height: 900 } });
  // Twarda izolacja: nic poza lokalną atrapą nie wychodzi z przeglądarki.
  await kontekst.route('**/*', (trasa) => {
    const adres = trasa.request().url();
    if (adres.startsWith(`${BAZA}/`) || adres.startsWith('data:') || adres.startsWith('blob:')) return trasa.continue();
    zewnetrzne.push(adres);
    return trasa.abort();
  });
  await kontekst.addInitScript(() => {
    localStorage.setItem('przetargai_token', 'token-atrapa-ui');
    localStorage.setItem('przetargai.onboarding_pominiety', '1');
  });
  const strona = await kontekst.newPage();
  await strona.goto(`${BAZA}/`);
  return { kontekst, strona };
}

/** Widoczny element z tekstem (poprzednie ekrany stosu zostają w DOM jako ukryte). */
const widoczny = (strona, tekst, { exact = false } = {}) => strona.getByText(tekst, { exact }).filter({ visible: true }).first();
const czekaj = (strona, tekst, opcje) => widoczny(strona, tekst, opcje).waitFor({ state: 'visible', timeout: LIMIT });
/** Klik myszą w środek elementu — `click()` Playwrighta na Pressable z RN-web bywa nieskuteczny. */
async function klik(strona, tekst, opcje) {
  const el = widoczny(strona, tekst, opcje);
  await el.waitFor({ state: 'visible', timeout: LIMIT });
  await el.scrollIntoViewIfNeeded();
  const ramka = await el.boundingBox();
  await strona.mouse.click(ramka.x + ramka.width / 2, ramka.y + ramka.height / 2);
}
const brak = async (strona, tekst) => assert.equal(await strona.getByText(tekst).filter({ visible: true }).count(), 0, `nie powinno być: „${tekst}"`);
const pole = (strona, placeholder, nr = 0) => strona.getByPlaceholder(placeholder).filter({ visible: true }).nth(nr);
const zrzut = async (strona, nazwa) => { if (ZRZUTY) await strona.screenshot({ path: path.join(ZRZUTY, `${nazwa}.png`), fullPage: true }); };

async function scenariusz(nazwa, przegladarka, kroki) {
  const { kontekst, strona } = await nowaStrona(przegladarka);
  const bledyStrony = [];
  strona.on('pageerror', (e) => bledyStrony.push(e.message));
  try {
    await kroki(strona);
    assert.deepEqual(bledyStrony, [], 'wyjątki JS na stronie');
    wyniki.push({ nazwa, wynik: 'PASS' });
  } catch (err) {
    await zrzut(strona, `BLAD-${wyniki.length + 1}`).catch(() => {});
    wyniki.push({ nazwa, wynik: 'FAIL', blad: err.message.split('\n').slice(0, 6).join(' | ') });
  } finally {
    await kontekst.close();
  }
}

await new Promise((gotowe) => serwer.listen(PORT, '127.0.0.1', gotowe));
const przegladarka = await chromium.launch({ channel: 'chrome', headless: true });

try {
  await scenariusz('ścieżka: jedno następne działanie i Radar wypełniony danymi przetargu', przegladarka, async (strona) => {
    await klik(strona, PRZETARG.title);
    await klik(strona, 'Krok po kroku do wygranej');
    await czekaj(strona, 'Następny krok', { exact: true });
    await czekaj(strona, 'Postęp: 0/12 kroków');
    await brak(strona, 'Komplet kroków odhaczony');
    await zrzut(strona, '1-sciezka');
    // „Oznacz jako zrobione" przesuwa następny krok na kolejny wymagany.
    await klik(strona, 'Oznacz jako zrobione', { exact: true });
    await czekaj(strona, 'Postęp: 1/12 kroków');
    await klik(strona, 'Oznacz jako zrobione', { exact: true });
    await czekaj(strona, 'Postęp: 2/12 kroków');
    // Cofamy odhaczenie pierwszego kroku na liście → znów jest następnym działaniem.
    await klik(strona, 'Przeczytaj SWZ i zrozum zamówienie', { exact: true });
    await czekaj(strona, 'Postęp: 1/12 kroków');
    await klik(strona, 'Otwórz narzędzie', { exact: true });
    await czekaj(strona, 'Weź postępowanie pod radar');
    await czekaj(strona, 'Pola wypełniliśmy danymi z ogłoszenia');
    assert.equal(await pole(strona, 'np. Budowa drogi gminnej').inputValue(), PRZETARG.title);
    // Termin: dzień kalendarzowy w Polsce (09:00 UTC to ten sam dzień); data ogłoszenia —
    // feed dopasowań jej nie podaje, więc pole zostaje puste zamiast zgadywanej daty.
    assert.equal(await pole(strona, 'RRRR-MM-DD', 1).inputValue(), TERMIN_ISO.slice(0, 10));
    assert.equal(await pole(strona, 'RRRR-MM-DD', 0).inputValue(), '');
    await zrzut(strona, '2-radar-wypelniony');
    assert.equal(stan.postepowania.length, 0, 'samo otwarcie Radaru niczego nie tworzy');
  });

  await scenariusz('katalog narzędzi bez kontekstu: Radar z pustym formularzem, bez karty powiązania', przegladarka, async (strona) => {
    const odZadania = stan.dziennik.length; // dziennik jest wspólny dla scenariuszy
    await czekaj(strona, PRZETARG.title);
    await klik(strona, 'Narzędzia', { exact: true });
    await klik(strona, 'Radar SWZ', { exact: true });
    await czekaj(strona, 'Weź postępowanie pod radar');
    assert.equal(await pole(strona, 'np. Budowa drogi gminnej').inputValue(), '');
    assert.equal(await pole(strona, 'RRRR-MM-DD', 1).inputValue(), '');
    await brak(strona, 'Pola wypełniliśmy danymi z ogłoszenia');
    await brak(strona, 'Po dodaniu powiążemy analizę z tym przetargiem');
    assert.ok(
      !stan.dziennik.slice(odZadania).some((z) => z.sciezka.includes('/wygrywalnosc/')),
      'bez przetargu nie pytamy o powiązanie',
    );
  });

  await scenariusz('szczegóły → checklista → Radar → powiązanie po utracie odpowiedzi → AI 503 → checklista z wymaganiami', przegladarka, async (strona) => {
    await klik(strona, PRZETARG.title);
    await klik(strona, 'Co muszę mieć do dnia składania', { exact: true });
    await czekaj(strona, 'Co musisz mieć do dnia składania');
    await czekaj(strona, 'Nie wiemy jeszcze, czego wymaga to postępowanie');
    await zrzut(strona, '3-checklista-bez-analizy');

    await klik(strona, 'Dodaj SWZ w Radarze', { exact: true });
    await czekaj(strona, 'Po dodaniu powiążemy analizę z tym przetargiem');
    assert.equal(await pole(strona, 'np. Budowa drogi gminnej').inputValue(), PRZETARG.title);
    // Checklista przekazuje termin składania z kalendarza postępowania.
    assert.equal(await pole(strona, 'RRRR-MM-DD', 1).inputValue(), TERMIN_ISO.slice(0, 10));
    await klik(strona, 'Dodaj do radaru', { exact: true });
    await czekaj(strona, 'Termin składania ofert:');
    await brak(strona, 'Termin składania ofert: nieznany');

    // Zapis powiązania „padł" (502) i odczyt też (503) — a serwer powiązanie MA.
    await czekaj(strona, 'Nie mamy potwierdzenia, że ta analiza jest powiązana z przetargiem');
    await czekaj(strona, 'Powiązanie mogło się zapisać mimo błędu');
    await brak(strona, 'Ta analiza jest powiązana z wybranym przetargiem');
    await brak(strona, 'jeszcze jej nie widzi');
    assert.equal(stan.zapisyPowiazania, 1);
    await zrzut(strona, '4-powiazanie-niepotwierdzone');

    // Sam odczyt (bez drugiego zapisu) potwierdza stan faktyczny.
    await klik(strona, 'Sprawdź powiązanie', { exact: true });
    await czekaj(strona, 'Ta analiza jest powiązana z wybranym przetargiem');
    assert.equal(stan.zapisyPowiazania, 1, '„Sprawdź powiązanie" nie zapisuje ponownie');

    // Pierwsza SWZ przy niedziałającym AI: błąd jawny, a treść potwierdzona przez serwer.
    await czekaj(strona, 'Radar nie ma jeszcze treści SWZ tego postępowania');
    await pole(strona, 'Wklej tu treść SWZ…').fill(SWZ);
    await klik(strona, 'Wygeneruj pytania', { exact: true });
    await czekaj(strona, 'Analiza SWZ chwilowo niedostępna');
    await czekaj(strona, 'Treść SWZ jest zapisana (wklejona przez Ciebie)');
    await zrzut(strona, '5-radar-ai-503');

    await klik(strona, 'Otwórz checklistę dokumentów', { exact: true });
    await czekaj(strona, 'Wymagania bierzemy z analizy');
    await czekaj(strona, 'Wykryto automatycznie 2');
    await czekaj(strona, 'lista może być niepełna');
    await czekaj(strona, 'Brakuje (1)');
    await czekaj(strona, 'Masz (1)');
    await czekaj(strona, 'Lista może być niepełna — sprawdź pozostałe wymagania SWZ');
    await brak(strona, 'Wszystkie obowiązkowe dokumenty są ważne');
    await zrzut(strona, '6-checklista-z-wymaganiami');

    const wyslaneWymagania = stan.dziennik.filter((z) => z.sciezka.endsWith('/checklista')).at(-1).cialo.wymagania;
    assert.deepEqual(wyslaneWymagania.map((w) => w.kod), ['krk', 'zus']);
    const utworzone = stan.dziennik.find((z) => z.metoda === 'POST' && z.sciezka === '/api/przetarg/swz/postepowania').cialo;
    assert.equal(utworzone.nazwa, PRZETARG.title);
  });
} finally {
  await przegladarka.close();
  await new Promise((koniec) => serwer.close(koniec));
}

const nieznane = [...new Set(stan.dziennik.filter((z) => z.status === 404 && String(z.sciezka)).map((z) => `${z.metoda} ${z.sciezka}`))];
for (const w of wyniki) console.log(`${w.wynik}  ${w.nazwa}${w.blad ? `\n      ${w.blad}` : ''}`);
console.log(`żądania do atrapy: ${stan.dziennik.length}; trasy bez atrapy (404): ${nieznane.length ? nieznane.join(', ') : 'brak'}`);
console.log(`żądania poza 127.0.0.1 (zablokowane): ${zewnetrzne.length ? zewnetrzne.join(', ') : 'brak'}`);
const porazka = wyniki.some((w) => w.wynik !== 'PASS') || zewnetrzne.length > 0;
process.exit(porazka ? 1 : 0);
