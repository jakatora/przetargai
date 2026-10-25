import { deflateRawSync } from 'node:zlib';

/*
 * PISMO JAKO PLIK WORD (.docx) — bez zależności (2026-10-25). Wykonawca podpisuje pisma
 * kwalifikowanym podpisem na komputerze, a Word to format, którego oczekuje platforma
 * zakupowa i zamawiający. Dotąd pisma szły jako tekst do schowka/e-maila — tu składamy
 * prawdziwy .docx: archiwum ZIP z minimalnym WordprocessingML (każda linia tekstu to akapit,
 * pusta linia to pusty akapit). Czysta funkcja: Buffer wejścia → Buffer wyjścia, testowalna
 * bez sieci. Własny zapis ZIP (CRC-32 + deflate), bo Functions nie mają biblioteki zip.
 */

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Data/czas MS-DOS dla nagłówków ZIP (Word nie czyta, ale pole musi być poprawne). */
function czasDos(d) {
  const czas = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const data = (((d.getUTCFullYear() - 1980) & 0x7F) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { czas, data };
}

/**
 * Archiwum ZIP z listy plików (metoda deflate). Pierwszy wpis `[Content_Types].xml`
 * to konwencja OOXML — czytniki tego nie wymagają, ale Word tak zapisuje.
 * @param {{nazwa: string, dane: Buffer}[]} pliki
 * @param {Date} [teraz]
 */
export function zbudujZip(pliki, teraz = new Date(0)) {
  const { czas, data } = czasDos(teraz);
  const lokalne = [];
  const centralne = [];
  let offset = 0;
  for (const { nazwa, dane } of pliki) {
    const nazwaBuf = Buffer.from(nazwa, 'utf8');
    const skompresowane = deflateRawSync(dane);
    const crc = crc32(dane);
    const naglowek = Buffer.alloc(30);
    naglowek.writeUInt32LE(0x04034B50, 0);
    naglowek.writeUInt16LE(20, 4); // wersja 2.0
    naglowek.writeUInt16LE(0x0800, 6); // nazwy w UTF-8
    naglowek.writeUInt16LE(8, 8); // deflate
    naglowek.writeUInt16LE(czas, 10);
    naglowek.writeUInt16LE(data, 12);
    naglowek.writeUInt32LE(crc, 14);
    naglowek.writeUInt32LE(skompresowane.length, 18);
    naglowek.writeUInt32LE(dane.length, 22);
    naglowek.writeUInt16LE(nazwaBuf.length, 26);
    naglowek.writeUInt16LE(0, 28);
    lokalne.push(naglowek, nazwaBuf, skompresowane);

    const wpis = Buffer.alloc(46);
    wpis.writeUInt32LE(0x02014B50, 0);
    wpis.writeUInt16LE(20, 4);
    wpis.writeUInt16LE(20, 6);
    wpis.writeUInt16LE(0x0800, 8);
    wpis.writeUInt16LE(8, 10);
    wpis.writeUInt16LE(czas, 12);
    wpis.writeUInt16LE(data, 14);
    wpis.writeUInt32LE(crc, 16);
    wpis.writeUInt32LE(skompresowane.length, 20);
    wpis.writeUInt32LE(dane.length, 24);
    wpis.writeUInt16LE(nazwaBuf.length, 28);
    wpis.writeUInt16LE(0, 30); // extra
    wpis.writeUInt16LE(0, 32); // komentarz
    wpis.writeUInt16LE(0, 34); // dysk
    wpis.writeUInt16LE(0, 36); // atrybuty wewn.
    wpis.writeUInt32LE(0, 38); // atrybuty zewn.
    wpis.writeUInt32LE(offset, 42);
    centralne.push(wpis, nazwaBuf);
    offset += naglowek.length + nazwaBuf.length + skompresowane.length;
  }
  const katalog = Buffer.concat(centralne);
  const koniec = Buffer.alloc(22);
  koniec.writeUInt32LE(0x06054B50, 0);
  koniec.writeUInt16LE(0, 4);
  koniec.writeUInt16LE(0, 6);
  koniec.writeUInt16LE(pliki.length, 8);
  koniec.writeUInt16LE(pliki.length, 10);
  koniec.writeUInt32LE(katalog.length, 12);
  koniec.writeUInt32LE(offset, 16);
  koniec.writeUInt16LE(0, 20);
  return Buffer.concat([...lokalne, katalog, koniec]);
}

/** Znaki specjalne XML + znaki sterujące, których WordprocessingML nie przyjmuje. */
export function escXml(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const akapit = (linia, { pogrubienie = false, srodek = false } = {}) => {
  const tekst = String(linia).replace(/\t/g, '    ');
  if (!tekst.trim()) return '<w:p/>';
  const wlasciwosciAkapitu = srodek ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : '';
  const wlasciwosciRunu = pogrubienie ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p>${wlasciwosciAkapitu}<w:r>${wlasciwosciRunu}<w:t xml:space="preserve">${escXml(tekst)}</w:t></w:r></w:p>`;
};

/** Nazwa pliku z nazwy pisma: bez znaków zakazanych w systemach plików, z rozszerzeniem .docx. */
export function nazwaPlikuDocx(nazwa) {
  const rdzen = String(nazwa ?? 'Pismo').replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Pismo';
  return `${rdzen}.docx`;
}

/**
 * Buduje .docx z pisma. Tytuł (nazwa pisma) idzie pogrubiony i wyśrodkowany jako pierwszy
 * akapit, potem treść linia po linii. Czcionka Calibri 11 (domyślna Worda), A4, marginesy 2,5 cm.
 * @param {{nazwa: string, tresc: string, teraz?: Date}} pismo
 * @returns {Buffer}
 */
export function zbudujDocx({ nazwa, tresc, teraz = new Date(0) } = {}) {
  const linie = String(tresc ?? '').replace(/\r\n?/g, '\n').split('\n');
  const tytul = String(nazwa ?? '').trim();
  const cialo = [
    ...(tytul ? [akapit(tytul, { pogrubienie: true, srodek: true }), '<w:p/>'] : []),
    ...linie.map((l) => akapit(l)),
  ].join('');
  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${cialo}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>`
    + '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
    + '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pl-PL"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '</w:styles>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';
  const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>';
  return zbudujZip([
    { nazwa: '[Content_Types].xml', dane: Buffer.from(contentTypes, 'utf8') },
    { nazwa: '_rels/.rels', dane: Buffer.from(rels, 'utf8') },
    { nazwa: 'word/document.xml', dane: Buffer.from(document, 'utf8') },
    { nazwa: 'word/_rels/document.xml.rels', dane: Buffer.from(documentRels, 'utf8') },
    { nazwa: 'word/styles.xml', dane: Buffer.from(styles, 'utf8') },
  ], teraz);
}

export const TYP_MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
