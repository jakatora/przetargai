import { API_URL } from '../config';
import { bladOdpowiedzi, bladSieci } from './errors';

let authToken = null;
let naWygasnieciesesji = null;

/** Ustawia token JWT dołączany do żądań (null = wylogowany). */
export function setAuthToken(token) {
  authToken = token;
}

/**
 * Rejestruje reakcję na wygaśnięcie sesji (401 z serwera).
 * AuthContext podpina tu wylogowanie — bez tego apka wisiała na ekranie błędu,
 * bo żaden ekran nie wiedział, że token przestał być ważny (audyt 2026-07-09).
 */
export function onSesjaWygasla(handler) {
  naWygasnieciesesji = handler;
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && authToken) headers.Authorization = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw bladSieci();
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* odpowiedź bez treści */
  }

  if (!res.ok) {
    const err = bladOdpowiedzi(res.status, data);
    // Wygasła sesja na trasie wymagającej tokenu — wyloguj raz, globalnie.
    // Na trasach publicznych (logowanie) 401 znaczy „złe hasło", nie „wyloguj".
    if (err.wygaslaSesja && auth && authToken && naWygasnieciesesji) {
      naWygasnieciesesji();
    }
    throw err;
  }
  return data;
}

/** Klient REST backendu PrzetargAI. */
export const api = {
  register: (payload) => request('/auth/register', { method: 'POST', body: payload, auth: false }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload, auth: false }),
  /** Prośba o reset hasła — backend zawsze odpowiada 200 (anty-enumeracja). */
  forgotPassword: (payload) => request('/auth/forgot-password', { method: 'POST', body: payload, auth: false }),
  /** Ustawienie nowego hasła kodem z maila — zwraca { token, user } (od razu zalogowany). */
  resetPassword: (payload) => request('/auth/reset-password', { method: 'POST', body: payload, auth: false }),
  /** Publiczne statystyki (bez logowania): { lacznie, nowe24h, nowe7dni } — dowód społeczny. */
  publicStats: () => request('/stats/public', { auth: false }),
  getMe: () => request('/auth/me'),
  updateProfile: (payload) => request('/auth/me', { method: 'PATCH', body: payload }),
  /** Onboarding AI: opis firmy → { keywords, cpv } (albo { keywords: null, powod }). */
  suggestProfile: (opis) => request('/auth/suggest-profile', { method: 'POST', body: { opis } }),
  setPushToken: (pushToken) =>
    request('/auth/me/push-token', { method: 'PUT', body: { push_token: pushToken } }),
  createUpgradeLink: () => request('/auth/upgrade-link', { method: 'POST' }),
  /** Trwale usuwa konto i wszystkie dane (RODO art. 17). Wymaga potwierdzenia hasłem. */
  deleteAccount: (password) => request('/auth/me', { method: 'DELETE', body: { password } }),
  /**
   * DEMO: przełącza plan bez Stripe i od razu przelicza dopasowania.
   * Trasa istnieje WYŁĄCZNIE poza produkcją (tam backend zwraca 404) —
   * wołać tylko z UI widocznego w __DEV__.
   */
  setDemoTier: (tier) => request('/demo/tier', { method: 'POST', body: { tier } }),
  /**
   * Strona dopasowań. `before` = `next_before` z poprzedniej odpowiedzi
   * (kursor). Brak `before` = pierwsza strona.
   */
  getMatches: ({ before, limit = 20 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    return request(`/matches?${params.toString()}`);
  },
  getMatch: (id) => request(`/matches/${id}`),
  /**
   * Wyjaśnienie AI ogłoszenia (D-052). Odpowiedź: { streszczenie, cached } gdy się
   * udało, albo { streszczenie: null, powod, komunikat } przy limicie/niedostępności.
   */
  getStreszczenie: (id) => request(`/matches/${id}/streszczenie`),
  /** Statystyki rozstrzygniętych postępowań dla przetargu (R17): { wyniki } albo { wyniki: null }. */
  getWyniki: (id) => request(`/matches/${id}/wyniki`),
  /** Statystyki + zachęta do Standard oparta na realnych liczbach (D-055). */
  getStatystyki: () => request('/matches/statystyki'),
  /** Warsztat przetargu (D-054): etap pracy + prywatna notatka zapisanego przetargu. */
  setStatus: (id, status) => request(`/matches/${id}/status`, { method: 'PUT', body: { status } }),
  setNotatka: (id, notatka) => request(`/matches/${id}/notatka`, { method: 'PUT', body: { notatka } }),
  sendFeedback: (id, helpful) =>
    request(`/matches/${id}/feedback`, { method: 'POST', body: { helpful } }),

  // ----- Zapisane przetargi (zakładki) + przypomnienia o terminie -----
  // PUT wysyła `body: {}` celowo: bezcielesny PUT/POST do Cloud Functions
  // dostaje 411 Length Required od frontu Google (potwierdzone na produkcji).
  getSaved: () => request('/matches/saved'),
  getSavedIds: () => request('/matches/saved/ids'),
  saveTender: (id) => request(`/matches/${id}/save`, { method: 'PUT', body: {} }),
  unsaveTender: (id) => request(`/matches/${id}/save`, { method: 'DELETE', body: {} }),
  setReminder: (id, enabled) =>
    request(`/matches/${id}/reminder`, { method: 'PUT', body: { enabled } }),

  /**
   * Prześwietlenie projektu UMOWY przed podpisem (ulepszenie „pilnowanie
   * waloryzacji i pułapek w umowie"). Body: co najmniej jedno z `{ tekst }` /
   * `{ pdf_base64 }` (treść umowy) + opcjonalnie `{ miesiace }` (czas trwania —
   * steruje flagą braku obowiązkowej klauzuli waloryzacyjnej, art. 439 Pzp).
   * Odpowiedź: `{ tekst, flagi: [{ typ, kolor, tytul, opis }] }`, gdzie
   * `kolor` ∈ { zielony, pomarańczowy, czerwony }.
   */
  analizujUmowe: (payload) =>
    request('/api/przetarg/umowa/analiza', { method: 'POST', body: payload }),

  // ----- Radar SWZ (ulepszenie „Radar pytań i odpowiedzi do SWZ", panel 7/7) -----
  // Panel woła agregat `GET .../postepowania/:id` (termin pytań + pytania + timeline
  // zmian + checklista + bramka jednym zapytaniem) oraz akcje: analiza (generuje
  // pytania), odświeżenie (wchłania nową wersję SWZ → zmiany), odznaczenie zmiany
  // i wysyłka z bramką. Prefiks tras: `/api/przetarg/swz`.
  radarListaPostepowan: () => request('/api/przetarg/swz/postepowania'),
  radarUtworzPostepowanie: (payload) =>
    request('/api/przetarg/swz/postepowania', { method: 'POST', body: payload }),
  radarPostepowanie: (id) => request(`/api/przetarg/swz/postepowania/${id}`),
  /** Analiza SWZ (płatne AI, subskrypcja) — wykryte niejasności zapisze jako szkice pytań. */
  radarAnalizuj: (id, payload) =>
    request(`/api/przetarg/swz/postepowania/${id}/analiza`, { method: 'POST', body: payload }),
  /** Wchłonięcie nowo opublikowanej wersji SWZ → wersjonowanie + wpis zmiany (diff). */
  radarOdswiez: (id, payload) =>
    request(`/api/przetarg/swz/postepowania/${id}/odswiez`, { method: 'POST', body: payload }),
  /** Odznaczenie/cofnięcie: potwierdza, że zmianę uwzględniono w ofercie. */
  radarUwzglednij: (id, zmianaId, uwzglednione = true) =>
    request(`/api/przetarg/swz/postepowania/${id}/zmiany/${zmianaId}/uwzglednij`, {
      method: 'POST', body: { uwzglednione },
    }),
  /** Bramka przy wysyłce: bez `wymus` blokada (409) przy nieodznaczonych zmianach. */
  radarWyslij: (id, wymus = false) =>
    request(`/api/przetarg/swz/postepowania/${id}/wyslij`, { method: 'POST', body: { wymus } }),

  // ----- Radar zamówień podprogowych (poniżej 170 tys. zł, panel 7/7) -----
  // Scala zakupy, których NIE ma w BZP (postępowania wyłączone z Pzp na platformach
  // zakupowych, e-propublico, BIP-y, Baza Konkurencyjności) w jeden strumień „obok"
  // dużych przetargów. Prefiks tras: `/api/przetarg/podprogowe`. Odczyty czyste;
  // `odswiez` odpala po stronie backendu monitor (płatne AI streszcza regulamin za
  // bramką budżetu — mobil tylko wyzwala, nie liczy kosztu).
  /** Preferencje radaru zalogowanego użytkownika: { preferencje: [...] }. */
  podprogowePreferencje: () => request('/api/przetarg/podprogowe/preferencje'),
  /** Zapis (upsert) preferencji branża/region/próg → { preferencja }. */
  podprogoweZapiszPreferencje: (payload) =>
    request('/api/przetarg/podprogowe/preferencje', { method: 'POST', body: payload }),
  /** Usunięcie preferencji radaru (skopowane do właściciela). */
  podprogoweUsunPreferencje: (id) =>
    request(`/api/przetarg/podprogowe/preferencje/${id}`, { method: 'DELETE', body: {} }),
  /** Scalony strumień z filtrami (branża/region/próg/tylko „łatwiejszy start"), stronicowany. */
  podprogoweOgloszenia: ({ branza, region, prog, latwiejszyStart, limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (branza) params.set('branza', branza);
    if (region) params.set('region', region);
    if (prog !== undefined && prog !== null && prog !== '') params.set('prog', String(prog));
    if (latwiejszyStart) params.set('latwiejszy_start', '1');
    if (limit !== undefined && limit !== null) params.set('limit', String(limit));
    if (offset !== undefined && offset !== null) params.set('offset', String(offset));
    const qs = params.toString();
    return request(`/api/przetarg/podprogowe/ogloszenia${qs ? `?${qs}` : ''}`);
  },
  /** Szczegóły znaleziska WRAZ z regulaminem zakupowym: { ogloszenie }. */
  podprogoweOgloszenie: (id) => request(`/api/przetarg/podprogowe/ogloszenia/${id}`),
  /** Ręczny trigger odświeżenia (adaptery + domówienie regulaminów) → { odswiezono, dodano, ... }. */
  podprogoweOdswiez: (payload = {}) =>
    request('/api/przetarg/podprogowe/odswiez', { method: 'POST', body: payload }),

  // ----- Sejf dokumentów firmy (licznik świeżości, panel 7/7) -----
  // Podręczny sejf podmiotowych środków dowodowych (KRK, US, ZUS, polisa OC, wpis do
  // rejestru, wykaz robót, uprawnienia) z licznikiem dni ważności i statusem „gotowy /
  // zamów nowy / przeterminowany". Prefiks tras: `/api/przetarg/sejf`. Oryginały plików
  // (XML/podpisany PDF) idą base64 — backend wykrywa format i podpis, ostrzega przy skanie.
  /** Katalog typów dokumentów (ważność, czas urzędu, link „gdzie wyrobić online"). */
  sejfKatalog: () => request('/api/przetarg/sejf/katalog'),
  /** Lista dokumentów użytkownika wzbogacona o licznik dni + status + link online. */
  sejfDokumenty: () => request('/api/przetarg/sejf/dokumenty'),
  /** Dodanie dokumentu: { typ, data_wystawienia?, okres_waznosci_dni?, notatka? }. */
  sejfDodaj: (payload) => request('/api/przetarg/sejf/dokumenty', { method: 'POST', body: payload }),
  /** Edycja pól dokumentu (częściowa). */
  sejfEdytuj: (id, payload) =>
    request(`/api/przetarg/sejf/dokumenty/${id}`, { method: 'PATCH', body: payload }),
  /** Usunięcie dokumentu (skopowane do właściciela). */
  sejfUsun: (id) => request(`/api/przetarg/sejf/dokumenty/${id}`, { method: 'DELETE', body: {} }),
  /** Upload ORYGINAŁU (base64): { plik_base64, nazwa_pliku? } → { dokument, ostrzezenie, detekcja }. */
  sejfWgrajPlik: (id, payload) =>
    request(`/api/przetarg/sejf/dokumenty/${id}/plik`, { method: 'POST', body: payload }),
  /**
   * Dopasowanie sejfu do postępowania z Radaru SWZ względem PRZEWIDYWANEGO dnia złożenia.
   * Body opcjonalne: { swz?, wymagane_typy?, dzien_zlozenia? } (bez nich backend bierze
   * najnowszą zapisaną wersję SWZ i termin składania). Zwraca trzy koszyki:
   * { swieze, przeterminuja_sie, brakuje } + linki „gdzie wyrobić online".
   */
  sejfDopasowanie: (postepowanieId, payload = {}) =>
    request(`/api/przetarg/sejf/dopasowanie/${postepowanieId}`, { method: 'POST', body: payload }),

  // ----- Czarna skrzynka składania oferty (rejestrator lotu, panel 7/7) -----
  // Prowadzi JEDNĄ próbę złożenia oferty jak rejestrator lotu: append-only taśma
  // zdarzeń ze znacznikiem czasu serwera, zrzuty ekranu, suma kontrolna (SHA-256) pliku
  // oferty. Gdy platforma zawiedzie — `awaria` w jednym kroku składa pakiet dowodowy i
  // gotowe pismo o przedłużenie terminu (wysyłane PRZED upływem terminu — po nim
  // czynności nie da się powtórzyć). Prefiks tras: `/api/przetarg/czarna-skrzynka`,
  // trasy skopowane do właściciela SESJI. Bez płatnego AI — pismo to czysta funkcja.
  /** Rozpoczyna sesję rejestratora. Body opcjonalne: { postepowanie_id? } → { sesja }. */
  czarnaSkrzynkaRozpocznij: (payload = {}) =>
    request('/api/przetarg/czarna-skrzynka/sesje', { method: 'POST', body: payload }),
  /** Sesja właściciela + append-only taśma zdarzeń: { sesja, zdarzenia }. */
  czarnaSkrzynkaSesja: (id) => request(`/api/przetarg/czarna-skrzynka/sesje/${id}`),
  /** Dopisuje zdarzenie do taśmy (krok/awaria): { typ, opis? } → { zdarzenie }. */
  czarnaSkrzynkaZdarzenie: (id, payload) =>
    request(`/api/przetarg/czarna-skrzynka/sesje/${id}/zdarzenia`, { method: 'POST', body: payload }),
  /** Zapis ORYGINAŁU zrzutu ekranu (base64): { plik_base64, opis? } → { zdarzenie }. */
  czarnaSkrzynkaZrzut: (id, payload) =>
    request(`/api/przetarg/czarna-skrzynka/sesje/${id}/zrzut`, { method: 'POST', body: payload }),
  /** Suma kontrolna (SHA-256) pliku oferty + oryginał: { plik_base64, nazwa_pliku? } → { hash, plik_url, sesja }. */
  czarnaSkrzynkaOferta: (id, payload) =>
    request(`/api/przetarg/czarna-skrzynka/sesje/${id}/oferta`, { method: 'POST', body: payload }),
  /** Buduje i zwraca tamper-evident pakiet dowodowy: { pakiet }. */
  czarnaSkrzynkaPakiet: (id) => request(`/api/przetarg/czarna-skrzynka/sesje/${id}/pakiet`),
  /** Składa pismo o przedłużenie z pakietu + meta postępowania: { meta? } → { pismo }. */
  czarnaSkrzynkaPismo: (id, meta = {}) =>
    request(`/api/przetarg/czarna-skrzynka/sesje/${id}/pismo`, { method: 'POST', body: { meta } }),
  /** Panic button: DETEKCJA awarii → PAKIET → PISMO w jednym kroku: { meta? } → { awaria, pakiet, pismo }. */
  czarnaSkrzynkaAwaria: (id, meta = {}) =>
    request(`/api/przetarg/czarna-skrzynka/sesje/${id}/awaria`, { method: 'POST', body: { meta } }),

  // ----- Symulator płynności „czy udźwigniesz kontrakt" (kalkulator decyzji, panel 5/6) -----
  // Zanim użytkownik zdecyduje „startować czy nie", z SWZ + wzoru umowy wyliczamy model
  // finansowy, miesięczne przepływy i lukę finansowania pomostowego, a na końcu status
  // (udzwigniesz/napiete/luka_krytyczna) + konkretne ruchy domknięcia luki. Router jest
  // BEZSTANOWY (nic nie utrwala, bez płatnego AI — parser deterministyczny), więc każda
  // trasa to czysty POST bez zapisu. Prefiks tras: `/api/przetarg/symulator-plynnosci`.
  /** Krok 1/6: { swz?, umowa? } → { parametry } (znormalizowany model finansowy). */
  symulatorPlynnosciParametry: (payload) =>
    request('/api/przetarg/symulator-plynnosci/parametry', { method: 'POST', body: payload }),
  /** Krok 2/6: { parametry, kosztyMiesieczne?, czasTrwaniaMies? } → { symulacja } (przepływy + luka). */
  symulatorPlynnosciSymulacja: (payload) =>
    request('/api/przetarg/symulator-plynnosci/symulacja', { method: 'POST', body: payload }),
  /** Krok 3/6: { lukaFinansowania, miesiecyPomostowych?, poduszkaGotowki?, parametry? } → { rekomendacje }. */
  symulatorPlynnosciRekomendacje: (payload) =>
    request('/api/przetarg/symulator-plynnosci/rekomendacje', { method: 'POST', body: payload }),
  /** Skrót: cała ścieżka w jednym kroku: { swz?, umowa?, kosztyMiesieczne?, czasTrwaniaMies?, poduszkaGotowki? } → { parametry, symulacja, rekomendacje }. */
  symulatorPlynnosciAnaliza: (payload) =>
    request('/api/przetarg/symulator-plynnosci/analiza', { method: 'POST', body: payload }),

  // ----- Odzyskiwacz zabezpieczenia „pilnuj zwrotu swoich pieniędzy po kontrakcie" -----
  // Po podpisaniu umowy pilnuje zwrotu zabezpieczenia należytego wykonania (art. 453 Pzp):
  // harmonogram transz (70% w 30 dni od odbioru, ≤30% w 15 dni po rękojmi), alarm w dniu
  // wymagalności, gotowe wezwanie do zwrotu (wariant przeterminowany dokłada art. 405 KC
  // i odsetki), a przed podpisem — porównanie realnego kosztu „zamrozić gotówkę" vs
  // „zapłacić prowizję za gwarancję bankową". Router BEZSTANOWY (bez DB, bez płatnego AI —
  // czyste liby liczące), „dzisiaj" wstrzykiwane. Prefiks tras: `/api/przetarg/zabezpieczenie`.
  /** { kwota, dataNalezytegoWykonania, dataUplywuRekojmi, procentZatrzymany?, dzisiaj?, stopaRoczna? } → { harmonogram, alarm }. */
  zabezpieczenieHarmonogram: (payload) =>
    request('/api/przetarg/zabezpieczenie/harmonogram', { method: 'POST', body: payload }),
  /** { kwota, lata, prowizjaGwarancjiRocznaProc?, kosztKapitaluRocznyProc? } → { porownanie }. */
  zabezpieczeniePorownaj: (payload) =>
    request('/api/przetarg/zabezpieczenie/porownaj', { method: 'POST', body: payload }),
  /** { kwota, termin, dzisiaj?, stopaRoczna?, numerUmowy?, zamawiajacy?, ... } → { wezwanie } (gotowe pismo). */
  zabezpieczenieWezwanie: (payload) =>
    request('/api/przetarg/zabezpieczenie/wezwanie', { method: 'POST', body: payload }),
};
