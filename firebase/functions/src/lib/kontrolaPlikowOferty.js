/*
 * KONTROLA PLIKÓW OFERTY PRZED WYSŁANIEM (2026-10-31, z analizy konkurencji: SEZAM — deterministyczna
 * kontrola z jawnym „czego nie sprawdziłem”). Dotąd „Kontrola oferty” była listą do odhaczenia;
 * teraz wykonawca wrzuca gotowe pliki, a my bez AI sprawdzamy to, co da się sprawdzić pewnie:
 *  • podpis elektroniczny: PAdES w PDF-ie, podpis w DOCX albo plik .xades/.sig/.p7s o tej samej nazwie,
 *  • niewypełnione miejsca („……”) z etykietą pola (podpis pomijamy — ten składa się elektronicznie),
 *  • NIP-y: Twój jest w ofercie? obcy NIP (nie Twój, nie zamawiającego) = pozostałość z innej oferty?
 *  • kwoty brutto: różne „ceny/wartości brutto” w różnych plikach (formularz ↔ kosztorys).
 * Czego NIE sprawdzamy, mówimy wprost (ważność certyfikatu podpisu, treść wadium, zgodność z OPZ…).
 * Pliki tylko w pamięci, nic nie zapisujemy. Czysta logika — ekstrakcja tekstu PDF jest wstrzykiwana.
 */
import { czytajZip, akapity, miejscaDoWpisania, poleDlaEtykiety } from './wypelnijZalacznik.js';

export const MAKS_PLIKOW = 12;
export const MAKS_BAJTOW_PLIKU = 10 * 1024 * 1024;
export const MAKS_BAJTOW_RAZEM = 14 * 1024 * 1024;
const MAKS_POZYCJI = 8;

const ROZSZ_PODPISU = ['xades', 'sig', 'p7s', 'asc'];
const ROZSZ_KONTENERA = ['zip', 'asice', 'asics', 'sce', 'scs', '7z', 'rar', 'p7m'];

export const rozszerzenie = (nazwa) => (String(nazwa ?? '').toLowerCase().match(/\.([a-z0-9]{1,6})$/) || [null, ''])[1];
const bezRozszerzen = (nazwa, rozsz) => {
  let n = String(nazwa ?? '').toLowerCase();
  for (let i = 0; i < 3; i++) {
    const r = rozszerzenie(n);
    if (!r || !rozsz.includes(r)) break;
    n = n.slice(0, -(r.length + 1));
  }
  return n;
};

/** Rodzaj pliku po zawartości (nie ufamy samej nazwie), z rozszerzeniem jako podpowiedzią dla podpisów i kontenerów. */
export function rodzajPliku(nazwa, buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);
  const r = rozszerzenie(nazwa);
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (ROZSZ_PODPISU.includes(r)) return 'podpis_zewnetrzny';
  if (r === 'xml' && /XAdES|SignedInfo/.test(b.subarray(0, 200_000).toString('utf8'))) return 'podpis_zewnetrzny';
  if (ROZSZ_KONTENERA.includes(r)) return 'kontener';
  if (b.length > 4 && b.readUInt32LE(0) === 0x04034b50 && r === 'docx') return 'docx';
  return 'inne';
}

/** PAdES: słownik podpisu z /ByteRange (podpis kwalifikowany, zaufany i osobisty w PDF-ie wyglądają tak samo). */
export function podpisWPdf(buf) {
  const s = (Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? [])).toString('latin1');
  return s.includes('/ByteRange') && /\/Type\s*\/Sig\b|\/SubFilter\s*\/(ETSI\.CAdES|adbe\.pkcs7)/.test(s);
}

/** Linie tekstu DOCX (akapity) i informacja, czy dokument ma podpis wewnętrzny (`_xmlsignatures/`). */
export function czytajDocx(buf) {
  const wpisy = czytajZip(buf);
  const dokument = wpisy.find((w) => w.nazwa === 'word/document.xml');
  if (!dokument) return { linie: null, podpisany: false };
  return {
    linie: akapity(dokument.dane.toString('utf8')).map((a) => a.tekst).filter((t) => t.trim()),
    podpisany: wpisy.some((w) => w.nazwa.startsWith('_xmlsignatures/')),
  };
}

const WAGI_NIP = [6, 5, 7, 2, 3, 4, 5, 6, 7];
export function poprawnyNip(nip) {
  const c = String(nip ?? '').replace(/\D/g, '');
  if (c.length !== 10) return false;
  const suma = WAGI_NIP.reduce((s, w, i) => s + w * Number(c[i]), 0) % 11;
  return suma !== 10 && suma === Number(c[9]);
}

/** NIP-y z etykietą „NIP” (bez niej 10 cyfr to równie dobrze telefon czy numer konta) i poprawną sumą kontrolną. */
export function nipyWTekscie(tekst) {
  const wynik = new Set();
  for (const m of String(tekst ?? '').matchAll(/\bNIP\b[^0-9]{0,20}((?:\d[\s-]?){9}\d)/gi)) {
    const nip = m[1].replace(/\D/g, '');
    if (poprawnyNip(nip)) wynik.add(nip);
  }
  return [...wynik];
}

const kwotaNaLiczbe = (s) => Number(String(s).replace(/[\s .]/g, '').replace(',', '.'));
/** „Cena / wartość / razem … brutto … 123 456,78” (albo kwota przed „brutto”) → kwoty z linii. */
export function kwotyBrutto(linia) {
  const l = String(linia ?? '');
  if (!/brutto/i.test(l) || !/(cen[aęy]|warto[sś][cć]|ł[aą]czn|razem|og[oó][lł]em)/i.test(l)) return [];
  const kwoty = new Set();
  for (const m of l.matchAll(/(\d{1,3}(?:[  .]\d{3})*,\d{2})/g)) {
    const n = kwotaNaLiczbe(m[1]);
    if (Number.isFinite(n) && n >= 100) kwoty.add(n);
  }
  return [...kwoty];
}

const krotko = (s, n = 90) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const PODPIS = /\bpodpis(?:y|em|u|ów|ow)?\b|piecz[eę][cć]|parafa/i;

/** Niewypełnione miejsca w liniach dokumentu: etykieta pola (tekst przed kropkami albo opis w nawiasie za nimi). */
export function pustePola(linie) {
  const wynik = [];
  (linie ?? []).forEach((linia, i) => {
    const miejsca = miejscaDoWpisania(linia);
    miejsca.forEach((mj, k) => {
      let przed = linia.slice(k ? miejsca[k - 1].do : 0, mj.od);
      if (k && przed.trim().startsWith('(') && przed.includes(')')) przed = przed.slice(przed.indexOf(')') + 1);
      const po = linia.slice(mj.do, miejsca[k + 1]?.od ?? linia.length).trim();
      const kandydaci = po.startsWith('(') ? [po.slice(1, po.indexOf(')') > 0 ? po.indexOf(')') : undefined), przed] : [przed];
      if (!przed.trim() && i > 0) kandydaci.push(linie[i - 1]);
      // Miejsce na podpis odręczny („…… (podpis osoby upoważnionej)”) — ofertę podpisuje się elektronicznie.
      // Sam rzeczownik „podpis”: „osoba podpisująca ofertę: ……” to pole do wypełnienia.
      if (PODPIS.test(String(kandydaci[0] ?? ''))) return;
      const pole = kandydaci.map((x) => poleDlaEtykiety(x)).find(Boolean) ?? null;
      if (pole === 'pomin') return;
      // Etykieta musi mieć litery — sama linia kropek nad polem to nie opis.
      const etykieta = krotko(kandydaci.find((x) => /\p{L}/u.test(String(x ?? ''))) ?? '', 70);
      if (etykieta) wynik.push({ etykieta, pole });
    });
  });
  return wynik;
}

/** Plik, którego brak podpisu to niemal na pewno odrzucenie (formularz, oświadczenia, JEDZ, pełnomocnictwo). */
const WYMAGA_PODPISU = /formularz|ofert|o[sś]wiadcz|jedz|espd|pe[lł]nomoc|zobowi[aą]z|wykaz/i;

const NIE_SPRAWDZONE_ZAWSZE = [
  { tytul: 'Ważność i rodzaj podpisu', powod: 'Widzimy, że podpis jest, ale nie weryfikujemy certyfikatu ani tego, czy to podpis kwalifikowany, zaufany czy osobisty, jak wymaga SWZ.' },
  { tytul: 'Wadium', powod: 'Nie sprawdzamy treści gwarancji ani przelewu: kwoty, okresu ważności i bezwarunkowości.' },
  { tytul: 'Zgodność z opisem przedmiotu zamówienia', powod: 'Nie porównujemy parametrów oferowanego przedmiotu z OPZ.' },
  { tytul: 'Rachunki w kosztorysie', powod: 'Porównujemy tylko kwoty brutto opisane jako cena lub wartość, bez sprawdzania pozycji i sum.' },
  { tytul: 'Komplet dokumentów z SWZ', powod: 'Listę wymaganych dokumentów porównaj z checklistą „Co musisz mieć” w Radarze SWZ.' },
];

/**
 * Raport z plików już odczytanych.
 * @param {{pliki: {nazwa: string, rodzaj: string, linie: string[]|null, podpisany: boolean}[], firma?: {nip?: string|null}, zamawiajacyNip?: string|null}} wejscie
 */
export function ocenOferte({ pliki = [], firma = {}, zamawiajacyNip = null } = {}) {
  const wyniki = [];
  const nieSprawdzone = [];
  const dokumenty = pliki.filter((p) => p.rodzaj === 'pdf' || p.rodzaj === 'docx');
  const podpisyZewn = pliki.filter((p) => p.rodzaj === 'podpis_zewnetrzny').map((p) => bezRozszerzen(p.nazwa, ROZSZ_PODPISU));

  // 1. Podpis elektroniczny.
  const bezPodpisu = [];
  for (const d of dokumenty) {
    const pelna = d.nazwa.toLowerCase();
    const baza = bezRozszerzen(d.nazwa, ['pdf', 'docx']);
    d.podpis = d.podpisany ? 'wewnetrzny' : (podpisyZewn.some((z) => z === pelna || z === baza || z.startsWith(baza)) ? 'zewnetrzny' : 'brak');
    if (d.podpis === 'brak') bezPodpisu.push(d);
  }
  const krytyczne = bezPodpisu.filter((d) => WYMAGA_PODPISU.test(d.nazwa));
  if (krytyczne.length) {
    wyniki.push({ kod: 'brak_podpisu', poziom: 'blad', tytul: 'Brak podpisu elektronicznego', szczegol: 'Formularz ofertowy, oświadczenia, JEDZ i pełnomocnictwo muszą być podpisane (PAdES w PDF-ie albo plik .xades obok). Bez podpisu oferta jest odrzucana.', pliki: krytyczne.map((d) => d.nazwa) });
  }
  const pozostale = bezPodpisu.filter((d) => !WYMAGA_PODPISU.test(d.nazwa));
  if (pozostale.length) {
    wyniki.push({ kod: 'brak_podpisu_inne', poziom: 'uwaga', tytul: 'Pliki bez podpisu', szczegol: 'Sprawdź w SWZ, czy te dokumenty (np. przedmiotowe środki dowodowe) też muszą być podpisane.', pliki: pozostale.map((d) => d.nazwa) });
  }
  if (dokumenty.length && !bezPodpisu.length) {
    wyniki.push({ kod: 'podpisy_ok', poziom: 'ok', tytul: 'Każdy dokument ma podpis elektroniczny', szczegol: 'W pliku albo jako .xades / .sig obok.', pliki: [] });
  }

  // 2. Niewypełnione miejsca.
  for (const d of dokumenty) {
    if (!d.linie) continue;
    const puste = pustePola(d.linie);
    if (puste.length) {
      wyniki.push({ kod: 'puste_pola', poziom: 'uwaga', tytul: `Niewypełnione miejsca: ${d.nazwa}`, szczegol: puste.slice(0, MAKS_POZYCJI).map((p) => p.etykieta).join(' · ') + (puste.length > MAKS_POZYCJI ? ` (i ${puste.length - MAKS_POZYCJI} więcej)` : ''), pliki: [d.nazwa], liczba: puste.length });
    }
  }

  // 3. NIP-y.
  const wlasny = String(firma?.nip ?? '').replace(/\D/g, '');
  const zam = String(zamawiajacyNip ?? '').replace(/\D/g, '');
  const gdzieNip = new Map();
  for (const d of dokumenty) {
    for (const nip of nipyWTekscie((d.linie ?? []).join('\n'))) {
      if (!gdzieNip.has(nip)) gdzieNip.set(nip, []);
      gdzieNip.get(nip).push(d.nazwa);
    }
  }
  const czytelne = dokumenty.filter((d) => d.linie?.length);
  // Własny NIP szukamy po samych cyfrach (z kreskami i spacjami lub bez), nie tylko za etykietą „NIP”.
  const zCyframi = (d) => (d.linie ?? []).join(' ').replace(/(\d)[\s-]+(?=\d)/g, '$1').includes(wlasny);
  if (wlasny.length === 10 && czytelne.length) {
    const zNipem = czytelne.filter(zCyframi).map((d) => d.nazwa);
    if (zNipem.length) {
      wyniki.push({ kod: 'nip_ok', poziom: 'ok', tytul: 'Twój NIP jest w ofercie', szczegol: `NIP ${wlasny}`, pliki: zNipem });
    } else {
      wyniki.push({ kod: 'brak_nipu', poziom: 'uwaga', tytul: 'Twojego NIP-u nie ma w żadnym pliku', szczegol: `Formularz ofertowy powinien zawierać NIP ${wlasny}. Sprawdź dane wykonawcy.`, pliki: [] });
    }
  }
  for (const [nip, gdzie] of gdzieNip) {
    if (nip === wlasny || nip === zam) continue;
    wyniki.push({ kod: 'obcy_nip', poziom: 'uwaga', tytul: `Obcy NIP ${nip}`, szczegol: 'Inny niż Twój i zamawiającego. Jeśli to nie podwykonawca, konsorcjant ani podmiot udostępniający zasoby, to może być pozostałość z innej oferty.', pliki: [...new Set(gdzie)] });
  }

  // 4. Kwoty brutto.
  const kwotyPlikow = new Map();
  for (const d of dokumenty) {
    const kwoty = new Set((d.linie ?? []).flatMap((l) => kwotyBrutto(l)));
    if (kwoty.size) kwotyPlikow.set(d.nazwa, [...kwoty]);
  }
  const wszystkie = new Set([...kwotyPlikow.values()].flat());
  const fmt = (n) => `${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
  if (kwotyPlikow.size >= 2 && wszystkie.size >= 2) {
    wyniki.push({ kod: 'rozne_kwoty', poziom: 'uwaga', tytul: 'Różne kwoty brutto w plikach', szczegol: [...kwotyPlikow].map(([n, k]) => `${n}: ${k.slice(0, 3).map(fmt).join(', ')}`).join(' · ') + '. Sprawdź, czy cena w formularzu zgadza się z kosztorysem.', pliki: [...kwotyPlikow.keys()] });
  } else if (wszystkie.size === 1) {
    wyniki.push({ kod: 'kwota', poziom: 'ok', tytul: `Cena brutto: ${fmt([...wszystkie][0])}`, szczegol: 'Ta sama kwota we wszystkich plikach, w których ją znaleźliśmy. Porównaj ją z ceną, którą chcesz złożyć.', pliki: [...kwotyPlikow.keys()] });
  }

  // 5. Czego nie sprawdziliśmy w tych plikach.
  for (const p of pliki) {
    if (p.rodzaj === 'pdf' && !p.linie?.length) nieSprawdzone.push({ tytul: p.nazwa, powod: 'Skan bez warstwy tekstowej — treści nie sprawdziliśmy (podpis tak).' });
    if (p.rodzaj === 'kontener') nieSprawdzone.push({ tytul: p.nazwa, powod: 'Archiwum lub kontener podpisu — nie rozpakowujemy go. Wrzuć pliki z wnętrza.' });
    if (p.rodzaj === 'inne') nieSprawdzone.push({ tytul: p.nazwa, powod: 'Tego formatu nie czytamy (sprawdzamy PDF i Word .docx).' });
  }
  nieSprawdzone.push(...NIE_SPRAWDZONE_ZAWSZE);

  const kolejnosc = { blad: 0, uwaga: 1, ok: 2 };
  wyniki.sort((a, b) => kolejnosc[a.poziom] - kolejnosc[b.poziom]);
  return {
    podsumowanie: {
      bledy: wyniki.filter((w) => w.poziom === 'blad').length,
      uwagi: wyniki.filter((w) => w.poziom === 'uwaga').length,
      plikow: pliki.length,
    },
    wyniki,
    pliki: pliki.map((p) => ({ nazwa: p.nazwa, rodzaj: p.rodzaj, podpis: p.podpis ?? (p.rodzaj === 'podpis_zewnetrzny' ? 'plik_podpisu' : null), znakow: p.linie ? p.linie.join(' ').length : null })),
    nie_sprawdzone: nieSprawdzone,
  };
}

/**
 * Surowe pliki (base64) → odczyt → raport. `tekstPdf(buf)` zwraca linie tekstu PDF-a (wstrzykiwane;
 * produkcyjnie pdfjs). Rzuca `{status, message}` przy złym wejściu (za dużo / za duże pliki).
 */
export async function kontrolujPlikiOferty({ pliki = [], firma = {}, zamawiajacyNip = null }, { tekstPdf }) {
  const blad = (status, message) => Object.assign(new Error(message), { status });
  if (!Array.isArray(pliki) || !pliki.length) throw blad(400, 'Dodaj co najmniej jeden plik oferty.');
  if (pliki.length > MAKS_PLIKOW) throw blad(413, `Najwyżej ${MAKS_PLIKOW} plików naraz.`);
  let razem = 0;
  const odczytane = [];
  for (const p of pliki) {
    const nazwa = String(p?.nazwa ?? '').trim().slice(0, 200) || 'plik';
    const b64 = String(p?.base64 ?? '').replace(/^data:[^;]*;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) throw blad(400, `Plik „${nazwa}” jest pusty.`);
    if (buf.length > MAKS_BAJTOW_PLIKU) throw blad(413, `Plik „${nazwa}” ma ponad ${MAKS_BAJTOW_PLIKU / 1024 / 1024} MB.`);
    razem += buf.length;
    if (razem > MAKS_BAJTOW_RAZEM) throw blad(413, `Pliki razem mają ponad ${MAKS_BAJTOW_RAZEM / 1024 / 1024} MB — sprawdź je w dwóch częściach.`);
    const rodzaj = rodzajPliku(nazwa, buf);
    let linie = null;
    let podpisany = false;
    if (rodzaj === 'pdf') {
      podpisany = podpisWPdf(buf);
      linie = await tekstPdf(buf).catch(() => null);
    } else if (rodzaj === 'docx') {
      try { ({ linie, podpisany } = czytajDocx(buf)); } catch { linie = null; }
    }
    odczytane.push({ nazwa, rodzaj, linie, podpisany });
  }
  return ocenOferte({ pliki: odczytane, firma, zamawiajacyNip });
}
