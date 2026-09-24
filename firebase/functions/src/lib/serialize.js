import { ZRODLA } from './katalogPrzetargow.js';
import { kodWojewodztwa, WOJEWODZTWA } from './wojewodztwa.js';

/** Reprezentacje zasobów bezpieczne do zwrotu w API (bez danych wrażliwych). */

const ZRODLA_WG_KODU = Object.fromEntries(ZRODLA.map((z) => [z.kod, z]));

/**
 * Metryczka źródła pierwotnego ogłoszenia (P1-3).
 *
 * Wykonawca musi wiedzieć trzy rzeczy, zanim zaufa wpisowi: z którego rejestru
 * on pochodzi, kiedy ten rejestr ostatnio u nas zadziałał i gdzie jest oryginał.
 * Bez środkowej informacji „brak nowych przetargów" jest nierozróżnialne od
 * „pobieranie padło trzy dni temu" — a to są przeciwne decyzje biznesowe.
 *
 * Nieznany kod źródła NIE jest cicho przemianowany na BZP: byłaby to fałszywa
 * atrybucja ogłoszenia do rejestru, w którym go nie ma.
 */
export function metryczkaZrodla(kodSurowy, znaczniki = {}) {
  const kod = kodSurowy ?? 'bzp';
  const opis = ZRODLA_WG_KODU[kod] ?? null;
  const znacznik = znaczniki?.[kod] ?? null;
  return {
    kod,
    etykieta: opis?.etykieta ?? { pl: kod, en: kod },
    nazwa: opis?.nazwa ?? { pl: kod, en: kod },
    rejestr: opis?.rejestr ?? null,
    stan: znacznik?.stan ?? null,
    zsynchronizowano_o: znacznik?.ostatni_sukces_o ?? null,
  };
}

/**
 * Ogłoszenie w katalogu „Wszystkie przetargi". Świadomie BEZ `confidence_score`
 * — ta lista nie jest oceniana względem profilu i nie wolno jej udawać, że jest.
 */
export function publicTender(row, znaczniki = {}) {
  if (!row) return null;
  const kodRegionu = kodWojewodztwa(row.wojewodztwo);
  return {
    id: row.id,
    title: row.title,
    organization: row.organization ?? null,
    budget: row.budget ?? null,
    currency: row.currency ?? 'PLN',
    deadline: row.deadline ?? null,
    url: row.url ?? null,
    cpv: row.cpv_main ?? null,
    numer: row.numer ?? null,
    source: row.source ?? 'bzp',
    zrodlo: metryczkaZrodla(row.source, znaczniki),
    // Region w jednym formacie dla wszystkich rejestrów (BZP daje „PL14", BK „mazowieckie").
    wojewodztwo: kodRegionu,
    region_nazwa: kodRegionu ? WOJEWODZTWA[kodRegionu] : null,
    wadium_wymagane: row.wadium_wymagane ?? null,
    wadium_kwota: row.wadium_kwota ?? null,
    wadium_wiele_czesci: row.wadium_wiele_czesci ?? false,
    kryterium_oceny: row.kryterium_oceny ?? null,
    liczba_czesci: row.liczba_czesci ?? null,
    published_at: row.published_at ?? null,
    fetched_at: row.fetched_at ?? null,
    zaktualizowany_o: row.zaktualizowany_o ?? null,
    /*
     * To samo postępowanie bywa ogłoszone w dwóch rejestrach (projekt unijny
     * trafia i do BZP, i do Bazy Konkurencyjności), a ofertę składa się tam,
     * gdzie wskazuje ogłoszenie. Wykonawca musi widzieć oba adresy.
     */
    zrodla_alternatywne: (row.zrodla_alternatywne ?? []).map((z) => ({
      ...metryczkaZrodla(z.source, znaczniki),
      url: z.url ?? null,
    })),
  };
}

/** Użytkownik bez hasła i identyfikatorów Stripe. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    company_nip: user.company_nip,
    company_name: user.company_name,
    premium_tier: user.premium_tier,
    keywords: user.keywords,
    cpv_codes: user.cpv_codes,
    /*
     * Deklaracje, które NIE wchodzą do scoringu — opisują kontekst decyzji
     * („czy to mój teren", „czy to mój rozmiar"), a nie kryteria wyszukiwania.
     * Starsze konta nie mają tych pól: pusta tablica i null zamiast undefined,
     * żeby aplikacja nie musiała znać historii schematu.
     */
    regiony: user.regiony ?? [],
    wartosc_max: user.wartosc_max ?? null,
    created_at: user.created_at,
  };
}

/**
 * Pola przetargu wyłuskane ze ZDENORMALIZOWANEGO wiersza dopasowania.
 *
 * Dokument dopasowania niesie kopię przetargu z prefiksem `tender_`, a moduł
 * wyjaśnienia operuje na kształcie ogłoszenia. Bez tego mostu policzenie
 * sygnałów dla karty feedu wymagałoby odczytu pełnego przetargu na KAŻDY
 * element listy — czyli 50 dodatkowych odczytów Firestore na jedno przewinięcie.
 */
export function przetargZDopasowania(row) {
  return {
    title: row?.tender_title ?? null,
    cpv_main: row?.tender_cpv ?? null,
    wojewodztwo: row?.tender_wojewodztwo ?? null,
    budget: row?.tender_budget ?? null,
    wadium_kwota: row?.tender_wadium_kwota ?? null,
  };
}

/**
 * Dopasowanie wraz z danymi przetargu (wiersz z JOIN-a w repos.matches).
 *
 * `znaczniki` (stan i czas synchronizacji per rejestr) są opcjonalne: bez nich
 * karta pokaże samo źródło, bez świeżości. Nie wolno jednak pominąć ich na
 * stałe — „brak nowych przetargów" i „pobieranie padło trzy dni temu" wyglądają
 * wtedy identycznie, a prowadzą do przeciwnych decyzji.
 */
export function publicMatch(row, znaczniki = {}) {
  if (!row) return null;
  return {
    id: row.id,
    confidence_score: row.confidence_score,
    reasoning: row.match_reasoning,
    scorer: row.scorer,
    created_at: row.created_at,
    tender: {
      id: row.tender_id,
      title: row.tender_title,
      organization: row.tender_organization,
      budget: row.tender_budget,
      currency: row.tender_currency,
      deadline: row.tender_deadline,
      url: row.tender_url,
      cpv: row.tender_cpv,
      source: row.tender_source ?? 'bzp',
      zrodlo: metryczkaZrodla(row.tender_source, znaczniki),
      wojewodztwo: row.tender_wojewodztwo ?? null,
      // Wadium (D-056) — wymagane: null=nieznane, false=nie, true=tak.
      wadium_wymagane: row.tender_wadium_wymagane ?? null,
      wadium_kwota: row.tender_wadium_kwota ?? null,
      wadium_wiele_czesci: row.tender_wadium_wiele_czesci ?? false,
      // Meta (rundy 5-6): kryterium oceny + liczba części.
      kryterium_oceny: row.tender_kryterium_oceny ?? null,
      liczba_czesci: row.tender_liczba_czesci ?? null,
    },
  };
}

/**
 * Zapisany przetarg (zakładka). Ten SAM kształt co publicMatch — aplikacja
 * renderuje listę zapisanych tym samym komponentem karty i otwiera ten sam
 * ekran szczegółów. `saved_at` zamiast `created_at`.
 */
export function publicSaved(row, znaczniki = {}) {
  if (!row) return null;
  return {
    id: row.id,
    confidence_score: row.confidence_score,
    reasoning: row.match_reasoning,
    scorer: row.scorer,
    saved_at: row.saved_at,
    reminder_enabled: row.reminder_enabled === true,
    remind_at: row.remind_at ?? null,
    // Warsztat przetargu (D-054): etap pracy + prywatna notatka.
    status: row.status ?? 'rozwazam',
    notatka: row.notatka ?? '',
    tender: {
      id: row.tender_id,
      title: row.tender_title,
      organization: row.tender_organization,
      budget: row.tender_budget,
      currency: row.tender_currency,
      deadline: row.tender_deadline,
      url: row.tender_url,
      cpv: row.tender_cpv,
      source: row.tender_source ?? 'bzp',
      zrodlo: metryczkaZrodla(row.tender_source, znaczniki),
      wojewodztwo: row.tender_wojewodztwo ?? null,
      // Wadium (D-056) — wymagane: null=nieznane, false=nie, true=tak.
      wadium_wymagane: row.tender_wadium_wymagane ?? null,
      wadium_kwota: row.tender_wadium_kwota ?? null,
      wadium_wiele_czesci: row.tender_wadium_wiele_czesci ?? false,
      // Meta (rundy 5-6): kryterium oceny + liczba części.
      kryterium_oceny: row.tender_kryterium_oceny ?? null,
      liczba_czesci: row.tender_liczba_czesci ?? null,
    },
  };
}
