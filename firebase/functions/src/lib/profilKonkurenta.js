import { czystaNazwaWykonawcy, normNazwa } from './ktoWygrywa.js';
import { nazwaKodu } from './cpvSlowa.js';
import { WOJEWODZTWA } from './wojewodztwa.js';
import { dzialCpv, normWojewodztwo } from './wynikiAgregacja.js';

/*
 * PROFIL KONKURENTA (2026-10-31, z analizy konkurencji: Tender Vision „profile konkurentów”,
 * przetargi.info „Excel zwycięzców”, Pressinfo). „Kto wygrywa” mówi, kto bierze zamówienia JEDNEGO
 * zamawiającego; tu odwrotnie — co wygrywa JEDNA firma u wszystkich: u kogo, w jakich branżach
 * i regionach, za ile, przy ilu ofertach i czy wygrywa najniższą ceną. Wykonawca widzi, z kim
 * realnie startuje i gdzie ten konkurent jest słaby.
 * Czysta funkcja nad dokumentami `rozstrzygniecia` znalezionymi po kluczach zwycięzców:
 *  • BZP podaje NIP zwycięzcy, TED tylko nazwę — część pasuje po NIP-ie, a bez NIP-u po nazwie;
 *  • kwoty tylko z części `spojne` (jak benchmark i „Kto wygrywa”).
 */
export const TOP = 5;
export const OSTATNICH = 6;
export const TOP_TWOICH = 10;

/** NIP jako 10 cyfr albo null. */
export function normNip(nip) {
  const d = String(nip ?? '').replace(/\D/g, '');
  return d.length === 10 ? d : null;
}

/**
 * Klucze do zapytań `array-contains` zapisywane przy rozstrzygnięciu: NIP-y i znormalizowane nazwy
 * zwycięzców części z umową. Bez nich profilu nie da się zbudować bez skanu całej kolekcji.
 */
export function kluczeZwyciezcow(czesci) {
  const nipy = new Set();
  const nazwy = new Set();
  for (const c of czesci ?? []) {
    if (c?.uniewaznione || !c?.zwyciezca?.nazwa) continue;
    const nip = normNip(c.zwyciezca.nip);
    if (nip) nipy.add(nip);
    const klucz = normNazwa(c.zwyciezca.nazwa);
    if (klucz) nazwy.add(klucz);
  }
  return { zwyciezcy_nip: [...nipy], zwyciezcy_nazwy: [...nazwy] };
}

const mediana = (liczby) => {
  if (!liczby.length) return null;
  const s = [...liczby].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const policz = (mapa, klucz, ile = 1) => { if (klucz) mapa.set(klucz, (mapa.get(klucz) ?? 0) + ile); };
const top = (mapa, n = TOP) => [...mapa.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);

/**
 * @param {object[]} wyniki dokumenty rozstrzygnięć (mogą się powtarzać — liczymy raz po `id`/`externalId`)
 * @param {{nip?: string|null, nazwa?: string|null}} kogo
 */
export function profilKonkurenta(wyniki, { nip = null, nazwa = null } = {}) {
  let szukanyNip = normNip(nip);
  const szukanaNazwa = nazwa ? normNazwa(nazwa) : null;
  /*
   * Sama nazwa (zwycięzca z TED): jeśli wśród części o tej nazwie jest DOKŁADNIE jeden NIP, to ta firma
   * (bierzemy jej wygrane z BZP). Kilka NIP-ów = kilka firm o tej samej nazwie — liczymy tylko części
   * bez NIP-u i mówimy o tym (`firm_o_tej_nazwie`), zamiast sklejać obce wygrane.
   */
  let firmOTejNazwie = 0;
  if (!szukanyNip && szukanaNazwa) {
    const nipy = new Set();
    for (const w of Array.isArray(wyniki) ? wyniki : []) {
      for (const c of w?.czesci ?? []) {
        const jegoNip = normNip(c?.zwyciezca?.nip);
        if (!c?.uniewaznione && c?.zwyciezca?.nazwa && jegoNip && normNazwa(c.zwyciezca.nazwa) === szukanaNazwa) nipy.add(jegoNip);
      }
    }
    if (nipy.size === 1) [szukanyNip] = nipy;
    firmOTejNazwie = nipy.size;
  }
  const pasuje = (z) => {
    if (!z?.nazwa) return false;
    const jegoNip = normNip(z.nip);
    if (jegoNip) return jegoNip === szukanyNip;
    return Boolean(szukanaNazwa) && normNazwa(z.nazwa) === szukanaNazwa;
  };

  const widziane = new Set();
  const zamawiajacy = new Map();
  const wojewodztwa = new Map();
  const rodzaje = new Map();
  const cpv = new Map();
  const zrodla = new Set();
  const oferty = [];
  const ostatnie = [];
  let wygrane = 0;
  let wartosc = 0;
  let maKwote = false;
  let zPozycjaCeny = 0;
  let najnizszaCena = 0;
  let wyswietlanaNazwa = null;
  let znanyNip = szukanyNip;
  let maly = null;
  let ostatnioWygrana = null;
  let od = null;
  let doDaty = null;

  for (const w of Array.isArray(wyniki) ? wyniki : []) {
    if (!w) continue;
    const klucz = w.id ?? w.externalId ?? null;
    if (klucz) {
      if (widziane.has(klucz)) continue;
      widziane.add(klucz);
    }
    const czesci = (w.czesci ?? []).filter((c) => !c?.uniewaznione && pasuje(c?.zwyciezca));
    if (!czesci.length) continue;
    const dzien = w.opublikowano ?? null;
    if (dzien) {
      if (!od || dzien < od) od = dzien;
      if (!doDaty || dzien > doDaty) doDaty = dzien;
    }
    if (w.zrodlo) zrodla.add(w.zrodlo);
    let wartoscWTym = 0;
    let kwotaWTym = false;
    for (const c of czesci) {
      wygrane++;
      if (c.spojne && Number.isFinite(c.cenaWybrana)) { wartosc += c.cenaWybrana; wartoscWTym += c.cenaWybrana; maKwote = true; kwotaWTym = true; }
      if (Number.isFinite(c.liczbaOfert)) oferty.push(c.liczbaOfert);
      if (Number.isFinite(c.pozycjaCeny)) { zPozycjaCeny++; if (c.pozycjaCeny === 0) najnizszaCena++; }
      if (c.wygralMaly === true || c.wygralMaly === false) maly = c.wygralMaly;
      if (!znanyNip && normNip(c.zwyciezca.nip)) znanyNip = normNip(c.zwyciezca.nip);
      if (dzien && (!ostatnioWygrana || dzien >= ostatnioWygrana)) { ostatnioWygrana = dzien; wyswietlanaNazwa = czystaNazwaWykonawcy(c.zwyciezca.nazwa); }
      if (!wyswietlanaNazwa) wyswietlanaNazwa = czystaNazwaWykonawcy(c.zwyciezca.nazwa);
    }

    const kluczZam = normNip(w.zamawiajacyNip ?? w.zamawiajacy_nip) ?? (w.zamawiajacy ? normNazwa(w.zamawiajacy) : null);
    if (kluczZam) {
      const z = zamawiajacy.get(kluczZam) ?? { nazwa: w.zamawiajacy ?? null, nip: w.zamawiajacyNip ?? w.zamawiajacy_nip ?? null, wygrane: 0, wartosc: 0, maKwote: false, ostatnio: null };
      z.wygrane += czesci.length;
      if (kwotaWTym) { z.wartosc += wartoscWTym; z.maKwote = true; }
      if (dzien && (!z.ostatnio || dzien > z.ostatnio)) { z.ostatnio = dzien; if (w.zamawiajacy) z.nazwa = w.zamawiajacy; }
      zamawiajacy.set(kluczZam, z);
    }
    policz(wojewodztwa, w.wojewodztwo, czesci.length);
    policz(rodzaje, w.rodzaj, czesci.length);
    // Branża = nazwa z katalogu CPV aplikacji dla głównego kodu (katalog jest zgrubny, więc grupuje sam).
    const glowneCpv = Array.isArray(w.cpv) ? w.cpv[0] : null;
    if (glowneCpv) policz(cpv, nazwaKodu(glowneCpv) ?? `dział CPV ${String(glowneCpv).replace(/\D/g, '').slice(0, 2)}`, czesci.length);

    ostatnie.push({
      tytul: w.tytul ?? null,
      zamawiajacy: w.zamawiajacy ?? null,
      opublikowano: dzien,
      cena: kwotaWTym ? Math.round(wartoscWTym) : null,
      liczba_ofert: Number.isFinite(czesci[0].liczbaOfert) ? czesci[0].liczbaOfert : null,
      zrodlo: w.zrodlo ?? null,
    });
  }

  return {
    znaleziono: wygrane > 0,
    nazwa: wyswietlanaNazwa ?? (nazwa ? czystaNazwaWykonawcy(nazwa) : null),
    nip: znanyNip,
    maly,
    wygrane,
    wartosc: maKwote ? Math.round(wartosc) : null,
    od,
    do: doDaty,
    zamawiajacy: [...zamawiajacy.values()]
      .sort((a, b) => b.wygrane - a.wygrane || b.wartosc - a.wartosc)
      .slice(0, TOP)
      .map(({ maKwote: mk, wartosc: wt, ...z }) => ({ ...z, wartosc: mk ? Math.round(wt) : null })),
    liczba_zamawiajacych: zamawiajacy.size,
    wojewodztwa: top(wojewodztwa, 3).map(([kod, n]) => ({ kod, nazwa: WOJEWODZTWA[kod] ?? kod, wygrane: n })),
    rodzaje: top(rodzaje, 3).map(([rodzaj, n]) => ({ rodzaj, wygrane: n })),
    branze: top(cpv).map(([nazwaBranzy, n]) => ({ nazwa: nazwaBranzy, wygrane: n })),
    mediana_ofert: mediana(oferty),
    najnizsza_cena: zPozycjaCeny ? { razy: najnizszaCena, z: zPozycjaCeny } : null,
    ostatnie: ostatnie.sort((a, b) => String(b.opublikowano ?? '').localeCompare(String(a.opublikowano ?? ''))).slice(0, OSTATNICH),
    zrodla: [...zrodla].sort(),
    firm_o_tej_nazwie: firmOTejNazwie > 1 ? firmOTejNazwie : null,
  };
}

/*
 * TWOI KONKURENCI (2026-10-31): bez szukania — firmy, które najczęściej wygrywają w branżach (działy CPV)
 * i regionach z karty firmy. Wejście: kubełki benchmarku (`najczestsiZwyciezcy`), regionalne `cpv:45|18`
 * albo krajowe `cpv:45`. Dział bierzemy z regionu, a gdy region nie ma listy (za mała próbka) — z kraju.
 * Własną firmę (po NIP-ie) pomijamy.
 */
export function twoiKonkurenci({ dzialy = [], regiony = [], kubelki = {}, wlasnyNip = null } = {}) {
  const wlasny = normNip(wlasnyNip);
  const firmy = [];
  const poNip = new Map();
  const poNazwie = new Map();
  const zakresy = [];
  for (const dzial of dzialy) {
    const regionalne = regiony.map((w) => kubelki[`cpv:${dzial}|${w}`]).filter((k) => k?.najczestsiZwyciezcy?.length);
    const krajowy = kubelki[`cpv:${dzial}`];
    const zrodla = regionalne.length ? regionalne : (krajowy?.najczestsiZwyciezcy?.length ? [krajowy] : []);
    if (!zrodla.length) continue;
    const branza = nazwaKodu(`${dzial}000000`) ?? `dział CPV ${dzial}`;
    zakresy.push({ dzial, branza, zakres: regionalne.length ? 'region' : 'kraj' });
    for (const k of zrodla) {
      for (const z of k.najczestsiZwyciezcy) {
        const nip = normNip(z.nip);
        if (wlasny && nip === wlasny) continue;
        const nazwa = normNazwa(z.nazwa);
        let f = (nip && poNip.get(nip)) || (nazwa && poNazwie.get(nazwa)) || null;
        if (!f) {
          f = { nazwa: z.nazwa, nip, wygrane: 0, wartosc: 0, maKwote: false, branze: new Set(), ostatnio: null };
          firmy.push(f);
        }
        if (nip && !poNip.has(nip)) poNip.set(nip, f);
        if (nazwa && !poNazwie.has(nazwa)) poNazwie.set(nazwa, f);
        if (!f.nip && nip) f.nip = nip;
        f.wygrane += z.wygrane ?? 0;
        if (Number.isFinite(z.wartosc)) { f.wartosc += z.wartosc; f.maKwote = true; }
        f.branze.add(branza);
        if (z.ostatnio && (!f.ostatnio || z.ostatnio > f.ostatnio)) f.ostatnio = z.ostatnio;
      }
    }
  }
  return {
    zakresy,
    konkurenci: firmy
      .sort((a, b) => b.wygrane - a.wygrane || b.wartosc - a.wartosc)
      .slice(0, TOP_TWOICH)
      .map(({ maKwote, wartosc, branze, ...f }) => ({ ...f, wartosc: maKwote ? Math.round(wartosc) : null, branze: [...branze] })),
  };
}

/** Działy CPV i regiony z karty firmy → klucze kubełków benchmarku (regionalne i krajowe). */
export function kluczeKonkurentowUzytkownika(user) {
  const dzialy = [...new Set((user?.cpv_codes ?? []).map((k) => dzialCpv(k)).filter(Boolean))].slice(0, 6);
  const regiony = [...new Set((user?.regiony ?? []).map(normWojewodztwo).filter(Boolean))].slice(0, 4);
  const klucze = [...dzialy.map((d) => `cpv:${d}`), ...dzialy.flatMap((d) => regiony.map((w) => `cpv:${d}|${w}`))];
  return { dzialy, regiony, klucze };
}

/**
 * Co wygrali konkurenci (cotygodniowy przegląd, 2026-10-31): z rozstrzygnięć, w których któryś
 * z nich wygrał część — jedna pozycja na ogłoszenie i firmę, kwota ze spójnych części, od najnowszych.
 */
export function wygraneKonkurentow(wyniki, konkurenci, { limit = 5 } = {}) {
  const poNip = new Map((konkurenci ?? []).filter((k) => normNip(k.nip)).map((k) => [normNip(k.nip), k]));
  const lista = [];
  for (const w of Array.isArray(wyniki) ? wyniki : []) {
    const wTym = new Map();
    for (const c of w?.czesci ?? []) {
      const nip = normNip(c?.zwyciezca?.nip);
      if (c?.uniewaznione || !nip || !poNip.has(nip)) continue;
      const e = wTym.get(nip) ?? { nazwa: poNip.get(nip).nazwa, tytul: w.tytul ?? null, zamawiajacy: w.zamawiajacy ?? null, opublikowano: w.opublikowano ?? null, suma: 0, maKwote: false };
      if (c.spojne && Number.isFinite(c.cenaWybrana)) { e.suma += c.cenaWybrana; e.maKwote = true; }
      wTym.set(nip, e);
    }
    for (const e of wTym.values()) {
      lista.push({ nazwa: e.nazwa, tytul: e.tytul, zamawiajacy: e.zamawiajacy, opublikowano: e.opublikowano, cena: e.maKwote ? Math.round(e.suma) : null });
    }
  }
  return lista.sort((a, b) => String(b.opublikowano ?? '').localeCompare(String(a.opublikowano ?? ''))).slice(0, limit);
}
