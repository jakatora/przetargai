/**
 * WSPÓLNE, CZYSTE helpery mapowania dla adapterów platform zakupowych i BIP
 * (ulepszenie „Radar zamówień podprogowych — poniżej 170 tys. zł", podzadanie 4/7).
 * Bez I/O — tylko deterministyczne transformacje tekstu/HTML/JSON.
 *
 * Dlaczego własny mini-parser HTML zamiast biblioteki: repo NIE ma w zależnościach
 * parsera DOM (cheerio itp.), a zakaz płatnego API/rozdmuchiwania stacku nakazuje
 * nie dokładać ciężkich paczek pod jedno podzadanie. Adaptery HTML (platformazakupowa,
 * e-propublico) są więc marker-/nagłówek-sterowane (zdejmij tagi, wyłap kotwice i
 * etykiety), a nie oparte o pełne drzewo DOM — spójnie z defensywnym stylem
 * services/bzp.js/bzpWyniki.js. Dokładny układ znaczników każdego źródła należy
 * potwierdzić na żywo przy wpięciu w monitor (podzadanie 6/7); transport jest
 * wstrzykiwalny, więc mapowanie testujemy na wiernych fixture'ach bez sieci.
 *
 * Adapter Bazy Konkurencyjności (podzadanie 3/7) ma własne, lokalne kopie części z
 * tych helperów — świadomie ich tu NIE refaktoruję: ten commit jest ADDYTYWNY i nie
 * dotyka zacommitowanego 3/7 (ani jego 21 testów). Ewentualne ujednolicenie później.
 */

/** Trim + zwinięcie białych znaków; null dla pustych. */
export function tekst(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

const ENCJE = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Dekoduje najczęstsze encje HTML (nazwane + numeryczne dec/hex). */
export function dekodujEncje(s) {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; } })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, n) => ENCJE[n.toLowerCase()] ?? _);
}

/** Zdejmuje tagi HTML, dekoduje encje i zwija spacje; null dla pustych. */
export function bezTagow(v) {
  if (v === undefined || v === null) return null;
  const s = Array.isArray(v) ? v.join(' ') : String(v);
  return tekst(dekodujEncje(s.replace(/<[^>]*>/g, ' ')));
}

/**
 * Normalizacja do porównań/dopasowań nagłówków: małe litery, bez diakrytyków
 * (w tym „ł"), zwinięte białe znaki. (Spójna z lib/normalizacjaPodprogowe.js.)
 */
export function znorm(v) {
  if (v === undefined || v === null) return '';
  return String(v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Pierwsza nie-pusta wartość spośród podanych kluczy obiektu (jak w normalizacji). */
export function pierwsza(obj, ...klucze) {
  for (const k of klucze) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

/**
 * Parsuje kwotę w formacie PL („150 000,00 zł" / „150000,00" / „150.000,00" / liczba)
 * → number|null. (Ta sama logika co parseKwota w normalizacji i parseKwotaPL w BK.)
 */
export function parseKwotaPL(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,-]/g, '');
  if (s === '' || s === '-') return null;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Data do ISO. Obsługuje formaty spotykane na platformach/BIP:
 *   „05-08-2026 12:00:00" / „05.08.2026 12:00" (DD-MM-YYYY) → „2026-08-05T12:00:00"
 *   „2026-08-05 12:00:00" / „2026-08-05T12:00:00" (ISO)     → „2026-08-05T12:00:00"
 *   sama data („05.08.2026" / „2026-08-05")                 → „YYYY-MM-DD"
 * Nierozpoznane → zwraca oczyszczony tekst bez zmian (nie zgaduje).
 */
export function isoData(v) {
  const s = tekst(v);
  if (!s) return null;
  // DD-MM-YYYY / DD.MM.YYYY / DD/MM/YYYY z opcjonalną godziną
  let m = /^(\d{2})[.\-/](\d{2})[.\-/](\d{4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(s);
  if (m) {
    const data = `${m[3]}-${m[2]}-${m[1]}`;
    return m[4] ? `${data}T${m[4]}` : data;
  }
  // YYYY-MM-DD z opcjonalną godziną (ISO lub „ " zamiast „T")
  m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(s);
  if (m) return m[2] ? `${m[1]}T${m[2]}` : m[1];
  return s;
}

/** Buduje URL bezwzględny z bazy + (względnej/bezwzględnej) ścieżki; null dla pustych. */
export function absolutnyUrl(base, u) {
  const s = tekst(u);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const b = String(base ?? '').replace(/\/+$/, '');
  return `${b}${s.startsWith('/') ? '' : '/'}${s}`;
}

/**
 * Wyłuskuje identyfikator ogłoszenia z URL-a: najpierw z parametru zapytania
 * (`iPrzetargId=…`, `id=…`), a w razie braku — z ostatniego segmentu ścieżki.
 * @param {string} url
 * @param {string[]} [parametry] nazwy parametrów zapytania do sprawdzenia (kolejno)
 * @returns {string|null}
 */
export function idZUrl(url, parametry = ['iPrzetargId', 'przetargId', 'idPostepowania', 'id']) {
  const s = tekst(url);
  if (!s) return null;
  for (const p of parametry) {
    const m = new RegExp(`[?&]${p}=([^&#]+)`, 'i').exec(s);
    if (m) return decodeURIComponent(m[1]);
  }
  const segment = s.split(/[?#]/)[0].split('/').filter(Boolean).pop();
  return segment && /[\w-]/.test(segment) ? segment : null;
}
