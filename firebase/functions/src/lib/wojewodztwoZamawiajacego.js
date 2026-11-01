/*
 * WOJEWÓDZTWO ZAMAWIAJĄCEGO PO NAZWIE (2026-11-01). Lista platformazakupowa.pl i e-ProPublico podaje tylko nazwę
 * zamawiającego — 1.11 bez województwa było 100% z 4587 otwartych przetargów PZ i 139 ePP, więc reguła „teren”
 * w selekcji, regionalne kubełki („ile dać”) i podwykonawstwo ich nie widziały. Te same urzędy publikują w BZP
 * (nazwa + województwo + miasto w ogłoszeniu o wyniku), więc województwo bierzemy stamtąd:
 *   1. ta sama nazwa (po normalizacji) w BZP,
 *   2. „Gmina X”, „Miasto X”, „Powiat X”… → miasto X z BZP,
 *   3. „… w Łodzi”, „… we Wrocławiu” → miejscownik nauczony z nazw BZP („Szpital … w Rzeszowie” = 18).
 * Każda mapa tylko z jednoznacznych wpisów (≥ 90% jednego województwa). CZYSTA logika.
 */

const ZGODNOSC = 0.9;

export function normNazwy(nazwa) {
  return String(nazwa ?? '').toLowerCase()
    .replace(/[„”"'`´(),.;:]/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const PRZED_MIEJSCOWOSCIA = /^(?:gmina miejska|gmina wiejska|gmina|miasto i gmina|miasto|urząd gminy|urząd miasta i gminy|urząd miasta|urząd miejski w|powiat|starostwo powiatowe w|miasto stołeczne)\s+/;

/** Miejscowość z nazwy JST: „Gmina Września” → „września”, „Urząd Miejski w Gnieźnie” → „gnieźnie” (miejscownik). */
function miejscowoscJst(norm) {
  const m = PRZED_MIEJSCOWOSCIA.exec(norm);
  return m ? norm.slice(m[0].length).trim() || null : null;
}

/** Słowa po ostatnim „ w ” / „ we ” — miejscownik siedziby („w łodzi”, „we wrocławiu”, „w nowym sączu”). */
function miejscownik(norm) {
  const m = /\s(?:w|we)\s([^\s]+(?:\s[^\s]+)?)$/.exec(norm);
  return m ? m[1] : null;
}

function rozstrzygnij(liczniki) {
  const wynik = new Map();
  for (const [klucz, poWoj] of liczniki) {
    const suma = [...poWoj.values()].reduce((s, n) => s + n, 0);
    const [woj, n] = [...poWoj].sort((a, b) => b[1] - a[1])[0];
    if (n / suma >= ZGODNOSC) wynik.set(klucz, woj);
  }
  return wynik;
}

function dolicz(mapa, klucz, woj) {
  if (!klucz || !woj) return;
  if (!mapa.has(klucz)) mapa.set(klucz, new Map());
  mapa.get(klucz).set(woj, (mapa.get(klucz).get(woj) ?? 0) + 1);
}

/**
 * @param {{org?: string, woj?: string, miasto?: string}[]} rekordy zamawiający z BZP (ogłoszenia, rozstrzygnięcia)
 * @returns {{poNazwie: Map<string,string>, poMiescie: Map<string,string>, poMiejscowniku: Map<string,string>}}
 */
export function zbudujMapy(rekordy) {
  const nazwy = new Map();
  const miasta = new Map();
  const miejscowniki = new Map();
  for (const r of rekordy ?? []) {
    // BZP w ogłoszeniu: „PL10”, w rozstrzygnięciu: „10” — liczymy po kodzie.
    const woj = /^(?:PL)?(\d{2})$/i.exec(String(r?.woj ?? '').trim())?.[1] ?? null;
    if (!woj) continue;
    const n = normNazwy(r.org);
    if (n) {
      dolicz(nazwy, n, woj);
      dolicz(miejscowniki, miejscownik(n), woj);
      const jst = miejscowoscJst(n);
      if (jst) dolicz(miejscowniki, jst, woj);
    }
    dolicz(miasta, normNazwy(r.miasto), woj);
  }
  // Miejscownik i miasto muszą się powtórzyć — jeden „Szpital w Nowej Wsi” to za mało, żeby uczyć się słowa.
  for (const m of [miejscowniki, miasta]) {
    for (const [k, poWoj] of m) if ([...poWoj.values()].reduce((s, x) => s + x, 0) < 2) m.delete(k);
  }
  return { poNazwie: rozstrzygnij(nazwy), poMiescie: rozstrzygnij(miasta), poMiejscowniku: rozstrzygnij(miejscowniki) };
}

/** Województwo zamawiającego z nazwy jako kod „02”…„32” albo null (zapis przy przetargu: „PL” + kod, jak BZP). */
export function wojewodztwoZNazwy(nazwa, mapy) {
  const n = normNazwy(nazwa);
  if (!n || !mapy) return null;
  const dokladnie = mapy.poNazwie.get(n);
  if (dokladnie) return dokladnie;
  const jst = miejscowoscJst(n);
  if (jst) {
    const zJst = mapy.poMiescie.get(jst) ?? mapy.poMiejscowniku.get(jst);
    if (zJst) return zJst;
  }
  const mc = miejscownik(n);
  return mc ? mapy.poMiejscowniku.get(mc) ?? null : null;
}
