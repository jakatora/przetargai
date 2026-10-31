/* Pomocnik testów kontroli plików oferty (nie jest plikiem testów). */
/** Minimalny PDF z warstwą tekstową (linia pod linią); `podpis` dokłada słownik PAdES jak po podpisaniu. */
export function pdfZLiniami(linie, { podpis = false } = {}) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const tresc = `BT /F1 11 Tf 40 800 Td 14 TL ${linie.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(tresc, 'latin1')} >>\nstream\n${tresc}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  if (podpis) objs.push('<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 100 200 300] /Contents <00> >>');
  let pdf = '%PDF-1.4\n';
  const off = [];
  objs.forEach((b, i) => { off.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
