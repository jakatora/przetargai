import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zbudujDocx } from '../src/lib/docx.js';
import {
  rodzajPliku, podpisWPdf, poprawnyNip, nipyWTekscie, kwotyBrutto, pustePola, ocenOferte, kontrolujPlikiOferty, MAKS_PLIKOW,
} from '../src/lib/kontrolaPlikowOferty.js';
import { liniePdf } from '../src/services/tekstPdf.js';
import { pdfZLiniami } from './pdfTestowy.js';

const NIP_FIRMY = '5830001675';
const NIP_ZAM = '7490005094';
const NIP_OBCY = '5222946795';

test('rodzaj pliku po zawartości; podpis PAdES; NIP z sumą kontrolną i etykietą', () => {
  assert.equal(rodzajPliku('oferta.pdf', pdfZLiniami(['x'])), 'pdf');
  assert.equal(rodzajPliku('oferta.pdf.xades', Buffer.from('<xml/>')), 'podpis_zewnetrzny');
  assert.equal(rodzajPliku('paczka.zip', Buffer.from('PK\x03\x04xx')), 'kontener');
  assert.equal(rodzajPliku('formularz.docx', zbudujDocx({ tresc: 'a' })), 'docx');
  assert.equal(rodzajPliku('zdjecie.jpg', Buffer.from([0xff, 0xd8, 0xff])), 'inne');
  assert.equal(podpisWPdf(pdfZLiniami(['x'], { podpis: true })), true);
  assert.equal(podpisWPdf(pdfZLiniami(['x'])), false);
  assert.equal(poprawnyNip(NIP_FIRMY), true);
  assert.equal(poprawnyNip('5830001676'), false);
  assert.deepEqual(nipyWTekscie(`NIP: 583-000-16-75, tel. 5830001675, NIP 5830001676`), [NIP_FIRMY]);
});

test('kwoty brutto tylko z linii o cenie/wartości; puste pola z etykietą, miejsce na podpis pominięte', () => {
  assert.deepEqual(kwotyBrutto('Cena oferty brutto: 123 456,78 zł'), [123456.78]);
  assert.deepEqual(kwotyBrutto('Razem wartość brutto 1.234,50'), [1234.5]);
  assert.deepEqual(kwotyBrutto('Wadium 5 000,00 zł'), []);
  const puste = pustePola(['Cena oferty brutto: ……………… zł', 'Nazwa wykonawcy: ACME Sp. z o.o.', '…………………………… (podpis osoby upoważnionej)']);
  assert.equal(puste.length, 1);
  assert.match(puste[0].etykieta, /Cena oferty brutto/);
});

test('raport: brak podpisu formularza = błąd, .xades obok = podpis; obcy NIP; różne kwoty; skan i zip w „nie sprawdziliśmy”', () => {
  const r = ocenOferte({
    firma: { nip: NIP_FIRMY },
    zamawiajacyNip: NIP_ZAM,
    pliki: [
      { nazwa: 'Formularz ofertowy.pdf', rodzaj: 'pdf', podpisany: false, linie: [`Wykonawca NIP ${NIP_FIRMY}`, 'Cena oferty brutto: 100 000,00 zł'] },
      { nazwa: 'kosztorys.pdf', rodzaj: 'pdf', podpisany: false, linie: ['Razem wartość brutto 100 500,00', `Zamawiający NIP ${NIP_ZAM}`, `Wykonawca NIP ${NIP_OBCY}`] },
      { nazwa: 'kosztorys.pdf.xades', rodzaj: 'podpis_zewnetrzny', podpisany: false, linie: null },
      { nazwa: 'karta katalogowa.pdf', rodzaj: 'pdf', podpisany: true, linie: [] },
      { nazwa: 'zalaczniki.zip', rodzaj: 'kontener', podpisany: false, linie: null },
    ],
  });
  assert.equal(r.podsumowanie.bledy, 1);
  const kody = r.wyniki.map((w) => w.kod);
  assert.equal(kody[0], 'brak_podpisu', 'błędy na początku');
  assert.deepEqual(r.wyniki[0].pliki, ['Formularz ofertowy.pdf']);
  assert.ok(kody.includes('obcy_nip') && r.wyniki.find((w) => w.kod === 'obcy_nip').tytul.includes(NIP_OBCY));
  assert.ok(kody.includes('rozne_kwoty'));
  assert.ok(kody.includes('nip_ok'));
  assert.equal(r.pliki.find((p) => p.nazwa === 'kosztorys.pdf').podpis, 'zewnetrzny');
  assert.ok(r.nie_sprawdzone.some((n) => n.tytul === 'karta katalogowa.pdf' && /Skan/.test(n.powod)));
  assert.ok(r.nie_sprawdzone.some((n) => n.tytul === 'zalaczniki.zip'));
  assert.ok(r.nie_sprawdzone.some((n) => n.tytul === 'Wadium'), 'stała lista tego, czego nie sprawdzamy');
});

test('end-to-end: prawdziwy odczyt PDF (pdfjs) i DOCX; brak Twojego NIP-u; jedna cena = ok', async () => {
  const formularz = pdfZLiniami(['FORMULARZ OFERTOWY', 'Nazwa wykonawcy: ACME', 'Cena oferty brutto: 50 000,00 zl', 'Termin realizacji: ........................ dni'], { podpis: true });
  const oswiadczenie = zbudujDocx({ tresc: 'Oświadczenie wykonawcy\nCena oferty brutto: 50 000,00 zł\nMiejscowość ……………… dnia ………………' });
  const r = await kontrolujPlikiOferty({
    firma: { nip: NIP_FIRMY },
    pliki: [
      { nazwa: 'formularz.pdf', base64: formularz.toString('base64') },
      { nazwa: 'oswiadczenie.docx', base64: oswiadczenie.toString('base64') },
    ],
  }, { tekstPdf: liniePdf });
  const kody = r.wyniki.map((w) => w.kod);
  assert.ok(kody.includes('brak_podpisu'), 'oświadczenie.docx bez podpisu');
  assert.ok(kody.includes('brak_nipu'));
  assert.ok(kody.includes('kwota'));
  const puste = r.wyniki.filter((w) => w.kod === 'puste_pola');
  assert.ok(puste.some((w) => w.pliki[0] === 'formularz.pdf' && /Termin realizacji/.test(w.szczegol)));
  assert.equal(r.pliki.find((p) => p.nazwa === 'formularz.pdf').podpis, 'wewnetrzny');
});

test('złe wejście: brak plików, za dużo plików', async () => {
  await assert.rejects(kontrolujPlikiOferty({ pliki: [] }, { tekstPdf: async () => [] }), /co najmniej jeden/);
  const duzo = Array.from({ length: MAKS_PLIKOW + 1 }, (_, i) => ({ nazwa: `${i}.pdf`, base64: 'JVBERi0=' }));
  await assert.rejects(kontrolujPlikiOferty({ pliki: duzo }, { tekstPdf: async () => [] }), (e) => e.status === 413);
});
