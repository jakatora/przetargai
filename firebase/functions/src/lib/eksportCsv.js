/**
 * EKSPORT CSV (P2-3) — czysta logika, bez Firestore i bez zegara.
 *
 * Firma prowadzi przetargi w Excelu albo w CRM-ie, nie w aplikacji mobilnej —
 * eksport jest mostem do tego, gdzie naprawdę pracuje.
 *
 * Trzy decyzje, bez których plik „działa u nas", a nie u klienta:
 *  • SEPARATOR ŚREDNIK i PRZECINEK DZIESIĘTNY — polski Excel otwiera CSV dwuklikiem
 *    z ustawień regionalnych; przecinek jako separator skleiłby kolumny w jedną.
 *  • BOM UTF-8 — bez niego Excel czyta plik jako Windows-1250 i „Łódź" staje się
 *    krzakami.
 *  • OCHRONA PRZED WSTRZYKNIĘCIEM FORMUŁ — tytuł ogłoszenia pisze OBCA osoba
 *    (zamawiający w rejestrze publicznym). Komórka zaczynająca się od „=", „+",
 *    „-", „@" zostałaby wykonana jako formuła po otwarciu pliku (OWASP CSV
 *    Injection). Poprzedzamy ją apostrofem.
 */

import { STATUSY, STATUS_DOMYSLNY } from './statusPrzetargu.js';
import { ZRODLA } from './katalogPrzetargow.js';
import { wCzasieWarszawskim } from './kalendarzPrzetargu.js';
import { nazwaWojewodztwa } from './wojewodztwa.js';
import { NAZWA_RODZAJU } from './kryteriaTed.js';

export const BOM = '﻿';
const SEPARATOR = ';';
const KONIEC_LINII = '\r\n';

/** Sufit wierszy eksportu katalogu — koszt odczytu i rozmiar załącznika. */
export const MAKS_WIERSZY_KATALOGU = 500;

const NIEBEZPIECZNY_POCZATEK = /^[=+\-@\t\r]/;

/** Jedna komórka CSV. Liczby z przecinkiem dziesiętnym; tekst chroniony i cytowany. */
export function komorka(wartosc) {
  if (wartosc === null || wartosc === undefined) return '';
  if (typeof wartosc === 'number') {
    return Number.isFinite(wartosc) ? String(wartosc).replace('.', ',') : '';
  }
  let tekst = String(wartosc);
  if (NIEBEZPIECZNY_POCZATEK.test(tekst)) tekst = `'${tekst}`;
  if (/[";\r\n]/.test(tekst)) return `"${tekst.replaceAll('"', '""')}"`;
  return tekst;
}

/**
 * @param {object[]} wiersze
 * @param {{klucz: string, naglowek: string}[]} kolumny
 * @returns {string} dokument z BOM i CRLF
 */
export function doCsv(wiersze, kolumny) {
  const linie = [kolumny.map((k) => komorka(k.naglowek)).join(SEPARATOR)];
  for (const w of wiersze ?? []) {
    linie.push(kolumny.map((k) => komorka(w?.[k.klucz])).join(SEPARATOR));
  }
  return BOM + linie.join(KONIEC_LINII) + KONIEC_LINII;
}

/** „2026-10-05 10:00" w czasie polskim — tak, jak termin brzmi w ogłoszeniu. */
function terminPl(iso) {
  const { data, godzina } = wCzasieWarszawskim(iso);
  return data ? `${data} ${godzina}` : null;
}

function dataPl(iso) {
  return wCzasieWarszawskim(iso).data;
}

function etykietaZrodla(kod) {
  const z = ZRODLA.find((x) => x.kod === kod);
  if (z) return kod === 'baza_konkurencyjnosci' ? 'Baza Konkurencyjności' : z.etykieta.pl;
  return kod ?? null;
}

const ETAPY = new Map(STATUSY.map((s) => [s.wartosc, s.etykieta]));

/** „190 750 zł” — grupy zwykłą spacją (toLocaleString daje twardą spację, w Excelu widoczną jako znak). */
function kwotaPl(n) {
  return Number.isFinite(n) ? `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} zł` : null;
}

/*
 * Kolumny z danych, które serwer dopisuje do kopii w Zapisanych (2026-11-01): wadium, kryteria, otwarcie ofert,
 * nowe dokumenty, unieważnienie. Firma, która trzyma przetargi w Excelu, nie musi otwierać każdego w aplikacji.
 */
function wadiumZapisanego(s) {
  if (s?.tender_wadium_wymagane === false) return 'nie wymaga';
  if (s?.tender_wadium_wymagane !== true) return null;
  const kwota = kwotaPl(s.tender_wadium_kwota);
  return `${kwota ?? 'wymagane (kwota w SWZ)'}${s.tender_wadium_wiele_czesci ? ' (różne w częściach)' : ''}`;
}

function kryteriaZapisanego(s) {
  const k = s?.tender_kryteria_skrot;
  if (!Array.isArray(k?.kryteria) || !k.kryteria.length) return null;
  const pozycje = k.kryteria.map((x) => `${x.rodzaj === 'cena' ? 'Cena' : NAZWA_RODZAJU[x.rodzaj] ?? 'Inne'}${typeof x.udzial === 'number' ? ` ${String(x.udzial).replace('.', ',')}%` : ''}`);
  return `${pozycje.join(' · ')}${k.reszta ? ` +${k.reszta}` : ''}${k.rozne_w_czesciach ? ' (różne w częściach)' : ''}`;
}

function otwarcieZapisanego(s) {
  const o = s?.tender_otwarcie_ofert;
  if (!o) return null;
  const czesci = [];
  if (Number.isFinite(o.oferty)) czesci.push(o.oferty === 1 ? '1 oferta' : `${o.oferty} ofert${o.oferty % 10 >= 2 && o.oferty % 10 <= 4 && (o.oferty % 100 < 12 || o.oferty % 100 > 14) ? 'y' : ''}`);
  if (Number.isFinite(o.cena_min)) czesci.push(`najniższa ${kwotaPl(o.cena_min)}`);
  if (Number.isFinite(o.kwota)) czesci.push(`zamawiający ma ${kwotaPl(o.kwota)}`);
  return czesci.length ? `${czesci.join(' · ')}${o.czesci ? ' (kilka części)' : ''}` : null;
}

function zmianyZapisanego(s) {
  const z = s?.tender_ez_zmiany;
  if (!z) return null;
  const czesci = [];
  if (z.termin) czesci.push('nowy termin');
  if (z.zmiany) czesci.push(`zmiany SWZ: ${z.zmiany}`);
  if (z.wyjasnienia) czesci.push(`wyjaśnienia: ${z.wyjasnienia}`);
  return czesci.length ? czesci.join(' · ') : null;
}

export const KOLUMNY_ZAPISANYCH = [
  { klucz: 'tytul', naglowek: 'Przedmiot zamówienia' },
  { klucz: 'zamawiajacy', naglowek: 'Zamawiający' },
  { klucz: 'etap', naglowek: 'Etap' },
  { klucz: 'termin', naglowek: 'Termin składania ofert' },
  { klucz: 'wartosc', naglowek: 'Wartość' },
  { klucz: 'waluta', naglowek: 'Waluta' },
  { klucz: 'cpv', naglowek: 'CPV' },
  { klucz: 'zrodlo', naglowek: 'Rejestr' },
  { klucz: 'wadium', naglowek: 'Wadium' },
  { klucz: 'kryteria', naglowek: 'Za co punkty' },
  { klucz: 'zmiany', naglowek: 'Nowe dokumenty' },
  { klucz: 'otwarcie', naglowek: 'Otwarcie ofert' },
  { klucz: 'uniewazniony', naglowek: 'Unieważniony' },
  { klucz: 'notatka', naglowek: 'Notatka' },
  { klucz: 'zapisano', naglowek: 'Zapisano' },
  { klucz: 'link', naglowek: 'Link do ogłoszenia' },
];

export const KOLUMNY_KATALOGU = [
  { klucz: 'tytul', naglowek: 'Przedmiot zamówienia' },
  { klucz: 'zamawiajacy', naglowek: 'Zamawiający' },
  { klucz: 'termin', naglowek: 'Termin składania ofert' },
  { klucz: 'wartosc', naglowek: 'Wartość' },
  { klucz: 'waluta', naglowek: 'Waluta' },
  { klucz: 'cpv', naglowek: 'CPV' },
  { klucz: 'wojewodztwo', naglowek: 'Województwo' },
  { klucz: 'zrodlo', naglowek: 'Rejestr' },
  { klucz: 'opublikowano', naglowek: 'Opublikowano' },
  { klucz: 'link', naglowek: 'Link do ogłoszenia' },
];

/** Wpis „Zapisanych" (zdenormalizowany, jak w repos.saved) → wiersz CSV. */
export function wierszZapisanego(s) {
  return {
    tytul: s?.tender_title ?? null,
    zamawiajacy: s?.tender_organization ?? null,
    etap: ETAPY.get(s?.status) ?? ETAPY.get(STATUS_DOMYSLNY),
    termin: terminPl(s?.tender_deadline),
    wartosc: typeof s?.tender_budget === 'number' ? s.tender_budget : null,
    waluta: typeof s?.tender_budget === 'number' ? (s?.tender_currency ?? 'PLN') : null,
    cpv: s?.tender_cpv ?? null,
    zrodlo: etykietaZrodla(s?.tender_source ?? null),
    wadium: wadiumZapisanego(s),
    kryteria: kryteriaZapisanego(s),
    zmiany: zmianyZapisanego(s),
    otwarcie: otwarcieZapisanego(s),
    uniewazniony: s?.tender_anulowany === true ? 'tak' : null,
    notatka: s?.notatka ?? null,
    zapisano: dataPl(s?.saved_at),
    link: s?.tender_url ?? null,
  };
}

/** Przetarg z katalogu (dokument `tenders`) → wiersz CSV. */
export function wierszKatalogu(t) {
  return {
    tytul: t?.title ?? null,
    zamawiajacy: t?.organization ?? null,
    termin: terminPl(t?.deadline),
    wartosc: typeof t?.budget === 'number' ? t.budget : null,
    waluta: typeof t?.budget === 'number' ? (t?.currency ?? 'PLN') : null,
    cpv: t?.cpv_main ?? null,
    wojewodztwo: nazwaWojewodztwa(t?.wojewodztwo),
    zrodlo: etykietaZrodla(t?.source ?? null),
    opublikowano: dataPl(t?.published_at),
    link: t?.url ?? null,
  };
}

/** „przetargai-zapisane-2026-09-24.csv" — data polska, żeby plik z wieczora nie nosił jutra. */
export function nazwaPliku(rodzaj, teraz) {
  return `przetargai-${rodzaj}-${dataPl(teraz)}.csv`;
}
