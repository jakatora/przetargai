/*
 * Linie tekstu z PDF-a (kontrola plików oferty, 2026-10-31). pdfjs ładowany leniwie — trasy bez PDF-ów
 * i zimny start API nie płacą za ciężki moduł. Ten sam sposób łączenia elementów co backend Railway
 * (`umowaEkstrakcja.js`): koniec wiersza z `hasEOL`, inaczej spacja. Skan bez warstwy tekstowej → [].
 */
export const MAKS_STRON_PDF = 150;

export async function liniePdf(buf, { maksStron = MAKS_STRON_PDF } = {}) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const zadanie = getDocument({ data: new Uint8Array(buf), isEvalSupported: false, verbosity: 0 });
  try {
    const doc = await zadanie.promise;
    const linie = [];
    for (let p = 1; p <= Math.min(doc.numPages, maksStron); p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      const tekst = tc.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : ' ')).join('');
      for (const l of tekst.split('\n')) if (l.trim()) linie.push(l.replace(/\s+/g, ' ').trim());
    }
    return linie;
  } finally {
    try { await zadanie.destroy(); } catch { /* sprzątanie best-effort */ }
  }
}
