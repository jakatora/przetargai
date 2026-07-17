/**
 * Parser wadium z `htmlBody` ogłoszenia BZP — czysta logika.
 *
 * Wadium to najgroźniejszy „twardy próg" w przetargu: jeśli nie wpłynie na konto
 * zamawiającego PRZED terminem składania ofert, oferta jest odrzucana i NIE podlega
 * uzupełnieniu. Kwota siedzi w `htmlBody` (który i tak parsujemy przy ingestii,
 * zanim go odrzucimy — services/bzp.js).
 *
 * Format zmierzony na żywo (2026-07-16) — nie zgadywany:
 *   „6.4.) Zamawiający wymaga wadium: Tak|Nie"
 *   przy „Tak": „6.4.1) Informacje dotyczące wadium: … w wysokości 7 800,00 zł …"
 *   dla zamówień na części: kilka kwot („ZADANIE nr I – 8 000 zł, …").
 */

/** Okno tekstu po wzmiance o wadium — dalej w dokumencie są inne kwoty (umowa, kary). */
const OKNO_ZNAKOW = 700;

function liczbaZeStringu(surowy) {
  // „7 800” / „7 800,00” / „15 000” → 7800 / 15000. Spacje i nbsp = separatory tysięcy.
  const n = Number(String(surowy).replace(/[\s .]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {string} htmlBody surowy HTML ogłoszenia
 * @returns {{wymagane: boolean|null, kwota: number|null, wieleCzesci?: boolean}}
 *   wymagane=null → w ogłoszeniu nie ma o tym mowy (nie wiemy).
 *   wymagane=true, kwota=null → wymagane, ale kwoty nie dało się odczytać (nie zmyślamy).
 */
export function parsujWadium(htmlBody) {
  const tekst = String(htmlBody ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = tekst.match(/wymaga wadium:\s*(Tak|Nie)/i);
  if (!m) return { wymagane: null, kwota: null };
  if (/nie/i.test(m[1])) return { wymagane: false, kwota: null };

  const okno = tekst.slice(m.index, m.index + OKNO_ZNAKOW);
  const kwoty = [...okno.matchAll(/(\d[\d\s .]{2,}?)(?:,\d{2})?\s*(?:zł|PLN)/gi)]
    .map((k) => liczbaZeStringu(k[1]))
    .filter(Boolean);

  if (!kwoty.length) return { wymagane: true, kwota: null, wieleCzesci: false };
  return { wymagane: true, kwota: kwoty[0], wieleCzesci: kwoty.length > 1 };
}
