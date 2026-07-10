import { matchKeywords } from './textNorm.js';
import { cpvAffinity, parseCpvCodes } from './cpv.js';

/**
 * Heurystyczny scoring dopasowania przetargu do profilu firmy.
 * Czysta funkcja — używana jako pre-filtr przed AI oraz jako fallback,
 * gdy AI jest niedostępne. Testowalna w izolacji.
 *
 * Naprawy względem pierwszej wersji (audyty na 500 realnych ogłoszeniach):
 *
 *  P-1  Kody CPV. BZP zwraca sklejony łańcuch wszystkich kodów przetargu.
 *       Stara wersja robiła replace(/\D/g,'') na CAŁOŚCI i porównywała prefiks
 *       tylko z początkiem tego ciągu — widziała wyłącznie pierwszy kod.
 *       Firma z CPV 45233000 dostawała 0 punktów za przetarg, który jawnie
 *       zawierał 45233222 (chodniki). Rozpoznawane 49/95 → teraz wszystkie.
 *
 *  P-2  Słowa kluczowe. `haystack.includes(kw)` gubiło odmiany ("droga" nie jest
 *       podciągiem "drogi" — 91% przetargów drogowych) i jednocześnie wpuszczało
 *       fałszywki ("budowa" JEST podciągiem "Przebudowa"). Porównujemy rdzenie słów.
 *
 *  P-5  Normalizacja przez liczbę słów profilu (audyt 2026-07-09). Wynik liczył się
 *       jako `trafione / WSZYSTKIE słowa × 100`, więc każde dopisane słowo kluczowe
 *       obniżało wynik wszystkich przetargów: 1 słowo → 100, 5 słów → 20. Użytkownik,
 *       który dokładniej opisał, czym się zajmuje, dostawał PUSTSZY feed (przy 8 słowach
 *       pojedyncze trafienie dawało 12 pkt — poniżej progu pre-filtra AI). Liczy się
 *       teraz LICZBA TRAFIEŃ z nasyceniem, a nietrafione słowa nie karzą.
 *       Zmierzone na 500 realnych ogłoszeniach: profil drogowca (8 słów + CPV)
 *       miał 1 dopasowanie ≥60, ma 88; profil oparty tylko na CPV: 0 → 20.
 *
 *  P-6  Profil bez słów kluczowych, oparty tylko na kodach CPV, nie mógł przekroczyć
 *       progu dopasowania (60): stała premia +30 to za mało. Dokładny kod CPV jest
 *       mocnym sygnałem i dziś sam w sobie wystarcza; luźna zgodność działu — nie.
 */

/**
 * Podstawa nasycenia trafień słów kluczowych: 1 trafienie → 62 pkt,
 * 2 → 86, 3 → 95. Rosnąco, ale bez udawania pewności.
 *
 * Skalibrowane na 500 realnych ogłoszeniach z BZP (2026-07-09). Dobór wartości:
 * przy 0.40 pojedyncze trafienie dawałoby dokładnie 60 — czyli próg dopasowania
 * bez marginesu na zaokrąglenie. Przy 0.38 to 62, a liczba dopasowań się nie
 * zmienia (profil drogowca: 88, brukarza: 18 — bez fałszywek strukturalnych).
 * Pojedyncze trafienie rdzenia w TYTULE jest mocnym sygnałem, bo `matchKeywords`
 * odsiewa już „budowa" w „Przebudowa" (regresja U-4).
 */
const KEYWORD_DECAY = 0.38;

/**
 * Waga sygnału CPV przy pełnej zgodności (afiniczność 1.0). Powyżej progu
 * dopasowania (60) — dokładny kod CPV to twarda deklaracja przedmiotu zamówienia.
 * Luźniejsza zgodność skaluje się proporcjonalnie: dział „45" (affinity 0.35)
 * daje ~25 pkt, czyli wpuszcza do oceny AI, ale sam nie tworzy dopasowania.
 */
const CPV_WEIGHT = 70;

/**
 * Zwraca wynik 0–100, listę trafionych słów kluczowych oraz stopień zgodności CPV.
 *
 * Sygnały łączą się probabilistycznie (`1 − (1−a)(1−b)`), nie przez dodawanie:
 * dwa niezależne, słabe poszlaki wzmacniają się, ale żadna pojedyncza nie może
 * przestrzelić skali, a suma nigdy nie wychodzi poza 100 bez sztucznego przycinania.
 *
 * @param {{keywords?: string[], cpv_codes?: string[]}} company
 * @param {{title?: string, organization?: string, cpv_main?: string, cpvMain?: string}} tender
 * @returns {{score: number, matchedKeywords: string[], cpvMatched: boolean, cpvAffinity: number}}
 */
export function heuristicScore(company, tender) {
  const keywords = company.keywords ?? [];

  // Wyłącznie przedmiot zamówienia. Nazwa zamawiającego jest osobnym sygnałem
  // i nie może udawać słowa kluczowego: „Zarząd Dróg Powiatowych” kupuje też
  // pługi odśnieżne i windy, a brukarz nie ma tam czego szukać.
  const matchedKeywords = matchKeywords(keywords, tender.title ?? '');
  const keywordSignal = matchedKeywords.length
    ? 1 - KEYWORD_DECAY ** matchedKeywords.length
    : 0;

  // Wszystkie kody przetargu, nie tylko pierwszy.
  const tenderCodes = parseCpvCodes(tender.cpv_main ?? tender.cpvMain);
  const affinity = cpvAffinity(company.cpv_codes ?? [], tenderCodes);
  const cpvSignal = (CPV_WEIGHT / 100) * affinity;

  const combined = 1 - (1 - keywordSignal) * (1 - cpvSignal);

  return {
    score: Math.max(0, Math.min(100, Math.round(combined * 100))),
    matchedKeywords,
    cpvMatched: affinity > 0,
    // Stopień (0..1), nie tylko flaga — wejście dla ważonego scoringu.
    cpvAffinity: affinity,
  };
}
