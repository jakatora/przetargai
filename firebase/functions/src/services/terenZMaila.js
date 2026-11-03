import { env } from '../config.js';
import { magicLinks } from '../db/repos.js';
import { kodWojewodztwa } from '../lib/wojewodztwa.js';

/*
 * TEREN Z MAILA (2026-11-03). Bez województw selekcja bierze całą Polskę — 3.11 tak miało 19 z 21 prawdziwych kont
 * (w apce teren jest tylko w karcie firmy albo z NIP-u), a konto „Elektryka, hydraulika” dostało w 6 dni 573 wybrane
 * z 16 województw. Mail z wybranymi niesie więc jednorazowy link (14 dni, cel `teren_z_maila`) do strony
 * z województwami — bez logowania i bez względu na wersję apki. Pytamy najwyżej raz na tydzień, a po „cała Polska”
 * wcale. Link pozwala TYLKO ustawić teren.
 */
export const CEL_TEREN = 'teren_z_maila';
export const TEREN_TTL_MIN = 14 * 24 * 60;
export const PYTAJ_CO_DNI = 7;
const DOBA_MS = 86_400_000;

export function czasPytacOTeren(user, teraz) {
  if (user?.regiony?.length || user?.teren_cala_polska === true) return false;
  const ostatnio = Date.parse(user?.teren_pytanie_o ?? '');
  return !Number.isFinite(ostatnio) || Date.parse(teraz) - ostatnio >= PYTAJ_CO_DNI * DOBA_MS;
}

/** Ile różnych województw w wybranych — mail mówi „z 9 województw”, żeby było widać, po co pytamy. */
export function liczbaWojewodztw(lista) {
  return new Set(lista.map((m) => kodWojewodztwa(m.tender_wojewodztwo)).filter(Boolean)).size;
}

export async function linkTerenu(userId, { linki = magicLinks } = {}) {
  const { token } = await linki.create({ userId, purpose: CEL_TEREN, ttlMinutes: TEREN_TTL_MIN });
  return `${env.APP_URL}/maile/teren?token=${token}`;
}
