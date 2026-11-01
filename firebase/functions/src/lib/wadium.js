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

/**
 * Wadium z TREŚCI SWZ (2026-11-01) — dla platformazakupowa.pl, której lista i szczegół wadium nie podają.
 * „Zamawiający wymaga wniesienia wadium w wysokości 5 000,00 zł”, „Wadium wynosi 20 000,00 PLN”, „…w wysokości:
 * 1 500,00 ( słownie … ) PLN”, „nie wymaga wniesienia / składania wadium”. Kwota: z walutą albo z groszami, bez
 * „00/100” ze słownego zapisu. Przy częściach kilka kwot — pierwsza + `wieleCzesci`, jak w BZP. Nic pewnego →
 * `wymagane: null` (nie wiemy). Zmierzone na 14 SWZ z platformy (1.11): 13 rozpoznanych, kwoty zgodne z treścią.
 * @param {string[]|string} linie tekst SWZ
 */
const NIE_WYMAGA = /nie\s+wymaga\s+(?:od\s+wykonawc\S*\s+)?(?:wniesienia|złożenia|składania|wnoszenia)?\s*wadium|wadium\s+nie\s+jest\s+wymagane|nie\s+jest\s+zabezpieczon\S*\s+wadium|nie\s+przewiduje\s+(?:obowiązku\s+)?(?:wniesienia\s+)?wadium|odstępuje\s+od\s+(?:żądania\s+)?wadium/i;
const WYMAGA = /wymaga\s+(?:od\s+wykonawc\S*\s+)?(?:wniesienia|złożenia|składania|wnoszenia)\s+wadium|wadium\s+w\s+(?:wysoko\S+|kwocie)|wadium\s+wynosi|zabezpieczon\S*\s+wadium|zabezpieczenia\s+(?:swojej\s+)?oferty\s+wadium|wnieść\s+wadium/i;
const KWOTA_WADIUM = /(?<![\d/])(\d{1,3}(?:[\s.]?\d{3})*|\d+)(,\d{2})?(?![\d/])\s*(zł|PLN|złotych)?/gi;

export function parsujWadiumSwz(linie) {
  const tekst = (Array.isArray(linie) ? linie.join(' ') : String(linie ?? '')).replace(/\s+/g, ' ').replace(/(\d)\s+,(\d{2})\b/g, '$1,$2');
  const nie = [...tekst.matchAll(new RegExp(NIE_WYMAGA.source, 'gi'))];
  // „nie wymaga wniesienia wadium” zawiera „wymaga wniesienia wadium” — takie trafienie nie jest wymogiem.
  // Spis treści („WYMAGANIA DOTYCZĄCE WADIUM ..... 29”) nie jest zdaniem — liczy się zdanie z czasownikiem.
  const tak = [...tekst.matchAll(new RegExp(WYMAGA.source, 'gi'))]
    .filter((m) => !nie.some((n) => m.index >= n.index && m.index < n.index + n[0].length));
  // Oba naraz (części z wadium i bez, albo wzór umowy obok wymogu): nie zgadujemy. Pominięte wadium odrzuca ofertę,
  // więc „nie wymaga” podajemy tylko przy braku jakiegokolwiek wymogu w treści.
  if (nie.length && tak.length) return { wymagane: null, kwota: null, sprzeczne: true };
  if (nie.length) return { wymagane: false, kwota: null };
  const m = tak[0];
  if (!m) return { wymagane: null, kwota: null };
  const okno = tekst.slice(m.index, m.index + OKNO_ZNAKOW);
  const kwoty = [...okno.matchAll(KWOTA_WADIUM)]
    .filter((k) => k[2] || k[3])
    .map((k) => liczbaZeStringu(k[1]))
    .filter((k) => k && k >= 100);
  if (!kwoty.length) return { wymagane: true, kwota: null, wieleCzesci: false };
  return { wymagane: true, kwota: kwoty[0], wieleCzesci: new Set(kwoty).size > 1 };
}
