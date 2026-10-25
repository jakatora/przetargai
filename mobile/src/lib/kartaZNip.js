import { WOJEWODZTWA } from './wojewodztwa.js';

/*
 * „KARTA FIRMY Z NIP" (2026-10-25) — leniwy start: użytkownik wpisuje sam NIP, a nazwa firmy
 * i województwo siedziby wchodzą do Karty firmy z Białej listy VAT (dane z `lib/danePoNip.js`).
 * Województwo liczymy z KODU POCZTOWEGO adresu siedziby: pierwsze dwie cyfry kodu wyznaczają
 * okręg pocztowy, a okręgi w ~95% pokrywają się z województwami. To PODPOWIEDŹ (użytkownik
 * widzi ją zaznaczoną w kroku „Gdzie pracujesz?" i może zmienić), więc wyjątki na granicach
 * okręgów (np. 76-200 Słupsk — pomorskie, 82-300 Elbląg — warmińsko-mazurskie) są akceptowalne.
 * Nic nie nadpisujemy: wypełniamy tylko puste pola karty.
 */

/** Zakresy pierwszych dwu cyfr kodu pocztowego → kod TERYT województwa. */
const OKREGI = [
  [0, 9, '14'], // Warszawa i Mazowsze (Ciechanów 06, Ostrołęka 07, Siedlce 08, Płock 09)
  [10, 14, '28'], // Olsztyn, Szczytno, Nidzica, Ostróda
  [15, 18, '20'], // Białystok, Suwałki, Bielsk Podlaski, Łomża
  [19, 19, '28'], // Ełk, Olecko, Gołdap (Grajewo 19-200 to wyjątek — podlaskie)
  [20, 24, '06'], // Lublin, Chełm, Zamość, Puławy
  [25, 29, '26'], // Kielce, Ostrowiec, Jędrzejów, Końskie
  [30, 34, '12'], // Kraków, Tarnów, Nowy Sącz, Nowy Targ
  [35, 39, '18'], // Rzeszów, Przeworsk, Krosno, Tarnobrzeg
  [40, 44, '24'], // Katowice, Częstochowa, Bielsko-Biała, Gliwice
  [45, 49, '16'], // Opole, Brzeg, Kędzierzyn, Nysa, Strzelce
  [50, 59, '02'], // Wrocław, Wałbrzych, Jelenia Góra, Legnica
  [60, 64, '30'], // Poznań, Konin, Leszno, Piła
  [65, 69, '08'], // Zielona Góra, Gorzów, Żary, Słubice
  [70, 76, '32'], // Szczecin, Stargard, Koszalin, Sławno
  [77, 77, '22'], // Bytów, Człuchów (Złotów 77-400 to wyjątek — wielkopolskie)
  [78, 78, '32'], // Białogard, Szczecinek, Wałcz
  [80, 84, '22'], // Gdańsk, Gdynia, Tczew, Kościerzyna, Wejherowo
  [85, 89, '04'], // Bydgoszcz, Toruń, Inowrocław, Nakło
  [90, 99, '10'], // Łódź, Zgierz, Skierniewice, Piotrków, Sieradz, Kutno
];

/** Pierwszy kod pocztowy „NN-NNN" w tekście albo null. */
export function kodPocztowyZAdresu(adres) {
  const m = String(adres ?? '').match(/\b(\d{2})-(\d{3})\b/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Kod TERYT województwa dla adresu z kodem pocztowym albo null, gdy kodu brak. */
export function wojewodztwoZAdresu(adres) {
  const kod = kodPocztowyZAdresu(adres);
  if (!kod) return null;
  const okreg = Number(kod.slice(0, 2));
  const trafiony = OKREGI.find(([od, doWl]) => okreg >= od && okreg <= doWl);
  return trafiony && WOJEWODZTWA[trafiony[2]] ? trafiony[2] : null;
}

/**
 * Wypełnia PUSTE pola formularza karty danymi z Białej listy.
 * @param {object} form formularz z `kartaDoFormularza`
 * @param {{nazwa?: string, adres?: string}|null} dane wynik `pobierzDanePoNip().dane`
 * @returns {{form: object, zmiany: string[], wojewodztwo: string|null}}
 *   zmiany ⊂ ['nazwa','teren'] — co faktycznie wstawiono (do komunikatu dla użytkownika).
 */
export function prefillKartyZDanychFirmy(form, dane) {
  const f = form && typeof form === 'object' ? form : {};
  const d = dane && typeof dane === 'object' ? dane : {};
  const zmiany = [];
  const wynik = { ...f };
  const nazwa = String(d.nazwa ?? '').trim();
  if (nazwa.length >= 2 && !String(f.company_name ?? '').trim()) {
    wynik.company_name = nazwa;
    zmiany.push('nazwa');
  }
  const woj = wojewodztwoZAdresu(d.adres);
  const regiony = Array.isArray(f.regiony) ? f.regiony : [];
  if (woj && regiony.length === 0) {
    wynik.regiony = [woj];
    zmiany.push('teren');
  }
  return { form: wynik, zmiany, wojewodztwo: woj };
}

/** Dane firmy do magazynu „Dokumentów do oferty" — Biała lista ma pierwszeństwo, puste nie kasują. */
export function scalDaneWykonawcy(istniejace, dane) {
  const w = istniejace && typeof istniejace === 'object' ? istniejace : {};
  const d = dane && typeof dane === 'object' ? dane : {};
  const wez = (pole) => (String(d[pole] ?? '').trim() ? String(d[pole]).trim() : (w[pole] ?? ''));
  return { ...w, nazwa: wez('nazwa'), adres: wez('adres'), nip: wez('nip'), regon: wez('regon'), rejestr: wez('rejestr') };
}

/** Komunikat po udanym wypełnieniu (PL/EN), zależny od tego, co wstawiono. */
export function komunikatPrefillu({ zmiany, wojewodztwo }, jezyk = 'pl') {
  const nazwaWoj = wojewodztwo ? WOJEWODZTWA[wojewodztwo] : null;
  const pl = jezyk !== 'en';
  if (!zmiany || zmiany.length === 0) {
    return pl
      ? 'Dane firmy pobrane i zapisane do dokumentów oferty. Karta miała już nazwę i teren — nic nie zmieniłem.'
      : 'Company details fetched and saved for bid documents. The card already had a name and area — nothing changed.';
  }
  const czesci = [];
  if (zmiany.includes('nazwa')) czesci.push(pl ? 'nazwę firmy' : 'the company name');
  if (zmiany.includes('teren')) czesci.push(pl ? `województwo ${nazwaWoj} (sprawdź w kroku „Gdzie pracujesz?”)` : `the ${nazwaWoj} voivodeship (check it in “Where do you work?”)`);
  return pl
    ? `Wstawiono ${czesci.join(' i ')}. Dane firmy trafiły też do dokumentów oferty.`
    : `Filled in ${czesci.join(' and ')}. Company details were also saved for bid documents.`;
}
