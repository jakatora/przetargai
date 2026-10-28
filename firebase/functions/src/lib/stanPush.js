/*
 * STAN DOSTARCZANIA PUSH (2026-10-28). Od co najmniej 20.10 każde powiadomienie kończyło się biletem
 * Expo „InvalidCredentials” (projekt Expo bez klucza FCM v1 / APNs) — 60 z 60 prób — a nikt tego nie
 * widział, bo błąd był tylko w logach. Teraz `sendPush` zapisuje ślad (`_health/push`), a `/health`
 * pokazuje blok `push`. Informacyjny: NIE zapala 503 (aplikacja też odpytuje `/health`, a brak pushy
 * nie psuje feedu), ale `push.ok = false` jest widoczne od pierwszej nieudanej próby.
 *
 * „Nasz” błąd = każdy kod biletu poza DeviceNotRegistered (martwy token to stan telefonu użytkownika,
 * sprzątany automatycznie) i poza PushWylaczonyLokalnie (emulator).
 */
export const BLEDY_NIE_NASZE = new Set(['DeviceNotRegistered', 'PushWylaczonyLokalnie']);

/** Z wyniku `sendPush` → pola do zapisania; null, gdy nie było czego wysyłać. */
export function sladWysylki(wynik, teraz) {
  const sent = Number(wynik?.sent ?? 0);
  const failed = Number(wynik?.failed ?? 0);
  if (sent + failed === 0) return null;
  const bledy = wynik?.bledy && typeof wynik.bledy === 'object' ? wynik.bledy : {};
  const nasze = Object.keys(bledy).filter((k) => !BLEDY_NIE_NASZE.has(k));
  // Emulator (features.push=false) nie jest próbą dostarczenia — nie zostawia śladu.
  if (sent === 0 && Object.keys(bledy).length && Object.keys(bledy).every((k) => k === 'PushWylaczonyLokalnie')) return null;
  const slad = { ostatnia_proba_o: teraz, ostatni_wynik: { sent, failed, bledy } };
  if (sent > 0) slad.ostatni_sukces_o = teraz;
  // Błąd po naszej stronie (klucz, limit, HTTP) — także gdy Expo nie zwróciło kodu biletu.
  if (nasze.length || (failed > 0 && !Object.keys(bledy).length)) {
    slad.ostatni_blad_o = teraz;
    slad.ostatni_blad = nasze[0] ?? 'Nieznany';
  }
  return slad;
}

/**
 * Ocena do `/health`: `null` = brak prób (świeży projekt / emulator), `false` = ostatni błąd po naszej
 * stronie jest nowszy niż ostatni dostarczony push, `true` w pozostałych przypadkach.
 */
export function ocenStanPush(stan) {
  if (!stan?.ostatnia_proba_o) return null;
  const blad = Date.parse(stan.ostatni_blad_o ?? '');
  if (!Number.isFinite(blad)) return true;
  const sukces = Date.parse(stan.ostatni_sukces_o ?? '');
  return Number.isFinite(sukces) && sukces >= blad;
}
