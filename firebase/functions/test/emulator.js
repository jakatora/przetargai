/**
 * Strażnik testów integracyjnych.
 *
 * Audyt 2026-07-10 (HIGH): pliki testów Firestore używały `{ skip: '...' }`, gdy nie
 * wykryły emulatora. `npm test` bez emulatora pomijał wtedy ~45 testów — całą warstwę
 * danych, silnik dopasowań, usuwanie konta, idempotencję webhooków — i kończył się
 * na zielono. Zestaw testów, który kłamie o pokryciu, jest gorszy niż jego brak.
 *
 * Teraz brak emulatora to BŁĄD, nie cicha zgoda. `npm test` sam go uruchamia.
 */
export function wymagajEmulatora() {
  if (process.env.FIRESTORE_EMULATOR_HOST) return;

  throw new Error(
    'Ten plik testuje warstwę danych i wymaga emulatora Firestore.\n'
    + 'Uruchom `npm test` (sam startuje emulator) zamiast wołać node --test bezpośrednio.',
  );
}

/** Inicjalizuje Admin SDK raz na proces testowy. */
export async function polaczZEmulatorem() {
  wymagajEmulatora();
  const { initializeApp, getApps } = await import('firebase-admin/app');
  if (!getApps().length) initializeApp({ projectId: 'przetargai' });
}
