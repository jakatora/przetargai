import { AsyncLocalStorage } from 'node:async_hooks';

/*
 * Stan AI w dziennym cyklu — licznik udanych i nieudanych ocen oraz decyzja,
 * czy AI w ogóle działa.
 *
 * Incydent 2026-10-12: konto Anthropic straciło kredyty i KAŻDE wywołanie
 * w `dailyTenderFetch` kończyło się 400 „credit balance is too low".
 * `scoreTenderMatch` łapał błąd i zwracał null (świadomie — awaria AI nie może
 * wywracać cyklu), matching degradował do heurystyki, a `/health` przez 6 dni
 * pokazywał `status: ok`. Degradacja jest w porządku, jej NIEWIDOCZNOŚĆ nie.
 */

/** Rodzaje błędów, które same nie miną — potrzebny człowiek (doładowanie kredytów, nowy klucz). */
export const BLEDY_KRYTYCZNE = Object.freeze(['kredyty', 'autoryzacja']);

/**
 * Od ilu porażek przewaga porażek znaczy awarię. Przy jednym kandydacie w całym
 * cyklu pojedynczy timeout dawałby „100% porażek" i alarm na całą dobę.
 * Błędy krytyczne alarmują od pierwszego wystąpienia (patrz `ocenStanAi`).
 */
const MIN_NIEUDANYCH = 3;

/** Komunikat ląduje w dokumencie Firestore, w `/health` i w mailu — nie potrzebujemy więcej. */
const MAKS_KOMUNIKAT = 300;

/**
 * Rozpoznaje rodzaj błędu wywołania AI. SDK Anthropica rzuca APIError ze `status`,
 * `type` (typ błędu API) i `error` (całe ciało odpowiedzi); błędy sieci i timeouty
 * nie mają statusu.
 *
 * 🚨 Brak kredytów przychodzi jako 400 `invalid_request_error` — rozpoznajemy go
 * po treści, inaczej wyglądałby jak zwykły zły request i nie budził nikogo.
 */
export function klasyfikujBladAi(err) {
  const status = Number.isInteger(err?.status) ? err.status : null;
  const typApi = err?.type ?? err?.error?.error?.type ?? null;
  const komunikat = String(err?.error?.error?.message ?? err?.message ?? 'nieznany błąd')
    .slice(0, MAKS_KOMUNIKAT);

  let typ;
  if (status === 402 || typApi === 'billing_error' || /credit balance/i.test(komunikat)) typ = 'kredyty';
  else if (status === 401 || status === 403
    || typApi === 'authentication_error' || typApi === 'permission_error') typ = 'autoryzacja';
  else if (status === 429 || typApi === 'rate_limit_error') typ = 'limit';
  else if (status === 529 || typApi === 'overloaded_error') typ = 'przeciazenie';
  else if (status !== null && status >= 500) typ = 'serwer';
  else if (status !== null) typ = 'zadanie'; // zły model, za duży request — błąd po naszej stronie
  else if (/timed? ?out|timeout/i.test(komunikat)) typ = 'timeout';
  else if (/connection|ECONN|ENOTFOUND|EAI_AGAIN|socket|fetch failed/i.test(komunikat)) typ = 'siec';
  else typ = 'inny';

  return { typ, status, komunikat };
}

/** Licznik jednego przebiegu. Kształt trafia 1:1 do `cron.ostatni_wynik.ai`. */
export function pustyLicznikAi() {
  return { udane: 0, nieudane: 0, bledy_wg_typu: {}, ostatni_blad: null, ostatni_sukces_o: null };
}

/*
 * Licznik jest przypięty do kontekstu asynchronicznego przebiegu, nie do modułu.
 * `scoreTenderMatch` siedzi kilka warstw pod cronem (cykl → porcje użytkowników
 * w Promise.all → użytkownik → kandydat), a ta sama funkcja AI służy też trasom API.
 * Globalny licznik mieszałby oba ruchy; przeciąganie parametru przez cztery warstwy
 * zmieniałoby sygnatury, których używa też onboarding.
 */
const magazyn = new AsyncLocalStorage();

/**
 * Uruchamia `fn` tak, żeby zgłoszenia AI z jej wnętrza trafiały do `licznik`.
 * Licznik należy do wołającego — po wyjątku z `fn` liczby nadal są w nim.
 */
export function zbierajStatystykiAi(licznik, fn) {
  return magazyn.run(licznik, fn);
}

/** Udana ocena AI. Poza przebiegiem (trasy API) nic nie robi. */
export function zglosSukcesAi(teraz = new Date()) {
  const licznik = magazyn.getStore();
  if (!licznik) return;
  licznik.udane += 1;
  licznik.ostatni_sukces_o = teraz.toISOString();
}

/** Nieudana próba oceny AI (`typ` z `klasyfikujBladAi` albo własny, np. `budzet`). */
export function zglosNiepowodzenieAi({ typ, status = null, komunikat = '' }, teraz = new Date()) {
  const licznik = magazyn.getStore();
  if (!licznik) return;
  licznik.nieudane += 1;
  licznik.bledy_wg_typu[typ] = (licznik.bledy_wg_typu[typ] ?? 0) + 1;
  licznik.ostatni_blad = {
    typ,
    status,
    komunikat: String(komunikat).slice(0, MAKS_KOMUNIKAT),
    o: teraz.toISOString(),
  };
}

/** Pierwszy błąd wymagający człowieka, który wystąpił w przebiegu (albo null). */
export function bladKrytycznyAi(ai) {
  return BLEDY_KRYTYCZNE.find((typ) => (ai?.bledy_wg_typu?.[typ] ?? 0) > 0) ?? null;
}

/**
 * Czy AI w przebiegu działało.
 *  • null  — nie było żadnej próby (AI wyłączone, brak kandydatów, stary ślad),
 *  • false — porażek więcej niż sukcesów i albo jest ich co najmniej MIN_NIEUDANYCH,
 *            albo wśród nich jest błąd krytyczny (kredyty i klucz nie wrócą same),
 *  • true  — w pozostałych przypadkach.
 */
export function ocenStanAi(ai) {
  const udane = ai?.udane ?? 0;
  const nieudane = ai?.nieudane ?? 0;
  if (udane + nieudane === 0) return null;
  if (nieudane <= udane) return true;
  return !(nieudane >= MIN_NIEUDANYCH || bladKrytycznyAi(ai) !== null);
}
