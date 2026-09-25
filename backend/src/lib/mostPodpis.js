import crypto from 'node:crypto';

/*
 * Konta pomostowe mostu Firebase → Railway (2026-09-25).
 *
 * Most (firebase/functions/src/services/mostRailway.js) zakłada konto techniczne przez
 * publiczne /auth/register na adresie `most.<uid>@<MOST_EMAIL_DOMENA>`. Bez podpisu
 * każdy mógł zarejestrować CUDZY adres pomostowy z własnym hasłem, zanim zrobi to most —
 * most dostawał wtedy 409, logowanie wyprowadzonym hasłem padało, a moduły /api/przetarg
 * były dla tej osoby martwe (i to atakujący trzymał konto). Podpis = HMAC-SHA256 kluczem
 * JWT_SECRET (wspólny sekret obu backendów) z adresu po trim + lowercase, w hex.
 *
 * Kanoniczna postać to małe litery (tak adres trafia do bazy). UID Firebase ma wielkie
 * litery, więc tolerujemy też podpis z adresu w postaci dokładnie takiej, jak przyszedł
 * w żądaniu — oba warianty wymagają znajomości sekretu, a most nie musi zgadywać
 * normalizacji.
 */

/** Adres w domenie technicznej mostu? (porównanie bez wielkości liter). */
export function jestAdresemMostu(email, domena) {
  if (!domena) return false;
  return String(email ?? '').trim().toLowerCase().endsWith(`@${String(domena).trim().toLowerCase()}`);
}

/** Podpis adresu pomostowego: HMAC-SHA256(sekret, email) w hex. */
export function podpisMostu(email, sekret) {
  return crypto.createHmac('sha256', sekret).update(String(email)).digest('hex');
}

/** Porównanie w stałym czasie; zły format/długość => false, bez wyjątku. */
function rowneHex(a, b) {
  if (typeof a !== 'string' || !/^[0-9a-f]{64}$/i.test(a)) return false;
  const x = Buffer.from(a.toLowerCase(), 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Czy nagłówek `X-Most-Podpis` jest poprawnym podpisem adresu.
 * @param {string} emailSurowy adres dokładnie tak, jak przyszedł w żądaniu
 * @param {string|undefined} podpis wartość nagłówka
 * @param {string} sekret JWT_SECRET
 */
export function poprawnyPodpisMostu(emailSurowy, podpis, sekret) {
  const surowy = String(emailSurowy ?? '');
  const kanoniczny = surowy.trim().toLowerCase();
  const naglowek = typeof podpis === 'string' ? podpis.trim() : '';
  // Oba porównania zawsze wykonane — czas odpowiedzi nie zdradza, który wariant pasował.
  const okKanoniczny = rowneHex(naglowek, podpisMostu(kanoniczny, sekret));
  const okSurowy = rowneHex(naglowek, podpisMostu(surowy, sekret));
  return okKanoniczny || okSurowy;
}
