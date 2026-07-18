/**
 * Agregacja wyników postępowań (runda 15) — czysta logika.
 *
 * Z listy sparsowanych ogłoszeń o wyniku (wynikiParser.js) buduje estymator per
 * (dział CPV, rodzaj zamówienia, województwo): mediana ceny zwycięzcy, typowa
 * liczba konkurentów, % wygranych małych firm. Daje JDG odpowiedź na „za ile się
 * to robi i z kim konkuruję".
 *
 * 🚨 Ceny bierzemy TYLKO z części oznaczonych `spojne` — zamawiający wpisują ręcznie
 * kwoty arytmetycznie niemożliwe (cena zwycięzcy poniżej najniższej oferty). Liczba
 * ofert jest wiarygodna niezależnie od spójności kwot ([[reference_bzp_api_dane]]).
 */

/** Dwucyfrowy dział CPV z pierwszego kodu (np. 45 = roboty budowlane). Przyjmuje
 * tablicę kodów (z parsera) albo sklejony string `cpv_main` z przetargu. */
export function dzialCpv(cpv) {
  const pierwszy = Array.isArray(cpv) ? cpv[0] : cpv;
  const cyfry = String(pierwszy ?? '').replace(/\D/g, '');
  return cyfry.length >= 2 ? cyfry.slice(0, 2) : null;
}

/**
 * Klucz bucketa statystyk dla PRZETARGU (serwowanie, R17). Zwraca `dział|rodzaj|woj`
 * albo null, gdy brakuje któregokolwiek wymiaru. Symetryczne z agregacją.
 */
export function kluczWyniku(tender) {
  const dzial = dzialCpv(tender?.cpv_main ?? tender?.cpv);
  const rodzaj = tender?.rodzaj ?? null;
  const woj = normWojewodztwo(tender?.wojewodztwo);
  if (!dzial || !rodzaj || !woj) return null;
  return `${dzial}|${rodzaj}|${woj}`;
}

/**
 * Ujednolicenie województwa do 2-cyfrowego TERYT (np. „14").
 * wynikiParser zwraca „14", a `organizationProvince` przetargu to „PL14" —
 * spinamy oba do jednej postaci, żeby klucz bucketa zgadzał się przy serwowaniu.
 */
export function normWojewodztwo(w) {
  const cyfry = String(w ?? '').replace(/\D/g, '');
  return cyfry.length >= 2 ? cyfry.slice(0, 2) : null;
}

/** Mediana listy liczb. null dla pustej. */
export function mediana(nums) {
  const s = [...nums].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {object[]} wyniki wynik `parsujWynik` (z częściami)
 * @param {{minProbka?: number}} [opts] minimalna liczba części, by uznać bucket za wiarygodny
 * @returns {Record<string, object>} klucz `dział|rodzaj|województwo` → statystyki
 */
export function agregujWyniki(wyniki, { minProbka = 3 } = {}) {
  const kubelki = new Map();

  for (const w of wyniki) {
    const dzial = dzialCpv(w?.cpv);
    const rodzaj = w?.rodzaj ?? null;
    const woj = normWojewodztwo(w?.wojewodztwo);
    if (!dzial || !rodzaj || !woj) continue; // bez wymiarów nie ma czego grupować

    const klucz = `${dzial}|${rodzaj}|${woj}`;
    if (!kubelki.has(klucz)) {
      kubelki.set(klucz, { dzialCpv: dzial, rodzaj, wojewodztwo: woj, ceny: [], oferty: [], malyTak: 0, malyZnane: 0, probka: 0 });
    }
    const b = kubelki.get(klucz);

    for (const cz of w.czesci ?? []) {
      b.probka += 1;
      if (cz.spojne && Number.isFinite(cz.cenaWybrana)) b.ceny.push(cz.cenaWybrana);
      if (Number.isFinite(cz.liczbaOfert)) b.oferty.push(cz.liczbaOfert);
      if (cz.wygralMaly === true || cz.wygralMaly === false) {
        b.malyZnane += 1;
        if (cz.wygralMaly) b.malyTak += 1;
      }
    }
  }

  const wynik = {};
  for (const [klucz, b] of kubelki) {
    if (b.probka < minProbka) continue;
    wynik[klucz] = {
      dzialCpv: b.dzialCpv,
      rodzaj: b.rodzaj,
      wojewodztwo: b.wojewodztwo,
      cena: b.ceny.length
        ? { mediana: mediana(b.ceny), min: Math.min(...b.ceny), max: Math.max(...b.ceny), n: b.ceny.length }
        : null,
      oferty: b.oferty.length ? { mediana: mediana(b.oferty), n: b.oferty.length } : null,
      maly: b.malyZnane ? { procent: Math.round((100 * b.malyTak) / b.malyZnane), n: b.malyZnane } : null,
      probka: b.probka,
    };
  }
  return wynik;
}
