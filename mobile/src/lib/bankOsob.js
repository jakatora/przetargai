import { formatujPLN } from './kalkulatorCeny.js';

/*
 * „BANK OSÓB” (2026-10-31) — kadra firmy z uprawnieniami i doświadczeniem, z której jednym
 * kliknięciem składa się „Wykaz osób skierowanych do realizacji zamówienia” (§ 9 ust. 1 pkt 3
 * rozporządzenia w sprawie podmiotowych środków dowodowych; art. 274 ust. 1 Pzp).
 *
 * PO CO: w 1258 ogłoszeniach BZP z 27–30.10.2026 kryterium „doświadczenie osób” (np. kierownika
 * budowy) padło 105 razy, a warunek „dysponuje osobą z uprawnieniami” jest w prawie każdym
 * przetargu na roboty. Wykonawca za każdym razem przepisuje te same nazwiska, numery uprawnień
 * i listę inwestycji — tu wpisuje je raz.
 *
 * CZYSTA logika: bez UI, bez zegara (`dzisiaj` parametrem), nigdy nie rzuca. Dane osobowe
 * pracowników zostają na telefonie (ekran zapisuje je lokalnie, jak Bank referencji).
 */

export const KLUCZ_BANKU_OSOB = 'przetargai.bankOsob';

/** Funkcje w zamówieniu — kolejność = kolejność w wykazie (kierownik budowy pierwszy). */
export const FUNKCJE = Object.freeze({
  kierownik_budowy: { pl: 'Kierownik budowy', en: 'Site manager' },
  kierownik_robot: { pl: 'Kierownik robót', en: 'Works manager' },
  projektant: { pl: 'Projektant', en: 'Designer' },
  inspektor: { pl: 'Inspektor nadzoru', en: 'Site inspector' },
  koordynator: { pl: 'Koordynator / kierownik projektu', en: 'Coordinator / project manager' },
  inna: { pl: 'Inna funkcja', en: 'Other role' },
});

/**
 * Podstawa dysponowania osobą. „Zasób innego podmiotu” = dysponowanie pośrednie (art. 118 Pzp):
 * do oferty trzeba dołączyć zobowiązanie podmiotu udostępniającego — wykaz o tym przypomina.
 */
export const PODSTAWY = Object.freeze({
  umowa_o_prace: { pl: 'umowa o pracę', en: 'employment contract' },
  zlecenie: { pl: 'umowa zlecenia / o dzieło', en: 'civil-law contract' },
  b2b: { pl: 'umowa o współpracy (B2B)', en: 'B2B contract' },
  wlasciciel: { pl: 'osoba będąca wykonawcą (właściciel, wspólnik)', en: 'the contractor (owner, partner)' },
  podmiot_trzeci: { pl: 'zasób innego podmiotu (art. 118 Pzp)', en: "another entity's resource (Art. 118)" },
});

const niepusty = (v) => typeof v === 'string' && v.trim().length > 0;
const w = (v) => (niepusty(v) ? v.trim() : '…');
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** RRRR-MM-DD → ms UTC albo null (także dla 2024-02-31). */
function dataMs(tekst) {
  const m = typeof tekst === 'string' ? tekst.trim().match(DATA) : null;
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? ms : null;
}

function dataPL(tekst) {
  const m = typeof tekst === 'string' ? tekst.trim().match(DATA) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : w(tekst);
}

/**
 * Pełne lata od uzyskania uprawnień do `dzisiaj` (np. kryterium „co najmniej 5 lat doświadczenia
 * od uzyskania uprawnień”). Data z przyszłości albo błędna → null.
 */
export function latOdUprawnien(dataUprawnien, dzisiaj) {
  const od = dataMs(dataUprawnien);
  const teraz = dataMs(String(dzisiaj ?? '').slice(0, 10));
  if (od === null || teraz === null || od > teraz) return null;
  const a = new Date(od);
  const b = new Date(teraz);
  let lata = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) lata -= 1;
  return lata;
}

/** „1 rok”, „3 lata”, „5 lat”, „22 lata”. */
export function odmianaLat(n) {
  if (n === 1) return '1 rok';
  const j = n % 10;
  const d = n % 100;
  return `${n} ${j >= 2 && j <= 4 && (d < 12 || d > 14) ? 'lata' : 'lat'}`;
}

/** Lista z magazynu (JSON) → tablica poprawnych osób; uszkodzony zapis → []. */
export function odczytajBank(json) {
  try {
    const lista = JSON.parse(json ?? '[]');
    return Array.isArray(lista)
      ? lista.filter((o) => o && typeof o === 'object' && niepusty(o.imie)).map((o) => ({ ...o, realizacje: Array.isArray(o.realizacje) ? o.realizacje.filter((r) => r && niepusty(r.nazwa)) : [] }))
      : [];
  } catch {
    return [];
  }
}

/** Walidacja formularza osoby — komunikaty PL/EN pod polami. */
export function walidujOsobe({ imie, dataUprawnien } = {}) {
  const bledy = {};
  if (!niepusty(imie)) bledy.imie = { pl: 'Podaj imię i nazwisko.', en: 'Enter the full name.' };
  if (niepusty(dataUprawnien) && dataMs(dataUprawnien) === null) bledy.dataUprawnien = { pl: 'Data w formacie RRRR-MM-DD, np. 2012-06-15.', en: 'Date as YYYY-MM-DD, e.g. 2012-06-15.' };
  return { bledy, maBledy: Object.keys(bledy).length > 0 };
}

/** Walidacja realizacji (inwestycji, przy której osoba pracowała). */
export function walidujRealizacje({ nazwa, dataZakonczenia, wartosc } = {}) {
  const bledy = {};
  if (!niepusty(nazwa)) bledy.nazwa = { pl: 'Podaj nazwę inwestycji lub usługi.', en: 'Enter the project name.' };
  if (niepusty(dataZakonczenia) && dataMs(dataZakonczenia) === null) bledy.dataZakonczenia = { pl: 'Data w formacie RRRR-MM-DD.', en: 'Date as YYYY-MM-DD.' };
  if (niepusty(String(wartosc ?? '')) && !Number.isFinite(Number(String(wartosc).replace(/\s/g, '').replace(',', '.')))) bledy.wartosc = { pl: 'Wartość jako liczba, np. 1250000.', en: 'Value as a number, e.g. 1250000.' };
  return { bledy, maBledy: Object.keys(bledy).length > 0 };
}

/** Kolejność listy: funkcja (jak w FUNKCJE), potem nazwisko. */
export function sortujOsoby(osoby) {
  const kolejnosc = Object.keys(FUNKCJE);
  const poz = (f) => { const i = kolejnosc.indexOf(f); return i < 0 ? kolejnosc.length : i; };
  return [...(Array.isArray(osoby) ? osoby : [])].sort((a, b) => poz(a.funkcja) - poz(b.funkcja) || String(a.imie).localeCompare(String(b.imie), 'pl'));
}

/** Skrót przy osobie: lata od uprawnień i liczba realizacji. */
export function podsumowanieOsoby(osoba, dzisiaj) {
  return {
    lat: latOdUprawnien(osoba?.uprawnieniaData, dzisiaj),
    realizacji: Array.isArray(osoba?.realizacje) ? osoba.realizacje.length : 0,
    posredni: osoba?.podstawa === 'podmiot_trzeci',
  };
}

function nazwaFunkcji(o) {
  if (o.funkcja === 'inna' && niepusty(o.funkcjaOpis)) return o.funkcjaOpis.trim();
  return FUNKCJE[o.funkcja]?.pl ?? (niepusty(o.funkcjaOpis) ? o.funkcjaOpis.trim() : '…');
}

function wierszeRealizacji(o) {
  const lista = Array.isArray(o.realizacje) ? o.realizacje : [];
  if (!lista.length) return ['   Doświadczenie: …'];
  const czas = (r) => dataMs(r.dataZakonczenia) ?? 0;
  return [
    '   Doświadczenie:',
    ...[...lista].sort((a, b) => czas(b) - czas(a)).map((r) => {
      const wartosc = Number(String(r.wartosc ?? '').replace(/\s/g, '').replace(',', '.'));
      const czesci = [
        w(r.nazwa),
        niepusty(r.rola) ? `funkcja: ${r.rola.trim()}` : null,
        niepusty(r.zamawiajacy) ? `zamawiający: ${r.zamawiajacy.trim()}` : null,
        niepusty(String(r.wartosc ?? '')) && Number.isFinite(wartosc) ? `wartość ${formatujPLN(wartosc)} brutto` : null,
        niepusty(r.dataZakonczenia) ? `zakończenie ${dataPL(r.dataZakonczenia)}` : null,
      ].filter(Boolean);
      return `   – ${czesci.join('; ')}`;
    }),
  ];
}

/**
 * Wykaz osób jako tekst do podpisu: kolumny z rozporządzenia (kwalifikacje i uprawnienia,
 * doświadczenie, wykształcenie, zakres czynności, podstawa dysponowania).
 * @param {{wykonawca?: object, przetarg?: object, osoby: object[], dzisiaj: string}} wejscie
 * @returns {{id: string, nazwa: string, podstawa: string, tresc: string, liczba: number, posrednich: number}}
 */
export function generujWykazOsob({ wykonawca, przetarg, osoby, dzisiaj } = {}) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const p = przetarg && typeof przetarg === 'object' ? przetarg : {};
  const lista = sortujOsoby((Array.isArray(osoby) ? osoby : []).filter((o) => o && niepusty(o.imie)));
  const posrednich = lista.filter((o) => o.podstawa === 'podmiot_trzeci').length;

  const pozycje = lista.length
    ? lista.flatMap((o, i) => {
      const lat = latOdUprawnien(o.uprawnieniaData, dzisiaj);
      return [
        `${i + 1}. ${o.imie.trim()}`,
        `   Zakres wykonywanych czynności (funkcja): ${nazwaFunkcji(o)}`,
        `   Kwalifikacje zawodowe, uprawnienia: ${w(o.uprawnienia)}${niepusty(o.uprawnieniaData) ? `, uzyskane ${dataPL(o.uprawnieniaData)}${lat !== null ? ` (${odmianaLat(lat)})` : ''}` : ''}`,
        ...(niepusty(o.izba) ? [`   Przynależność do izby samorządu zawodowego: ${o.izba.trim()}`] : []),
        ...wierszeRealizacji(o),
        `   Wykształcenie: ${w(o.wyksztalcenie)}`,
        `   Podstawa dysponowania: ${PODSTAWY[o.podstawa]?.pl ?? '…'}${o.podstawa === 'podmiot_trzeci' ? ' — zobowiązanie podmiotu udostępniającego w załączeniu' : ''}`,
        '',
      ];
    })
    : ['— brak osób — dodaj kadrę w Banku osób —', ''];

  const tresc = [
    'WYKAZ OSÓB',
    'skierowanych przez wykonawcę do realizacji zamówienia publicznego',
    '(§ 9 ust. 1 pkt 3 rozporządzenia w sprawie podmiotowych środków dowodowych; art. 274 ust. 1 Pzp)',
    '',
    `Zamawiający: ${w(p.zamawiajacy)}`,
    `Postępowanie: ${w(p.tytul)}${niepusty(p.numer) ? ` (nr ${p.numer.trim()})` : ''}`,
    '',
    `Wykonawca: ${w(k.nazwa)}, ${w(k.adres)}, NIP ${w(k.nip)}`,
    '',
    ...pozycje,
    'Oświadczam, że wskazane osoby będą uczestniczyć w wykonywaniu zamówienia i posiadają wymagane uprawnienia, a informacje podane w wykazie są aktualne i zgodne z prawdą.',
    '',
    `${w(k.miejscowosc)}, ${dataPL(String(dzisiaj ?? '').slice(0, 10))}`,
    '',
    niepusty(k.stanowisko) ? `${w(k.reprezentant)}, ${k.stanowisko.trim()}` : w(k.reprezentant),
    '(podpis kwalifikowany, podpis zaufany albo podpis osobisty)',
  ].join('\n');

  return {
    id: 'wykaz_osob',
    nazwa: 'Wykaz osób',
    podstawa: '§ 9 ust. 1 pkt 3 rozporządzenia o podmiotowych środkach dowodowych',
    tresc,
    liczba: lista.length,
    posrednich,
  };
}
