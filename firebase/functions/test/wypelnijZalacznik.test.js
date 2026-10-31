import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zbudujZip } from '../src/lib/docx.js';
import { czytajZip, akapity, miejscaDoWpisania, poleDlaEtykiety, wypelnijDocx } from '../src/lib/wypelnijZalacznik.js';

/*
 * Wypełnianie załącznika zamawiającego (2026-10-31). Przypadki wzięte z prawdziwych formularzy
 * z e-Zamówień (8 plików, 31.10): każda pułapka, na której pierwsza wersja wpisała złą treść.
 */
const akapit = (...runy) => `<w:p><w:pPr/>${runy.map((r) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${r}</w:t></w:r>`).join('')}</w:p>`;
const KROPKI = '……………………';

function docx(akapity) {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${akapity.join('')}<w:sectPr/></w:body></w:document>`;
  return zbudujZip([
    { nazwa: '[Content_Types].xml', dane: Buffer.from('<Types/>') },
    { nazwa: 'word/document.xml', dane: Buffer.from(xml, 'utf8') },
    { nazwa: 'word/styles.xml', dane: Buffer.from('<w:styles/>') },
  ]);
}
const DANE = { nazwa: 'Budmax Sp. z o.o.', adres: 'ul. Polna 3, 35-001 Rzeszów', nip: '813-000-00-01', regon: '180000000', rejestr: 'KRS 0000123456', reprezentant: 'Jan Kowalski', stanowisko: 'Prezes Zarządu', email: 'biuro@budmax.pl', telefon: '600 100 200', miejscowosc: 'Rzeszów' };
const tekstWyniku = (plik) => akapity(czytajZip(plik).find((w) => w.nazwa === 'word/document.xml').dane.toString('utf8')).map((a) => a.tekst);

test('formularz ofertowy: dane firmy wpisane, cena/podpis/obce pola zostają, reszta archiwum nietknięta', () => {
  const wejscie = docx([
    akapit('Nazwa Wykonawcy/Wykonawców:', '……………', '………'), // kropki rozbite na dwa runy
    akapit(KROPKI + KROPKI), // ciąg dalszy linii nazwy — nie nowe pole
    akapit('NIP ', KROPKI, ' REGON ', KROPKI),
    akapit('Adres siedziby Wykonawcy¹:', KROPKI),
    akapit('adres e-mail Wykonawcy ', KROPKI),
    akapit('Osoba upoważniona do reprezentacji Wykonawcy i podpisująca ofertę:', KROPKI),
    akapit('Osobą reprezentującą Zamawiającego jest: ', KROPKI),
    akapit('Zamawiający posiada nr NIP: 663-14-05-258 i upoważnia Wykonawcę posiadającego nr NIP: ', KROPKI),
    akapit('(cena ofertowa) brutto:', '.....................', ' zł'),
    akapit('Nazwa towaru: ', KROPKI),
    akapit('Wykonawca ', KROPKI, ' (nazwa i adres Wykonawcy) zrealizuje następujące roboty: ', KROPKI),
    akapit(KROPKI, ', dnia ', KROPKI),
    akapit(KROPKI),
    akapit('podpis kwalifikowany'),
  ]);
  const w = wypelnijDocx(wejscie, DANE, { dzis: '2026-10-31' });
  const t = tekstWyniku(w.plik);
  assert.equal(t[0], 'Nazwa Wykonawcy/Wykonawców: Budmax Sp. z o.o.');
  assert.equal(t[1], KROPKI + KROPKI, 'ciąg dalszy zostaje');
  assert.equal(t[2], 'NIP 813-000-00-01 REGON 180000000');
  assert.equal(t[3], 'Adres siedziby Wykonawcy¹: ul. Polna 3, 35-001 Rzeszów', 'adres, nie nazwa, mimo „Wykonawcy” na końcu');
  assert.equal(t[4], 'adres e-mail Wykonawcy biuro@budmax.pl');
  assert.equal(t[5], 'Osoba upoważniona do reprezentacji Wykonawcy i podpisująca ofertę: Jan Kowalski', '„podpisująca” to nie miejsce na podpis');
  assert.equal(t[6], `Osobą reprezentującą Zamawiającego jest: ${KROPKI}`, 'osoba zamawiającego — nie nasza');
  assert.ok(t[7].endsWith('posiadającego nr NIP: 813-000-00-01'), 'NIP wykonawcy, nie zamawiającego');
  assert.match(t[8], /\.{10,} zł$/, 'cena zostaje dla wykonawcy');
  assert.equal(t[9], `Nazwa towaru: ${KROPKI}`, '„nazwa towaru” to nie nazwa firmy');
  assert.equal(t[10], `Wykonawca Budmax Sp. z o.o., ul. Polna 3, 35-001 Rzeszów (nazwa i adres Wykonawcy) zrealizuje następujące roboty: ${KROPKI}`);
  assert.equal(t[11], 'Rzeszów, dnia 31.10.2026');
  assert.equal(t[12], KROPKI, 'miejsce na podpis zostaje puste');

  assert.deepEqual(w.wypelnione.map((x) => x.pole), ['nazwa', 'nip', 'regon', 'adres', 'email', 'reprezentant', 'nip', 'nazwa_adres', 'miejscowosc', 'data']);
  assert.ok(w.do_uzupelnienia.some((x) => /cena ofertowa/.test(x.etykieta) && /wpisz sam/.test(x.powod)));
  assert.ok(w.do_uzupelnienia.some((x) => /Nazwa towaru/.test(x.etykieta)));
  const pliki = czytajZip(w.plik);
  assert.deepEqual(pliki.map((p) => p.nazwa), ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml']);
  assert.equal(pliki[2].dane.toString(), '<w:styles/>');
  assert.match(pliki[1].dane.toString(), /<w:b\/>/, 'formatowanie runów zostaje');
});

test('brak danych firmy → pole zostaje i trafia do listy; znaki XML w danych są bezpieczne', () => {
  const w = wypelnijDocx(docx([akapit('REGON: ', KROPKI), akapit('Nazwa wykonawcy: ', KROPKI)]), { nazwa: 'Kowalski & Syn <Budowa>' }, { dzis: '2026-10-31' });
  assert.deepEqual(tekstWyniku(w.plik), [`REGON: ${KROPKI}`, 'Nazwa wykonawcy: Kowalski & Syn <Budowa>']);
  assert.deepEqual(w.do_uzupelnienia, [{ etykieta: 'REGON:', powod: 'brak „REGON” w danych firmy' }]);
});

test('miejsca do wpisania i etykiety', () => {
  assert.deepEqual(miejscaDoWpisania('itd... i ......... oraz ___ i _____'), [{ od: 9, do: 18 }, { od: 30, do: 35 }]);
  assert.equal(poleDlaEtykiety('Wykonawca:'), 'nazwa');
  assert.equal(poleDlaEtykiety('Dane Wykonawcy:'), 'nazwa');
  assert.equal(poleDlaEtykiety('Forma prawna Wykonawcy'), null);
  assert.equal(poleDlaEtykiety('nazwa podmiotu certyfikującego:'), 'reczne');
  assert.equal(poleDlaEtykiety('- przy udziale podwykonawców:'), 'reczne');
  assert.equal(poleDlaEtykiety('zawarta w dniu'), null, 'dzień zawarcia umowy to nie dzisiejsza data');
  assert.equal(poleDlaEtykiety('osobą upoważnioną do kontaktów z Zamawiającym jest'), 'reprezentant');
  assert.equal(poleDlaEtykiety('(miejscowość, data)'), 'miejscowosc_data');
  assert.throws(() => czytajZip(Buffer.from('to nie zip')), /ZIP/);
  assert.throws(() => wypelnijDocx(zbudujZip([{ nazwa: 'a.txt', dane: Buffer.from('x') }]), DANE), /Word/);
});

test('pobieranie: tylko e-Zamówienia/platformazakupowa, przekierowanie sprawdzane, .doc i PDF z jasnym komunikatem', async () => {
  const { pobierzZalacznik } = await import('../src/lib/wypelnijZalacznik.js');
  const odp = (status, body, location) => ({ status, ok: status >= 200 && status < 300, headers: { get: (h) => (h === 'location' ? location ?? null : null) }, arrayBuffer: async () => body });
  const ok = 'https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/a/a_1';
  await assert.rejects(pobierzZalacznik('https://evil.example/plik.docx', { fetchFn: async () => odp(200, Buffer.alloc(0)) }), (e) => e.status === 400);
  await assert.rejects(pobierzZalacznik(ok, { fetchFn: async () => odp(302, null, 'https://evil.example/x') }), (e) => e.status === 400, 'przekierowanie poza listę');
  await assert.rejects(pobierzZalacznik(ok, { fetchFn: async () => odp(200, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2])) }), (e) => e.status === 422 && /\.doc/.test(e.message));
  await assert.rejects(pobierzZalacznik(ok, { fetchFn: async () => odp(200, Buffer.from('%PDF-1.7')) }), (e) => e.status === 422 && /PDF/.test(e.message));
  await assert.rejects(pobierzZalacznik(ok, { fetchFn: async () => odp(404, null) }), (e) => e.status === 502);
  const docxBuf = zbudujZip([{ nazwa: 'word/document.xml', dane: Buffer.from('<w:document/>') }]);
  let wywolania = 0;
  const wynik = await pobierzZalacznik(ok, { fetchFn: async (u) => { wywolania++; return wywolania === 1 ? odp(302, null, '/mp-readmodels/api/inny') : odp(200, docxBuf); } });
  assert.equal(wynik.length, docxBuf.length);
});

test('odmiana liczby pól w temacie e-maila', async () => {
  const { liczbaPol } = await import('../src/lib/wypelnijZalacznik.js');
  assert.deepEqual([1, 2, 5, 12, 22, 25].map(liczbaPol), ['1 pole', '2 pola', '5 pól', '12 pól', '22 pola', '25 pól']);
});
