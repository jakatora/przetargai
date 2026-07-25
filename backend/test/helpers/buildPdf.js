/**
 * Buduje minimalny, poprawny PDF (z tablicą xref) z jednym napisem pokazanym
 * operatorem Tj i standardowym fontem Helvetica/WinAnsi — realistyczny „cyfrowy"
 * PDF z warstwą tekstową (nie skan). Zwraca zawartość w base64, gotową zarówno
 * do `ekstrahujZPdf`, jak i do wysłania w polu `pdf_base64` żądania.
 *
 * Współdzielony przez testy util (umowaEkstrakcja) i endpointu (przetargUmowa),
 * żeby nie duplikować konstrukcji PDF-a w dwóch miejscach.
 * @param {string} text treść do umieszczenia na jedynej stronie
 * @returns {string} PDF zakodowany w base64
 */
export function budujPdf(text) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  ];
  const content = `BT /F1 18 Tf 72 700 Td (${esc(text)}) Tj ET`;
  objs.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += `${String(off).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1').toString('base64');
}
