import { AsyncLocalStorage } from 'node:async_hooks';

/*
 * Kontekst bieżącego żądania: KTO je wysłał (2026-09-25).
 *
 * Dobowy limit płatnego AI PrzetargAI liczymy per użytkownik, ale usługi AI (analiza SWZ,
 * opis różnic, streszczenie regulaminu) są wołane głęboko — przez orkiestratory i joby,
 * które nie przyjmują `userId` (np. radar podprogowy woła `uzupelnijRegulamin` bez
 * użytkownika). Zamiast przeciągać identyfikator przez każdą sygnaturę, `authRequired`
 * uruchamia resztę łańcucha żądania w tym kontekście, a warstwa AI czyta go w chwili
 * wywołania. AsyncLocalStorage przenosi kontekst przez `await`, więc działa też w
 * asynchronicznych handlerach.
 *
 * Poza żądaniem (cron: monitor SWZ, radar podprogowy) kontekstu NIE ma — wtedy
 * `biezacyUzytkownikId()` zwraca null i limit per użytkownik nie obowiązuje (pilnuje
 * go wspólna, miesięczna bramka budżetu AI).
 */
const magazyn = new AsyncLocalStorage();

/**
 * Uruchamia `fn` w kontekście zalogowanego użytkownika i zwraca jej wynik.
 * @template T
 * @param {string} userId
 * @param {() => T} fn
 * @returns {T}
 */
export function uruchomJakoUzytkownik(userId, fn) {
  return magazyn.run({ userId }, fn);
}

/** Identyfikator użytkownika bieżącego żądania albo null (poza żądaniem, np. cron). */
export function biezacyUzytkownikId() {
  return magazyn.getStore()?.userId ?? null;
}
