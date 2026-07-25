/**
 * Ekstrakcja i normalizacja tekstu UMOWY pod analizę (ulepszenie „pilnowanie
 * waloryzacji i pułapek w umowie"). Klient wysyła treść jako surowy `tekst`
 * albo `pdf_base64` (plik PDF w base64) — ta warstwa sprowadza jedno i drugie
 * do jednego, znormalizowanego łańcucha, którym karmiony jest silnik reguł.
 *
 * DLACZEGO OSOBNA NORMALIZACJA (a nie `textNorm.normalize`): tamta jest pod
 * dopasowanie słów kluczowych — lowercase'uje i zdziera diakrytyki, więc
 * niszczy treść umowy. Tu robimy odwrotnie: zachowujemy wielkość liter i polskie
 * znaki (silnik reguł i prezentacja „po ludzku" ich potrzebują), a tniemy tylko
 * to, co PDF/kopiowanie wprowadza jako szum: zdublowane spacje, złamania wierszy,
 * twarde/zerowe spacje, słowa przełamane myślnikiem na końcu wiersza.
 */

// Znaki niewidoczne, które trzeba USUNĄĆ (nie zamienić na spację): miękki dywiz
// (U+00AD), zero-width space (U+200B) oraz BOM / zero-width no-break (U+FEFF).
const NIEWIDOCZNE = /[\u00AD\u200B\uFEFF]/g;

/**
 * Normalizuje surowy tekst: ujednolica białe znaki i usuwa szum kopiowania.
 * Czysta i synchroniczna. Zwraca płaski, pojedynczo-spacjowany łańcuch —
 * łamania wierszy z PDF-a bywają przypadkowe (środek zdania), a silnik reguł
 * i tak szuka fraz niezależnie od układu, więc spłaszczenie jest najpewniejsze.
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function normalizujTekst(raw) {
  if (raw == null) return '';
  return String(raw)
    .normalize('NFC')                                          // ujednolić formy Unicode
    .replace(/\r\n?/g, '\n')                                   // CRLF/CR -> LF
    .replace(NIEWIDOCZNE, '')                                  // miękki dywiz, zero-width, BOM
    .replace(/([\p{Ll}])-[ \t]*\n[ \t]*([\p{Ll}])/gu, '$1$2')  // sło-\nwo -> słowo
    .replace(/\s+/g, ' ')                                      // zbędne spacje/łamania -> spacja
    .trim();
}

/**
 * Best-effort ekstrakcja surowego tekstu z PDF-a (base64). Zwraca tekst BEZ
 * normalizacji (tym zajmuje się `normalizujTekst`). Nie rzuca w górę: uszkodzony,
 * pusty albo zeskanowany (bez warstwy tekstowej) PDF => pusty łańcuch, bo „brak
 * tekstu" to poprawny wynik analizy, a nie błąd 500. OCR skanów jest poza
 * zakresem tego podzadania.
 *
 * pdfjs ładujemy leniwie (dynamiczny import) — żądania z samym `tekst` nie płacą
 * za wczytanie ciężkiego modułu, a start aplikacji zostaje lekki.
 * @param {string} pdfBase64 zawartość PDF w base64 (opcjonalnie z prefiksem data-URL)
 * @returns {Promise<string>}
 */
export async function ekstrahujZPdf(pdfBase64) {
  if (typeof pdfBase64 !== 'string' || !pdfBase64.trim()) return '';
  const b64 = pdfBase64.replace(/^data:[^;]*;base64,/, '').trim();
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return '';

  let loadingTask;
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    loadingTask = getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false, // nie odpalaj eval na treści z zewnątrz
      verbosity: 0,           // tylko błędy — cisza dla ostrzeżeń o fontach standardowych
    });
    const doc = await loadingTask.promise;

    let out = '';
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      // hasEOL na elemencie = koniec wiersza; poza tym rozdzielamy spacją.
      // Ewentualne zdublowania i tak zwinie normalizacja.
      out += tc.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : ' ')).join('');
      out += '\n';
    }
    return out;
  } catch {
    return '';
  } finally {
    // Sprzątanie workera pdfjs — best-effort. NIE w bloku zwracającym `out`,
    // żeby ewentualny błąd teardownu nie skasował już wyekstrahowanego tekstu.
    try { await loadingTask?.destroy(); } catch { /* ignore */ }
  }
}

/**
 * Wejście endpointu analizy umowy => jeden znormalizowany łańcuch tekstu.
 * `tekst` ma priorytet, gdy niesie treść; w przeciwnym razie próbujemy PDF-a.
 * @param {{ tekst?: string, pdf_base64?: string }} [wejscie]
 * @returns {Promise<string>}
 */
export async function ekstrahuj_i_normalizuj(wejscie = {}) {
  const tekst = wejscie?.tekst;
  if (typeof tekst === 'string' && tekst.trim()) {
    return normalizujTekst(tekst);
  }
  const pdf = wejscie?.pdf_base64;
  if (typeof pdf === 'string' && pdf.trim()) {
    return normalizujTekst(await ekstrahujZPdf(pdf));
  }
  return '';
}
