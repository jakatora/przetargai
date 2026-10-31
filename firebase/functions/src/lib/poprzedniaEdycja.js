import { dzialCpv, klasaCpv } from './wynikiAgregacja.js';
import { normNip } from './profilKonkurenta.js';
import { normalize } from './textNorm.js';

/*
 * POPRZEDNIA EDYCJA PRZETARGU (2026-10-31, z analizy konkurencji: Pressinfo „Analizator”).
 *
 * Zamawiający kupuje co roku to samo: odczynniki, sprzątanie, paliwo. Dla wykonawcy najcenniejsza
 * podpowiedź cenowa to „kto to robi teraz i za ile wygrał”. Szukamy jej w rozstrzygnięciach TEGO
 * zamawiającego (po NIP-ie): ta sama klasa CPV (albo dział + bardzo podobny tytuł), podobny tytuł,
 * umowa, która właśnie się kończy albo była zawarta 5–30 miesięcy wcześniej.
 *
 * CZYSTA logika: wyniki i zegar parametrem.
 */

const DZIEN_MS = 86_400_000;
/** Słowa, które są w prawie każdym tytule i niczego nie odróżniają. */
const POMIJANE = new Set(['dostawa', 'dostawy', 'uslugi', 'usluga', 'swiadczenie', 'wykonanie', 'realizacja', 'zamowienia', 'zamowienie',
  'roku', 'rok', 'latach', 'lata', 'okresie', 'oraz', 'przez', 'dla', 'potrzeb', 'zakup', 'sukcesywna', 'sukcesywne', 'sukcesywnych',
  'zakresie', 'czesci', 'czesc', 'pakiet', 'pakiety', 'zadanie', 'zadania', 'postepowanie', 'przetarg', 'podstawowym', 'trybie',
  // Formułki, które dzielą RÓŻNE zakupy (dwa różne leki w CZD 31.10.2026 miały podobieństwo 0,61).
  'produktu', 'produktow', 'produkty', 'leczniczego', 'leczniczych', 'stosowanego', 'stosowanych', 'ramach', 'programu', 'lekowego',
  'materialow', 'artykulow', 'sprzetu', 'urzadzen', 'wyrobow', 'srodkow', 'rodzajow', 'roznych']);

function slowa(tytul, pomin = null) {
  return new Set(normalize(String(tytul ?? ''))
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter((s) => s.length >= 4 && !/^\d+r?$/.test(s) && !POMIJANE.has(s))
    .map((s) => s.slice(0, 6))
    .filter((s) => !pomin?.has(s)));
}

/**
 * Ważone podobieństwo Jaccarda rdzeni słów tytułów (0–1). `pomin` = rdzenie bez znaczenia (nazwa
 * zamawiającego), `waga` = rzadkość rdzenia u tego zamawiającego (bez wag — każdy waży 1).
 */
export function podobienstwoTytulow(a, b, pomin = null, waga = null) {
  const x = slowa(a, pomin);
  const y = slowa(b, pomin);
  if (!x.size || !y.size) return 0;
  const w = (r) => (waga ? waga(r) : 1);
  let wspolne = 0;
  let suma = 0;
  for (const r of new Set([...x, ...y])) {
    suma += w(r);
    if (x.has(r) && y.has(r)) wspolne += w(r);
  }
  return suma > 0 ? wspolne / suma : 0;
}

/*
 * Progi zmierzone na 98 otwartych przetargach z produkcji (31.10.2026): przy 0,2/0,4 i bez wag
 * trafiały „konserwy” ↔ „wyroby piekarskie” w tym samym zakładzie karnym, „staplery” ↔ „heparyna”
 * w tym samym SPZOZ i dwa różne leki w Centrum Zdrowia Dziecka („produkt leczniczy stosowany w ramach
 * programu…”). Waga = rzadkość rdzenia w tytułach TEGO zamawiającego (jak IDF): jego nazwa i stałe
 * formułki ważą mało, nazwa leku czy usługi — dużo.
 */
const PROG_Z_KLASA = 0.34;
const PROG_Z_DZIALEM = 0.5;

/** Poniżej tylu tytułów rzadkość nic nie mówi (nowe słowo ważyłoby kilka razy więcej niż reszta). */
const MIN_TYTULOW_DO_WAG = 8;

/** Funkcja wagi rdzenia z tytułów zamawiającego: log((N + 1) / (df + 0,5)); za mało tytułów — null. */
export function wagiZamawiajacego(wyniki) {
  const tytuly = (wyniki ?? []).map((w) => w?.tytul).filter(Boolean);
  const df = new Map();
  for (const t of tytuly) for (const r of slowa(t)) df.set(r, (df.get(r) ?? 0) + 1);
  const n = tytuly.length;
  if (n < MIN_TYTULOW_DO_WAG) return null;
  return (r) => Math.log((n + 1) / ((df.get(r) ?? 0) + 0.5));
}

const ms = (iso) => { const t = Date.parse(String(iso ?? '').slice(0, 10)); return Number.isFinite(t) ? t : NaN; };

/** Czy umowa z rozstrzygnięcia to „poprzednia edycja” w czasie: kończy się blisko nowego przetargu. */
function wOknieCzasu(czesc, odniesienie) {
  const koniec = ms(czesc?.koniecUmowy);
  if (Number.isFinite(koniec)) return koniec >= odniesienie - 120 * DZIEN_MS && koniec <= odniesienie + 300 * DZIEN_MS;
  const zawarcie = ms(czesc?.dataUmowy);
  return Number.isFinite(zawarcie) && zawarcie >= odniesienie - 30 * 30.4 * DZIEN_MS && zawarcie <= odniesienie - 150 * DZIEN_MS;
}

/**
 * Najlepiej pasująca poprzednia edycja albo null.
 * @param {object} tender przetarg (cpv_main, title, zamawiajacy_nip, postepowanie_id, published_at, deadline)
 * @param {object[]} wyniki rozstrzygnięcia tego zamawiającego
 */
export function poprzedniaEdycja(tender, wyniki, { teraz = Date.now() } = {}) {
  const klasa = klasaCpv(tender?.cpv_main ?? tender?.cpv);
  const dzial = dzialCpv(tender?.cpv_main ?? tender?.cpv);
  if (!dzial || !tender?.title) return null;
  const odniesienie = Number.isFinite(ms(tender.published_at)) ? ms(tender.published_at) : teraz;
  const nazwaZamawiajacego = slowa(tender.organization);
  const waga = wagiZamawiajacego(wyniki);
  let najlepsza = null;
  for (const w of Array.isArray(wyniki) ? wyniki : []) {
    if (!w || (tender.postepowanie_id && (w.postepowanie_id ?? w.tenderId) === tender.postepowanie_id)) continue;
    if (Number.isFinite(ms(w.opublikowano)) && ms(w.opublikowano) > odniesienie) continue;
    const kodW = Array.isArray(w.cpv) ? w.cpv[0] : w.cpv;
    const zKlasa = klasa && klasaCpv(kodW) === klasa;
    if (!zKlasa && dzialCpv(kodW) !== dzial) continue;
    const podob = podobienstwoTytulow(tender.title, w.tytul, nazwaZamawiajacego, waga);
    if (podob < (zKlasa ? PROG_Z_KLASA : PROG_Z_DZIALEM)) continue;
    const czesci = (w.czesci ?? []).filter((c) => c && !c.uniewaznione && c.zwyciezca?.nazwa && wOknieCzasu(c, odniesienie));
    if (!czesci.length) continue;
    const ocena = podob + (zKlasa ? 0.2 : 0);
    if (najlepsza && ocena <= najlepsza.ocena) continue;
    najlepsza = { ocena, wynik: w, czesci, podob };
  }
  if (!najlepsza) return null;
  const { wynik, czesci, podob } = najlepsza;
  const wykonawcy = [];
  const widziani = new Set();
  for (const c of czesci) {
    const k = normNip(c.zwyciezca.nip) ?? c.zwyciezca.nazwa;
    if (widziani.has(k)) continue;
    widziani.add(k);
    wykonawcy.push({ nazwa: c.zwyciezca.nazwa, nip: normNip(c.zwyciezca.nip) });
  }
  const ceny = czesci.filter((c) => c.spojne !== false && Number.isFinite(c.cenaWybrana)).map((c) => c.cenaWybrana);
  const wartosci = czesci.map((c) => c.wartoscUmowy).filter((v) => Number.isFinite(v) && v > 0);
  const kwota = ceny.length ? ceny.reduce((s, v) => s + v, 0) : (wartosci.length ? wartosci.reduce((s, v) => s + v, 0) : null);
  const konce = czesci.map((c) => c.koniecUmowy).filter((k) => Number.isFinite(ms(k))).sort();
  const oferty = czesci.map((c) => c.liczbaOfert).filter((n) => Number.isFinite(n));
  return {
    tytul: wynik.tytul ?? null,
    opublikowano: wynik.opublikowano ?? null,
    wykonawcy: wykonawcy.slice(0, 3),
    kwota: kwota !== null ? Math.round(kwota) : null,
    koniec_umowy: konce.at(-1) ?? null,
    liczba_ofert: oferty.length ? Math.max(...oferty) : null,
    czesci: czesci.length,
    podobienstwo: Math.round(podob * 100) / 100,
  };
}
