import { zarejestrujKlucz } from './daneLokalne.js';

/*
 * Stan formularza ekranu PER PRZETARG (2026-10-25) — wspólny mechanizm dla ekranów, które
 * zbierają dane do pisma (Po wygranej, Zwrot wadium…): użytkownik wraca i nic nie wpisuje
 * drugi raz. Klucz per przetarg → indeks konta (wylogowanie kasuje); SecureStore dopuszcza
 * tylko [A-Za-z0-9._-], więc id ogłoszenia jest oczyszczane. Każdy prefiks musi być wpisany
 * w `daneLokalne.PREFIKSY_KONTA`, a klucz budowany literałem szablonowym — tak rozpoznaje go
 * test-strażnik kluczy (`test/kluczeStorage.test.js`).
 */
const oczysc = (tenderId) => String(tenderId).replace(/[^A-Za-z0-9._-]/g, '_');

/** Budowniczy klucza per ekran (nazwa → funkcja id → klucz). */
export const KLUCZE_STANU_EKRANU = Object.freeze({
  poWygranej: (tenderId) => `przetargai.po-wygranej.${oczysc(tenderId)}`,
  zwrotWadium: (tenderId) => `przetargai.zwrot-wadium.${oczysc(tenderId)}`,
});

export async function wczytajStanEkranu(storage, klucz, tenderId) {
  if (!tenderId || typeof klucz !== 'function') return null;
  try {
    const raw = await storage.getItem(klucz(tenderId));
    const dane = raw ? JSON.parse(raw) : null;
    return dane && typeof dane === 'object' ? dane : null;
  } catch {
    return null;
  }
}

export async function zapiszStanEkranu(storage, klucz, tenderId, stan) {
  if (!tenderId || typeof klucz !== 'function' || !stan || typeof stan !== 'object') return;
  const k = klucz(tenderId);
  await zarejestrujKlucz(storage, k);
  await storage.setItem(k, JSON.stringify(stan));
}
