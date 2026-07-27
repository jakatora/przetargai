import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  createSejfDokumentow,
  wykryjFormatIPodpis,
  opiszDokument,
} from '../src/services/sejfDokumentow.js';
import { STATUS, dataWaznosci } from '../src/services/waznoscDokumentow.js';
import { typDokumentu } from '../src/config/dokumentyKatalog.js';

/*
 * Usługa sejfu dokumentów + oryginały plików (podzadanie 3/7 ulepszenia „Sejf
 * podmiotowych środków dowodowych z licznikiem świeżości").
 *
 * Sedno tego podzadania testujemy tu na dwóch osiach:
 *  1. DETEKCJA FORMATU I PODPISU — usługa musi rozpoznać oryginał elektroniczny
 *     (XML z XAdES / cyfrowo podpisany PDF) i oflagować `flaga_podpis_elektroniczny
 *     = false`, gdy wgrano SKAN PAPIERU (obraz w PDF) zamiast dokumentu
 *     elektronicznego. Rozpoznanie idzie po TREŚCI (magic bytes), nie po rozszerzeniu.
 *  2. WYLICZANIE STATUSU — usługa wzbogaca rekord licznikiem dni i statusem
 *     ('gotowy'|'zamow_nowy'|'przeterminowany') przez czystą logikę z kroku 2,
 *     biorąc realny czas urzędu z katalogu (KRK alarmuje najwcześniej).
 * Dodatkowo: CRUD round-trip i zapis ORYGINALNEGO pliku bez modyfikacji.
 */

// ── Fikstury plików (minimalne, ale z realnymi markerami) ────────────────────

const XML_PODPISANY = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?>
   <Zaswiadczenie xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
     <Tresc>Nie figuruje w Kartotece Karnej.</Tresc>
     <ds:Signature><ds:SignedInfo/><ds:SignatureValue>QUJD</ds:SignatureValue>
       <ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"/></ds:Object>
     </ds:Signature>
   </Zaswiadczenie>`,
  'utf8',
);

const XML_BEZ_PODPISU = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?><Zaswiadczenie><Tresc>Wersja robocza</Tresc></Zaswiadczenie>`,
  'utf8',
);

const XML_Z_BOM = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8 BOM
  Buffer.from('\n   <?xml version="1.0"?><Zaswiadczenie/>', 'utf8'),
]);

const PDF_PODPISANY = Buffer.from(
  `%PDF-1.7
1 0 obj<</Type/Catalog>>endobj
2 0 obj<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/ETSI.CAdES.detached
/ByteRange [0 1000 2000 3000]/Contents <30820...>>>endobj
%%EOF`,
  'latin1',
);

const PDF_SKAN = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
4 0 obj<</Type/XObject/Subtype/Image/Width 2480/Height 3508/Filter/DCTDecode
/BitsPerComponent 8/ColorSpace/DeviceRGB/Length 900000>>stream
......(zdjęcie kartki papieru).......
endstream endobj
%%EOF`,
  'latin1',
);

const JPEG_SUROWY = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

// ── Setup bazy in-memory (świeży schemat + jeden użytkownik) ─────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');

function freshDb() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(schemaSql);
  d.prepare(
    "INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','a@b.pl','h','t','t')",
  ).run();
  return d;
}

/** Magazyn plików w pamięci — test nie dotyka dysku i może sprawdzić bajt-w-bajt. */
function magazynPamiec() {
  const store = new Map();
  return {
    async zapisz(id, format, bajty) {
      store.set(id, Buffer.from(bajty));
      return `mem://${id}.${format}`;
    },
    async czytaj(id) {
      return store.get(id);
    },
    _store: store,
  };
}

// ══════════════════════════ 1. DETEKCJA FORMATU/PODPISU ══════════════════════

test('detekcja — XML z podpisem XAdES to dokument elektroniczny (flaga true)', () => {
  const d = wykryjFormatIPodpis(XML_PODPISANY, 'krk.xml');
  assert.equal(d.format, 'xml');
  assert.equal(d.podpisElektroniczny, true);
  assert.equal(d.jestSkanem, false);
});

test('detekcja — XML bez podpisu ma format xml, ale flaga podpisu = false', () => {
  const d = wykryjFormatIPodpis(XML_BEZ_PODPISU, 'wersja.xml');
  assert.equal(d.format, 'xml');
  assert.equal(d.podpisElektroniczny, false);
});

test('detekcja — XML rozpoznany mimo BOM i białych znaków przed <?xml', () => {
  const d = wykryjFormatIPodpis(XML_Z_BOM, 'z-bom.xml');
  assert.equal(d.format, 'xml');
});

test('detekcja — cyfrowo podpisany PDF (ByteRange/PPKLite/ETSI) to podpis elektroniczny', () => {
  const d = wykryjFormatIPodpis(PDF_PODPISANY, 'zus.pdf');
  assert.equal(d.format, 'pdf');
  assert.equal(d.podpisElektroniczny, true);
  assert.equal(d.jestSkanem, false);
});

test('detekcja — SKAN papieru (PDF z obrazem, bez podpisu) → flaga false, jestSkanem true', () => {
  const d = wykryjFormatIPodpis(PDF_SKAN, 'skan.pdf');
  assert.equal(d.format, 'pdf');
  assert.equal(d.podpisElektroniczny, false);
  assert.equal(d.jestSkanem, true);
  assert.match(d.powod, /skan|obraz/i);
});

test('detekcja — surowy obraz (JPEG) nie jest dokumentem elektronicznym (format null)', () => {
  const d = wykryjFormatIPodpis(JPEG_SUROWY, 'foto.jpg');
  assert.equal(d.format, null);
  assert.equal(d.podpisElektroniczny, false);
  assert.equal(d.jestSkanem, true);
});

test('detekcja — treść (magic bytes) wygrywa z mylącym rozszerzeniem', () => {
  // Plik nazwany .xml, ale w środku PDF — ufamy treści, nie nazwie.
  const d = wykryjFormatIPodpis(PDF_PODPISANY, 'podszywa-sie.xml');
  assert.equal(d.format, 'pdf');
});

// ══════════════════════════ 2. WYLICZANIE STATUSU ════════════════════════════

test('status — KRK z dużym zapasem dni jest „gotowy"', () => {
  const wyst = '2026-03-01';
  const r = opiszDokument(
    { typ_dokumentu: 'krk', data_wystawienia: wyst, okres_waznosci_dni: null },
    { dzienOdniesienia: wyst }, // dziś = dzień wystawienia → zapas = pełne 180 dni
  );
  assert.equal(r.status, STATUS.GOTOWY);
  assert.equal(r.dniDoWaznosci, 180);
  assert.equal(r.dataWaznosci, dataWaznosci(wyst, 180));
});

test('status — KRK w oknie czasu urzędu (≤21 dni) to „zamów nowy"', () => {
  const wyst = '2026-03-01';
  const dzien = dataWaznosci(wyst, 170); // 10 dni do końca ważności (180 − 170)
  const r = opiszDokument(
    { typ_dokumentu: 'krk', data_wystawienia: wyst, okres_waznosci_dni: null },
    { dzienOdniesienia: dzien },
  );
  assert.equal(r.dniDoWaznosci, 10);
  assert.equal(r.status, STATUS.ZAMOW_NOWY);
});

test('status — dokument po dacie ważności jest „przeterminowany"', () => {
  const wyst = '2026-03-01';
  const dzien = dataWaznosci(wyst, 200); // 20 dni PO utracie ważności (180)
  const r = opiszDokument(
    { typ_dokumentu: 'krk', data_wystawienia: wyst, okres_waznosci_dni: null },
    { dzienOdniesienia: dzien },
  );
  assert.equal(r.dniDoWaznosci, -20);
  assert.equal(r.status, STATUS.PRZETERMINOWANY);
});

test('status — dokument bezterminowy (wykaz robót) zawsze „gotowy", dni = Infinity', () => {
  const r = opiszDokument(
    { typ_dokumentu: 'wykaz_robot_uslugi', data_wystawienia: '2020-01-01', okres_waznosci_dni: null },
    { dzienOdniesienia: '2030-01-01' },
  );
  assert.equal(r.status, STATUS.GOTOWY);
  assert.equal(r.dniDoWaznosci, Infinity);
  assert.equal(r.dataWaznosci, null);
});

test('status — indywidualny okres_waznosci_dni nadpisuje domyślny z katalogu', () => {
  const wyst = '2026-03-01';
  // Nadpisanie na 20 dni (< czas urzędu KRK = 21) → od razu „zamów nowy",
  // podczas gdy domyślne 180 dni dałoby „gotowy". To dowodzi użycia nadpisania.
  const r = opiszDokument(
    { typ_dokumentu: 'krk', data_wystawienia: wyst, okres_waznosci_dni: 20 },
    { dzienOdniesienia: wyst },
  );
  assert.equal(r.dniDoWaznosci, 20);
  assert.equal(r.status, STATUS.ZAMOW_NOWY);
});

test('status — KRK alarmuje wcześniej niż US przy tym samym zapasie dni (realny czas urzędu)', () => {
  const wyst = '2026-03-01';
  const okres = 100;
  const dzien = dataWaznosci(wyst, okres - 14); // oba mają dokładnie 14 dni zapasu
  const krk = opiszDokument(
    { typ_dokumentu: 'krk', data_wystawienia: wyst, okres_waznosci_dni: okres },
    { dzienOdniesienia: dzien },
  );
  const us = opiszDokument(
    { typ_dokumentu: 'us', data_wystawienia: wyst, okres_waznosci_dni: okres },
    { dzienOdniesienia: dzien },
  );
  assert.equal(krk.dniDoWaznosci, 14);
  assert.equal(us.dniDoWaznosci, 14);
  assert.equal(krk.status, STATUS.ZAMOW_NOWY, 'KRK (czas urzędu 21) zamawiać już przy 14 dniach');
  assert.equal(us.status, STATUS.GOTOWY, 'US (czas urzędu 7) przy 14 dniach jeszcze gotowy');
});

test('status — wzbogacenie dokłada dane z katalogu (nazwa, link online, czas urzędu)', () => {
  const r = opiszDokument(
    { typ_dokumentu: 'krk', data_wystawienia: '2026-03-01', okres_waznosci_dni: null },
    { dzienOdniesienia: '2026-03-01' },
  );
  assert.equal(r.czasOczekiwaniaUrzadDni, typDokumentu('krk').czasOczekiwaniaUrzadDni);
  assert.equal(r.online.nazwa, 'e-KRK');
  assert.equal(r.wymagaDokumentuElektronicznego, true);
  assert.ok(r.nazwaTypu.includes('KRK'));
});

// ══════════════════════════ 3. CRUD + oryginały plików ═══════════════════════

test('CRUD — utworz→pobierz: zapamiętuje pola, flaga podpisu domyślnie false, okres z katalogu', () => {
  const d = freshDb();
  const sejf = createSejfDokumentow(d);
  const rek = sejf.utworz('u1', { typ: 'krk', dataWystawienia: '2026-03-01' });
  assert.ok(rek.id, 'nadany id');
  const pobrany = sejf.pobierz('u1', rek.id, { dzienOdniesienia: '2026-03-01' });
  assert.equal(pobrany.typ_dokumentu, 'krk');
  assert.equal(pobrany.data_wystawienia, '2026-03-01');
  assert.equal(pobrany.flaga_podpis_elektroniczny, false);
  assert.equal(pobrany.okresWaznosciDni, 180, 'brak nadpisania → domyślne 180 z katalogu');
  assert.equal(pobrany.status, STATUS.GOTOWY);
  d.close();
});

test('CRUD — utworz odrzuca nieznany typ dokumentu (walidacja w warstwie usług)', () => {
  const d = freshDb();
  const sejf = createSejfDokumentow(d);
  assert.throws(() => sejf.utworz('u1', { typ: 'nieistniejacy' }), /typ/i);
  d.close();
});

test('CRUD — lista zwraca tylko dokumenty właściciela, wzbogacone o status', () => {
  const d = freshDb();
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u2','c@d.pl','h','t','t')").run();
  const sejf = createSejfDokumentow(d);
  sejf.utworz('u1', { typ: 'krk', dataWystawienia: '2026-03-01' });
  sejf.utworz('u1', { typ: 'zus', dataWystawienia: '2026-03-01' });
  sejf.utworz('u2', { typ: 'us', dataWystawienia: '2026-03-01' });

  const lista = sejf.lista('u1', { dzienOdniesienia: '2026-03-01' });
  assert.equal(lista.length, 2, 'tylko dokumenty u1');
  assert.ok(lista.every((x) => typeof x.status === 'string'), 'każdy wzbogacony o status');
  d.close();
});

test('CRUD — aktualizuj zmienia pola i podbija updated_at; usun kasuje', () => {
  const d = freshDb();
  const sejf = createSejfDokumentow(d);
  const rek = sejf.utworz('u1', { typ: 'polisa_oc', dataWystawienia: '2026-01-01' });
  const zmieniony = sejf.aktualizuj('u1', rek.id, { notatka: 'polisa roczna', okresWaznosciDni: 180 });
  assert.equal(zmieniony.notatka, 'polisa roczna');
  assert.equal(zmieniony.okres_waznosci_dni, 180);

  assert.equal(sejf.usun('u1', rek.id), true);
  assert.equal(sejf.pobierz('u1', rek.id), null, 'po usunięciu brak rekordu');
  d.close();
});

test('CRUD — pobierz/usun są przypisane do właściciela (cudzy dokument niewidoczny)', () => {
  const d = freshDb();
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u2','c@d.pl','h','t','t')").run();
  const sejf = createSejfDokumentow(d);
  const rek = sejf.utworz('u1', { typ: 'krk', dataWystawienia: '2026-03-01' });
  assert.equal(sejf.pobierz('u2', rek.id), null, 'inny user nie widzi dokumentu');
  assert.equal(sejf.usun('u2', rek.id), false, 'inny user nie usunie dokumentu');
  d.close();
});

test('plik — zapiszPlik: podpisany XML zapala flagę i zapisuje ORYGINAŁ bajt-w-bajt', async () => {
  const d = freshDb();
  const mag = magazynPamiec();
  const sejf = createSejfDokumentow(d, { magazynPlikow: mag });
  const rek = sejf.utworz('u1', { typ: 'krk', dataWystawienia: '2026-03-01' });

  const wynik = await sejf.zapiszPlik('u1', rek.id, { nazwaPliku: 'krk.xml', bajty: XML_PODPISANY });
  assert.equal(wynik.rekord.plik_format, 'xml');
  assert.equal(wynik.rekord.flaga_podpis_elektroniczny, true);
  assert.ok(wynik.rekord.plik_url, 'zapisany URL/ścieżka pliku');
  assert.equal(wynik.ostrzezenie, null, 'podpisany oryginał — bez ostrzeżenia');

  // Oryginał zapisany bez żadnej modyfikacji.
  assert.ok(mag._store.get(rek.id).equals(XML_PODPISANY), 'bajty pliku identyczne z wgranymi');
  d.close();
});

test('plik — zapiszPlik: skan papieru (PDF-obraz) → flaga false + ostrzeżenie o skanie', async () => {
  const d = freshDb();
  const mag = magazynPamiec();
  const sejf = createSejfDokumentow(d, { magazynPlikow: mag });
  const rek = sejf.utworz('u1', { typ: 'zus', dataWystawienia: '2026-03-01' });

  const wynik = await sejf.zapiszPlik('u1', rek.id, { nazwaPliku: 'skan.pdf', bajty: PDF_SKAN });
  assert.equal(wynik.rekord.plik_format, 'pdf');
  assert.equal(wynik.rekord.flaga_podpis_elektroniczny, false);
  assert.match(wynik.ostrzezenie, /skan|elektron/i, 'ostrzeżenie, że to skan, nie dokument elektroniczny');
  d.close();
});

test('plik — zapiszPlik odrzuca format spoza XML/PDF (surowy obraz)', async () => {
  const d = freshDb();
  const sejf = createSejfDokumentow(d, { magazynPlikow: magazynPamiec() });
  const rek = sejf.utworz('u1', { typ: 'krk', dataWystawienia: '2026-03-01' });
  await assert.rejects(
    () => sejf.zapiszPlik('u1', rek.id, { nazwaPliku: 'foto.jpg', bajty: JPEG_SUROWY }),
    /format|XML|PDF/i,
  );
  d.close();
});
