/**
 * Wspólna walidacja pól liczbowych kalkulatorów.
 *
 * Dotąd kalkulatory liczyły `Number(tekst) || 0`, więc np. „1.200,50" (kropka tysięcy
 * i przecinek) po cichu dawało 0 i zaniżało wynik — przy cenie ofertowej to realne
 * ryzyko. Każde pole dostaje teraz jawny komunikat PL; puste pole = brak błędu
 * (stan pusty ekranu), żeby formularz nie krzyczał, zanim użytkownik cokolwiek wpisze.
 *
 * Komunikaty są celowo te same co w pierwszych dwóch kalkulatorach (cena, odsetki).
 */

const KOMUNIKAT_KWOTA_NIE_LICZBA = 'Podaj kwotę jako liczbę, np. 1200,00';
const KOMUNIKAT_KWOTA_UJEMNA = 'Kwota nie może być ujemna';
const KOMUNIKAT_PROCENT_NIE_LICZBA = 'Podaj procent jako liczbę, np. 10';
const KOMUNIKAT_LICZBA_NIE_LICZBA = 'Podaj liczbę, np. 10';
const KOMUNIKAT_CALKOWITA = 'Podaj liczbę całkowitą';

/*
 * „1.200" / „12.500" / „1.200.000": kropka z grupami po trzy cyfry. Po polsku to tysiące
 * (1200 zł), dla JavaScriptu ułamek (1,2). Klawiatura liczbowa Androida ma kropkę, więc
 * ten zapis realnie się zdarza — i po cichu zaniżał cenę tysiąckrotnie. Nie zgadujemy,
 * tylko prosimy o jednoznaczny zapis. „0.500" (zero na początku) to zawsze ułamek.
 */
const TYSIACE_Z_KROPKA = /^-?[1-9]\d{0,2}(\.\d{3})+$/;

function komunikatNiejednoznaczny(tekst) {
  const bezKropek = tekst.replace(/\./g, '');
  if ((tekst.match(/\./g) || []).length > 1) {
    return `Niejednoznaczny zapis „${tekst}" — wpisz ${bezKropek} (bez kropek)`;
  }
  const ulamek = tekst.replace('.', ',').replace(/0+$/, '').replace(/,$/, '');
  return `Niejednoznaczny zapis „${tekst}" — wpisz ${bezKropek} (bez kropki) albo ${ulamek} (z przecinkiem)`;
}

/**
 * Klasyfikuje pole po wstępnym oczyszczeniu (cyfry/przecinek/kropka/spacja/minus —
 * tak jak ekrany czyszczą wejście). Przecinek = separator dziesiętny, spacje = tysiące.
 * @returns {{pusty: boolean, liczba: number|null, niejednoznaczny?: boolean}}
 *   liczba=null gdy tekst nie jest liczbą albo jest niejednoznaczny („1.200").
 */
export function analizujPole(x) {
  const oczyszczone = String(x ?? '').replace(/[^0-9.,\- ]/g, '');
  const bezSpacji = oczyszczone.replace(/\s/g, '');
  if (bezSpacji === '') return { pusty: true, liczba: null };
  if (TYSIACE_Z_KROPKA.test(bezSpacji)) return { pusty: false, liczba: null, niejednoznaczny: true };
  const n = Number(bezSpacji.replace(/,/g, '.'));
  return { pusty: false, liczba: Number.isFinite(n) ? n : null, niejednoznaczny: false };
}

/** Wspólny początek każdej walidacji: pusty → brak błędu, „1.200" → podpowiedź. */
function bladWstepny(wartosc, pole) {
  if (pole.pusty) return null;
  if (pole.niejednoznaczny) return komunikatNiejednoznaczny(String(wartosc).replace(/\s/g, ''));
  return undefined;
}

/** Kwota w zł: liczba ≥ 0. @returns {string|null} komunikat albo null. */
export function bladKwoty(wartosc) {
  const pole = analizujPole(wartosc);
  const wstepny = bladWstepny(wartosc, pole);
  if (wstepny !== undefined) return wstepny;
  if (pole.liczba === null) return KOMUNIKAT_KWOTA_NIE_LICZBA;
  if (pole.liczba < 0) return KOMUNIKAT_KWOTA_UJEMNA;
  return null;
}

/** Procent w zakresie 0–max. @returns {string|null} */
export function bladProcentu(wartosc, { max = 100, etykieta = 'Wartość' } = {}) {
  const pole = analizujPole(wartosc);
  const wstepny = bladWstepny(wartosc, pole);
  if (wstepny !== undefined) return wstepny;
  const { liczba } = pole;
  if (liczba === null) return KOMUNIKAT_PROCENT_NIE_LICZBA;
  if (liczba < 0 || liczba > max) return `${etykieta} spoza zakresu 0–${max}%`;
  return null;
}

/** Dowolna liczba (dni, punkty, sztuki) z opcjonalnym zakresem i wymogiem całkowitej. */
export function bladLiczby(wartosc, { min = 0, max = Infinity, calkowita = false } = {}) {
  const pole = analizujPole(wartosc);
  const wstepny = bladWstepny(wartosc, pole);
  if (wstepny !== undefined) return wstepny;
  const { liczba } = pole;
  if (liczba === null) return KOMUNIKAT_LICZBA_NIE_LICZBA;
  if (calkowita && !Number.isInteger(liczba)) return KOMUNIKAT_CALKOWITA;
  if (liczba < min) return `Wartość musi wynosić co najmniej ${min}`;
  if (liczba > max) return `Wartość nie może przekraczać ${max}`;
  return null;
}

/**
 * Składa wynik walidacji w kształt używany przez ekrany (`error={bledy.pole}`).
 * @param {{[pole: string]: string|null}} mapa
 * @returns {{bledy: {[pole: string]: string}, maBledy: boolean}}
 */
export function zbierzBledy(mapa) {
  const bledy = {};
  for (const [pole, blad] of Object.entries(mapa)) {
    if (blad) bledy[pole] = blad;
  }
  return { bledy, maBledy: Object.keys(bledy).length > 0 };
}
