/*
 * Benchmark rynku z ROZSTRZYGNIĘĆ — czysta logika, zero I/O i zero AI.
 *
 * Odpowiada na dwa pytania, które wykonawca zadaje PRZED włożeniem tygodnia
 * w ofertę: „ile firm zwykle startuje u tego zamawiającego" i „jaka cena tam
 * wygrywa". Liczy się z kolekcji `rozstrzygniecia` (BZP + TED), nie z ponownego
 * pobierania rejestru.
 *
 * ── CZTERY ZASADY, KTÓRE TU OBOWIĄZUJĄ ───────────────────────────────────────
 *
 * 1. NIGDY nie oddajemy wniosku z próbki mniejszej niż `MIN_PROBKA`. Mediana
 *    z dwóch postępowań to nie statystyka, tylko anegdota z paskiem postępu.
 *    Zamiast liczby idzie jawne `wystarczajacaProbka: false` i powód.
 * 2. NIGDY nie liczymy „rabatu" z wartości szacowanej BZP. 4.3 jest NETTO
 *    (art. 28 Pzp), a 6.4 zwykle BRUTTO — zmierzona mediana ilorazu 1,0489
 *    ze skupiskami na 1,23 i 1,17 to stawki VAT, nie drożyzna rynku. Rabat
 *    liczymy WYŁĄCZNIE dla TED, gdzie obie liczby są w eForms i obie netto.
 * 3. Ceny biorą się tylko z części oznaczonych `spojne` — zamawiający wpisują
 *    do BZP kwoty arytmetycznie niemożliwe (cena zwycięzcy poniżej najniższej
 *    oferty). Zaniżony orientacyjny koszt to firma, która przez naszą podpowiedź
 *    przegrywa przetarg.
 * 4. Grupujemy po NIP-ie zamawiającego, nie po nazwie. Ta sama jednostka pisze
 *    się raz „SĄD REJONOWY W RZESZOWIE", raz „Sąd Rejonowy w Rzeszowie" —
 *    grupowanie po nazwie rozbiłoby jednego zamawiającego na kilku i zaniżyło
 *    każdą próbkę.
 */

import { dzialCpv, mediana, normWojewodztwo } from './wynikiAgregacja.js';

/** Ile części musi mieć kubełek, żeby wolno było powiedzieć cokolwiek. */
export const MIN_PROBKA = 5;

/** Ile cen musi mieć kubełek, żeby wolno było podać widełki cenowe. */
export const MIN_PROBKA_CENY = 3;

const liczbowe = (lista) => lista.filter((n) => Number.isFinite(n));

function statystyka(wartosci, minimum) {
  const dane = liczbowe(wartosci);
  if (dane.length < minimum) return null;
  return {
    mediana: mediana(dane),
    min: Math.min(...dane),
    max: Math.max(...dane),
    n: dane.length,
  };
}

/** Klucz kubełka: jeden zamawiający (po NIP-ie). */
export function kluczZamawiajacego(wynik) {
  const nip = wynik?.zamawiajacyNip ?? wynik?.zamawiajacy_nip ?? null;
  return nip ? `nip:${String(nip)}` : null;
}

/**
 * Klucz kubełka: dział CPV + województwo — „taka robota u mnie w regionie".
 *
 * Brak województwa daje null, a NIE klucz samego działu: inaczej kubełek
 * regionalny zderzyłby się kluczem z krajowym i po cichu go nadpisał, zostawiając
 * pod nazwą „cały kraj" wyłącznie rozstrzygnięcia BEZ regionu.
 */
export function kluczDzialuCpv(wynik) {
  const dzial = dzialCpv(wynik?.cpv);
  const woj = normWojewodztwo(wynik?.wojewodztwo);
  if (!dzial || !woj) return null;
  return `cpv:${dzial}|${woj}`;
}

/** Klucz kubełka: sam dział CPV — szersza próbka, gdy region jej nie uzbiera. */
export function kluczDzialuCpvKraj(wynik) {
  const dzial = dzialCpv(wynik?.cpv);
  return dzial ? `cpv:${dzial}` : null;
}

function pustyKubelek(klucz) {
  return {
    klucz,
    etykieta: null,
    zrodla: new Set(),
    ogloszenia: 0,
    czesci: 0,
    uniewaznione: 0,
    ceny: [],
    oferty: [],
    ofertyMsp: [],
    pozycjeCeny: [],
    rabaty: [],
    maliTak: 0,
    maliZnane: 0,
    odDaty: null,
    doDaty: null,
  };
}

/**
 * Rabat części względem kosztorysu — TYLKO gdy obie liczby są w tej samej bazie.
 *
 * TED podaje `estimated-value-lot` i `tender-value` jako wartości eForms (netto),
 * więc iloraz ma sens. Dla BZP zwraca null i to jest celowe (zasada 2).
 *
 * @returns {number|null} dodatnie = taniej niż kosztorys, w procentach
 */
export function rabatCzesci(wynik, czesc) {
  if (wynik?.zrodlo !== 'ted') return null;
  const szacunek = czesc?.wartoscSzacowanaNetto;
  const cena = czesc?.cenaWybrana;
  if (!Number.isFinite(szacunek) || !Number.isFinite(cena) || szacunek <= 0) return null;
  return Math.round(((szacunek - cena) / szacunek) * 1000) / 10;
}

function dolozWynik(kubelek, wynik) {
  kubelek.ogloszenia += 1;
  if (wynik.zrodlo) kubelek.zrodla.add(wynik.zrodlo);
  kubelek.etykieta ??= wynik.zamawiajacy ?? null;

  const dzien = wynik.opublikowano ?? null;
  if (dzien) {
    if (!kubelek.odDaty || dzien < kubelek.odDaty) kubelek.odDaty = dzien;
    if (!kubelek.doDaty || dzien > kubelek.doDaty) kubelek.doDaty = dzien;
  }

  for (const czesc of wynik.czesci ?? []) {
    kubelek.czesci += 1;
    if (czesc.uniewaznione) {
      kubelek.uniewaznione += 1;
      // Część unieważniona NADAL niesie liczbę ofert (np. wszystkie odrzucone),
      // ale nie niesie ceny ani zwycięzcy — i tak ma być liczona do odsetka.
    }
    if (czesc.spojne && Number.isFinite(czesc.cenaWybrana)) kubelek.ceny.push(czesc.cenaWybrana);
    if (Number.isFinite(czesc.liczbaOfert)) kubelek.oferty.push(czesc.liczbaOfert);
    if (Number.isFinite(czesc.liczbaOfertMsp)) kubelek.ofertyMsp.push(czesc.liczbaOfertMsp);
    if (Number.isFinite(czesc.pozycjaCeny)) kubelek.pozycjeCeny.push(czesc.pozycjaCeny);
    const rabat = rabatCzesci(wynik, czesc);
    if (rabat !== null) kubelek.rabaty.push(rabat);
    if (czesc.wygralMaly === true || czesc.wygralMaly === false) {
      kubelek.maliZnane += 1;
      if (czesc.wygralMaly) kubelek.maliTak += 1;
    }
  }
}

function domknijKubelek(kubelek, { minProbka, minProbkaCeny, wymiar }) {
  const wystarczajaca = kubelek.czesci >= minProbka;
  return {
    klucz: kubelek.klucz,
    wymiar,
    etykieta: kubelek.etykieta,
    zrodla: [...kubelek.zrodla].sort(),
    probka: {
      ogloszenia: kubelek.ogloszenia,
      czesci: kubelek.czesci,
      od: kubelek.odDaty,
      do: kubelek.doDaty,
    },
    /*
     * Jawna flaga zamiast cichego pominięcia kubełka: ekran ma pokazać
     * „za mało danych, żeby cokolwiek powiedzieć", a nie pustkę, którą
     * użytkownik odczyta jako „nikt tu nie startuje".
     */
    wystarczajacaProbka: wystarczajaca,
    powodBrakuWniosku: wystarczajaca ? null : `probka_${kubelek.czesci}_z_${minProbka}`,
    oferty: wystarczajaca ? statystyka(kubelek.oferty, 1) : null,
    ofertyMsp: wystarczajaca ? statystyka(kubelek.ofertyMsp, 1) : null,
    cena: wystarczajaca ? statystyka(kubelek.ceny, minProbkaCeny) : null,
    // Gdzie w widełkach konkursu ląduje cena zwycięzcy (0 = najtaniej, 1 = najdrożej).
    // Mediana blisko 0 znaczy „tu wygrywa cena", bliżej 0,5 — „liczy się coś jeszcze".
    pozycjaCeny: wystarczajaca ? statystyka(kubelek.pozycjeCeny, minProbkaCeny) : null,
    // Rabat względem kosztorysu — wyłącznie z TED (patrz `rabatCzesci`).
    rabatDoKosztorysu: wystarczajaca ? statystyka(kubelek.rabaty, minProbkaCeny) : null,
    uniewaznienia: {
      czesci: kubelek.uniewaznione,
      // Odsetek podajemy zawsze, gdy jest z czego — to fakt o rynku, nie prognoza.
      procent: kubelek.czesci ? Math.round((100 * kubelek.uniewaznione) / kubelek.czesci) : null,
    },
    maliWygrywaja: kubelek.maliZnane
      ? { procent: Math.round((100 * kubelek.maliTak) / kubelek.maliZnane), n: kubelek.maliZnane }
      : null,
  };
}

/**
 * Buduje benchmark z listy rozstrzygnięć.
 *
 * @param {object[]} wyniki rozstrzygnięcia (kształt `parsujWynik` / `mapujWynikTed`)
 * @param {{klucz: Function, wymiar: string, minProbka?: number, minProbkaCeny?: number}} opcje
 * @returns {Record<string, object>} klucz kubełka → benchmark
 */
export function zbudujBenchmark(wyniki, {
  klucz,
  wymiar,
  minProbka = MIN_PROBKA,
  minProbkaCeny = MIN_PROBKA_CENY,
}) {
  const kubelki = new Map();
  for (const wynik of wyniki ?? []) {
    const k = klucz(wynik);
    if (!k) continue;
    if (!kubelki.has(k)) kubelki.set(k, pustyKubelek(k));
    dolozWynik(kubelki.get(k), wynik);
  }

  const gotowe = {};
  for (const [k, kubelek] of kubelki) {
    gotowe[k] = domknijKubelek(kubelek, { minProbka, minProbkaCeny, wymiar });
  }
  return gotowe;
}

/** Benchmark per zamawiający (po NIP-ie). */
export function benchmarkZamawiajacych(wyniki, opcje = {}) {
  return zbudujBenchmark(wyniki, { klucz: kluczZamawiajacego, wymiar: 'zamawiajacy', ...opcje });
}

/** Benchmark per dział CPV w województwie (i osobno w skali kraju). */
export function benchmarkDzialowCpv(wyniki, opcje = {}) {
  return {
    ...zbudujBenchmark(wyniki, { klucz: kluczDzialuCpvKraj, wymiar: 'dzial_cpv_kraj', ...opcje }),
    ...zbudujBenchmark(wyniki, { klucz: kluczDzialuCpv, wymiar: 'dzial_cpv', ...opcje }),
  };
}
