/*
 * „JEST NOWA WERSJA" (2026-10-25) — dla instalacji poza sklepami: APK ze strony i wersja
 * Windows nie aktualizują się same, a leniwy użytkownik nie zagląda na stronę pobierania.
 * Strona `https://przetarg-ai.pl/wersja.json` (publikowana z `landing/wersja.json`, pilnowana
 * testem `landingStrona` = wersja z `app.json`) mówi, co jest najnowsze; tu czysta decyzja,
 * czy i co pokazać. Sklepy (iOS zawsze, Android z Google Play) mają własne aktualizacje —
 * na iOS nic nie pokazujemy, na Androidzie wskazujemy obie drogi.
 */
export const KLUCZ_ODLOZONEJ_AKTUALIZACJI = 'przetargai.aktualizacja_odlozona';
export const ADRES_WERSJI = 'https://przetarg-ai.pl/wersja.json';
export const ADRES_POBIERANIA = 'https://przetarg-ai.pl/pobierz';

/** Porównanie wersji „a.b.c" (brakujące człony = 0); śmieci traktowane jak 0.0.0. */
export function porownajWersje(a, b) {
  const czlony = (w) => String(w ?? '').split('.').map((x) => Number.parseInt(x, 10) || 0);
  const A = czlony(a); const B = czlony(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? 0; const y = B[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

const WZORZEC_WERSJI = /^\d+(\.\d+){0,3}$/;

/**
 * @param {{biezaca: string, najnowsza: string|null|undefined, platforma: string, odlozona?: string|null}} w
 * @returns {{pokaz: boolean, najnowsza: string|null, url: string, komunikat: {pl: string, en: string}}}
 */
export function decyzjaAktualizacji({ biezaca, najnowsza, platforma, odlozona = null } = {}) {
  const nic = { pokaz: false, najnowsza: null, url: ADRES_POBIERANIA, komunikat: { pl: '', en: '' } };
  if (typeof najnowsza !== 'string' || !WZORZEC_WERSJI.test(najnowsza.trim())) return nic;
  const nowa = najnowsza.trim();
  if (!WZORZEC_WERSJI.test(String(biezaca ?? '').trim())) return nic;
  if (porownajWersje(nowa, biezaca) <= 0) return nic;
  if (platforma !== 'web' && platforma !== 'android') return nic;
  if (odlozona === nowa) return nic;
  const komunikat = platforma === 'web'
    ? { pl: `Jest nowa wersja PrzetargAI ${nowa} (masz ${biezaca}). Dotknij, aby pobrać ze strony.`,
      en: `PrzetargAI ${nowa} is available (you have ${biezaca}). Tap to download from the website.` }
    : { pl: `Jest nowa wersja PrzetargAI ${nowa} (masz ${biezaca}). Zaktualizuj w Google Play albo pobierz APK ze strony.`,
      en: `PrzetargAI ${nowa} is available (you have ${biezaca}). Update in Google Play or download the APK from the website.` };
  return { pokaz: true, najnowsza: nowa, url: ADRES_POBIERANIA, komunikat };
}

/** Wersja z odpowiedzi `wersja.json` albo null (śmieci, brak pola). */
export function wersjaZOdpowiedzi(json) {
  const w = json && typeof json === 'object' ? json.wersja : null;
  return typeof w === 'string' && WZORZEC_WERSJI.test(w.trim()) ? w.trim() : null;
}
