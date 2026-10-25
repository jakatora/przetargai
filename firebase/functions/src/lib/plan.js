/*
 * Plan EFEKTYWNY klienta (spec §15) — jedyne źródło prawdy dla bramek FUNKCJI:
 * limity AI, limit wybranych, blokady tras, przebiegi co 3 h, powiadomienia.
 *
 * Rozliczenia (webhooki Stripe, upgrade) zostają na `premium_tier`: próba nie jest
 * subskrypcją i nie wolno jej z nią pomylić — inaczej zakup w trakcie próby
 * zostałby odrzucony jako „już aktywna”.
 */
export const PROBA_DNI = 7;
const DOBA_MS = 86_400_000;

/** Koniec próby liczony od chwili rejestracji. */
export function probaDo(odIso, dni = PROBA_DNI) {
  return new Date(Date.parse(odIso) + dni * DOBA_MS).toISOString();
}

/** 'standard' dla płacących i dla kont w trakcie próby; reszta 'free'. */
export function planEfektywny(user, teraz = new Date().toISOString()) {
  if (user?.premium_tier === 'standard') return 'standard';
  const koniec = Date.parse(user?.proba_do ?? '');
  return Number.isFinite(koniec) && koniec > Date.parse(teraz) ? 'standard' : 'free';
}

/** Stan próby do pokazania w apce; null = konto nigdy nie miało próby. */
export function stanProby(user, teraz = new Date().toISOString()) {
  const koniec = Date.parse(user?.proba_do ?? '');
  if (!Number.isFinite(koniec)) return null;
  const zostalo = koniec - Date.parse(teraz);
  return {
    aktywna: user?.premium_tier !== 'standard' && zostalo > 0,
    do: new Date(koniec).toISOString(),
    dni_zostalo: Math.max(0, Math.ceil(zostalo / DOBA_MS)),
  };
}
