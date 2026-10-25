import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { zbudujDocx, zbudujZip, crc32, escXml, nazwaPlikuDocx } from '../src/lib/docx.js';

/** Minimalny czytnik ZIP przez katalog centralny — niezależny od zapisu, więc sprawdza format, nie własne założenia. */
function rozpakuj(buf) {
  const koniec = buf.lastIndexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06]));
  assert.ok(koniec > 0, 'rekord końca katalogu');
  const liczba = buf.readUInt16LE(koniec + 10);
  let p = buf.readUInt32LE(koniec + 16);
  const pliki = {};
  for (let i = 0; i < liczba; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014B50, 'sygnatura wpisu katalogu');
    const metoda = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const rozmSkompr = buf.readUInt32LE(p + 20);
    const rozm = buf.readUInt32LE(p + 24);
    const dlNazwy = buf.readUInt16LE(p + 28);
    const dlExtra = buf.readUInt16LE(p + 30);
    const dlKom = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const nazwa = buf.toString('utf8', p + 46, p + 46 + dlNazwy);
    assert.equal(buf.readUInt32LE(offset), 0x04034B50, `sygnatura nagłówka lokalnego ${nazwa}`);
    const dlNazwyL = buf.readUInt16LE(offset + 26);
    const dlExtraL = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + dlNazwyL + dlExtraL;
    const dane = metoda === 8 ? inflateRawSync(buf.subarray(start, start + rozmSkompr)) : buf.subarray(start, start + rozm);
    assert.equal(dane.length, rozm, `rozmiar ${nazwa}`);
    assert.equal(crc32(dane), crc, `CRC ${nazwa}`);
    pliki[nazwa] = dane.toString('utf8');
    p += 46 + dlNazwy + dlExtra + dlKom;
  }
  return pliki;
}

test('crc32 zgodny z wzorcem (pusty bufor, "123456789")', () => {
  assert.equal(crc32(Buffer.alloc(0)), 0);
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('zip: pliki odczytywalne przez katalog centralny, CRC i rozmiary się zgadzają', () => {
  const zip = zbudujZip([{ nazwa: 'a.txt', dane: Buffer.from('hej') }, { nazwa: 'dir/b.xml', dane: Buffer.from('<x>ąę</x>') }]);
  assert.deepEqual(rozpakuj(zip), { 'a.txt': 'hej', 'dir/b.xml': '<x>ąę</x>' });
});

test('docx: komplet części OOXML, tytuł pogrubiony i wyśrodkowany, każda linia akapitem, pusta linia pustym akapitem', () => {
  const pliki = rozpakuj(zbudujDocx({ nazwa: 'Wniosek o zwrot wadium', tresc: 'Linia 1\n\nLinia 3 z <tagiem> & "cudzysłowem"\r\nLinia 4' }));
  assert.deepEqual(Object.keys(pliki).sort(), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
  const doc = pliki['word/document.xml'];
  assert.match(doc, /^<\?xml version="1.0" encoding="UTF-8" standalone="yes"\?><w:document/);
  assert.match(doc, /<w:p><w:pPr><w:jc w:val="center"\/><\/w:pPr><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Wniosek o zwrot wadium<\/w:t>/);
  const akapity = doc.match(/<w:p(?:>|\/>)/g);
  assert.equal(akapity.length, 2 + 4, 'tytuł + odstęp + 4 linie');
  assert.match(doc, /Linia 3 z &lt;tagiem&gt; &amp; &quot;cudzysłowem&quot;/);
  assert.match(doc, /<w:p\/><w:p><w:r><w:t xml:space="preserve">Linia 3/);
  assert.match(pliki['[Content_Types].xml'], /wordprocessingml\.document\.main\+xml/);
  assert.match(pliki['_rels/.rels'], /Target="word\/document\.xml"/);
  assert.match(pliki['word/styles.xml'], /Calibri/);
});

test('docx bez nazwy i z pustą treścią też jest poprawnym dokumentem (jeden pusty akapit)', () => {
  const pliki = rozpakuj(zbudujDocx({ nazwa: '', tresc: '' }));
  assert.match(pliki['word/document.xml'], /<w:body><w:p\/><w:sectPr>/);
});

test('escXml usuwa znaki sterujące, nazwa pliku bez znaków zakazanych', () => {
  assert.equal(escXml('a\u0000b\u0007c'), 'abc');
  assert.equal(nazwaPlikuDocx('Odpowiedź na wezwanie: art. 128/274 "x"?'), 'Odpowiedź na wezwanie art. 128 274 x.docx');
  assert.equal(nazwaPlikuDocx(''), 'Pismo.docx');
  assert.equal(nazwaPlikuDocx('x'.repeat(200)).length, 80 + '.docx'.length);
});
