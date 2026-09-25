import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { users } from '../db/repos.js';

/*
 * MOST do backendu Railway (P0-4).
 *
 * Audyt 2026-09-23 §3.1: aplikacja w sklepach rozmawia z Cloud Functions, a sześć
 * dowiezionych modułów (Sejf dokumentów, Radar SWZ, Radar podprogowy, Czarna
 * skrzynka, Symulator płynności, Radar planów) żyje WYŁĄCZNIE na Railway. 42
 * wywołania `/api/przetarg/*` zwracały na produkcji 404 — moduły były martwe.
 *
 * Rekomendacja raportu: most TERAZ, migracja jako cel kwartalny. Ten plik jest
 * mostem: tłumaczy tożsamość i przekazuje bajty dalej.
 *
 * DLACZEGO TO DZIAŁA BEZ ZMIAN PO STRONIE RAILWAY (zmierzone 2026-09-24):
 *  1. `JWT_SECRET` jest po obu stronach TEN SAM (porównane po SHA-256).
 *  2. Token podpisany tym sekretem z nieistniejącym `sub` dostaje z Railway
 *     `401 "Konto nie istnieje"`, a token z losowym podpisem — `401 "Nieprawidłowy
 *     lub wygasły token"`. Czyli podpis przechodzi; brakuje wyłącznie REKORDU
 *     użytkownika w tamtejszym SQLite.
 *  3. Railway ma publiczne `/auth/register`, które bez `keywords`/`cpv_codes`
 *     NIE uruchamia dopasowań ani AI. Zakładamy więc konto pomostowe (raz na
 *     użytkownika), zapamiętujemy identyfikator i dalej podpisujemy tokeny sami.
 *
 * ŚWIADOME KOMPROMISY (do zdjęcia przy migracji):
 *  • Railway wysyła powitalny e-mail na adres konta pomostowego. Dlatego adres
 *    jest na własnej domenie technicznej (`MOST_EMAIL_DOMENA`), nigdy na adresie
 *    użytkownika.
 *  • Limiter na Railway (120 żądań/min) kluczuje po adresie IP, a cały ruch
 *    mostu wychodzi z adresów Google — wszyscy użytkownicy dzielą jeden kubełek.
 *    Przy obecnej skali wystarcza; trwałe rozwiązanie to zmiana po stronie
 *    Railway (klucz po użytkowniku), już poza zakresem „mostu teraz".
 */

/** Adres konta pomostowego — deterministyczny, na własnej domenie technicznej. */
export function emailMostu(uidAplikacji) {
  return `most.${uidAplikacji}@${env.MOST_EMAIL_DOMENA}`;
}

/**
 * Hasło konta pomostowego — WYPROWADZONE, nie losowe.
 *
 * Dzięki temu nie musimy go nigdzie przechowywać: gdy mapowanie przepadnie
 * (np. reset wolumenu Railway), możemy się tym samym hasłem po prostu zalogować
 * i odzyskać identyfikator. Wyprowadzenie z `JWT_SECRET` nie daje atakującemu nic
 * nowego — kto ma ten sekret, i tak podpisze dowolny token.
 */
export function hasloMostu(uidAplikacji) {
  return crypto.createHmac('sha256', env.JWT_SECRET)
    .update(`most:${uidAplikacji}`)
    .digest('base64url');
}

/**
 * Podpis konta pomostowego: HMAC-SHA256(JWT_SECRET, email) w hex, małe litery
 * (2026-09-25). `/auth/register` na Railway jest publiczne, a schemat adresu
 * (most.<uid>@MOST_EMAIL_DOMENA) jest przewidywalny — bez podpisu dało się
 * założyć konto na cudzy uid, zanim zrobił to most, i przejąć jego dane w modułach.
 * Railway wymaga nagłówka `X-Most-Podpis` dla adresów z tej domeny.
 */
export function podpisMostu(email) {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(String(email)).digest('hex');
}

/**
 * Token dla Railway.
 *
 * Railway sprawdza wyłącznie podpis i istnienie konta (nie ma pola `tv`), więc
 * krótka ważność wystarcza — token żyje tyle, co pojedyncze żądanie w locie.
 */
export function tokenRailway(idRailway) {
  return jwt.sign({ sub: idRailway }, env.JWT_SECRET, { expiresIn: '5m' });
}

async function zapytajRailway(sciezka, opcje) {
  return fetch(`${env.MOST_RAILWAY_URL}${sciezka}`, {
    ...opcje,
    signal: AbortSignal.timeout(env.MOST_TIMEOUT_MS),
  });
}

/**
 * Zakłada (albo odnajduje) konto pomostowe i zwraca jego identyfikator na Railway.
 * @throws {Error} gdy Railway nie pozwala ani założyć, ani zalogować konta
 */
export async function zalozKontoPomostowe(uidAplikacji) {
  const email = emailMostu(uidAplikacji);
  const password = hasloMostu(uidAplikacji);
  // Podpis przy rejestracji (i logowaniu — nie szkodzi): Railway wymaga go dla
  // adresów z MOST_EMAIL_DOMENA, żeby nikt nie założył konta na cudzy uid.
  const naglowki = { 'Content-Type': 'application/json', 'X-Most-Podpis': podpisMostu(email) };

  const rejestracja = await zapytajRailway('/auth/register', {
    method: 'POST',
    headers: naglowki,
    // BEZ keywords/cpv_codes — to warunek, żeby Railway nie odpalił dopasowań
    // (a z nimi płatnego AI) przy zakładaniu konta technicznego.
    body: JSON.stringify({ email, password }),
  });

  if (rejestracja.status === 201) {
    const dane = await rejestracja.json();
    return dane.user.id;
  }

  // 409 = konto pomostowe już istnieje (np. mapowanie przepadło po naszej stronie).
  // Hasło jest wyprowadzone, więc po prostu się logujemy.
  if (rejestracja.status === 409) {
    const logowanie = await zapytajRailway('/auth/login', {
      method: 'POST',
      headers: naglowki,
      body: JSON.stringify({ email, password }),
    });
    if (logowanie.ok) return (await logowanie.json()).user.id;
    throw new Error(`Most: konto pomostowe istnieje, ale logowanie zwróciło ${logowanie.status}`);
  }

  throw new Error(`Most: nie udało się założyć konta pomostowego (${rejestracja.status})`);
}

/**
 * Identyfikator użytkownika po stronie Railway — z profilu albo świeżo założony.
 * @param {{id: string, most_railway_user_id?: string}} uzytkownik
 * @param {{wymusOdnowienie?: boolean}} opcje
 */
export async function idRailwayDlaUzytkownika(uzytkownik, { wymusOdnowienie = false } = {}) {
  if (!wymusOdnowienie && uzytkownik.most_railway_user_id) return uzytkownik.most_railway_user_id;

  const id = await zalozKontoPomostowe(uzytkownik.id);
  await users.ustawMostRailway(uzytkownik.id, id);
  logger.info({ uid: uzytkownik.id, wymusOdnowienie }, 'Most: zmapowano konto na Railway');
  return id;
}

/**
 * Usuwa konto pomostowe RAZEM z danymi na Railway (RODO art. 17, 2026-09-25).
 *
 * Na koncie pomostowym leżą Sejf dokumentów (zaświadczenia KRK, ZUS, US), Czarna
 * skrzynka i Radar SWZ — a `DELETE /auth/me` w Functions kasował tylko Firestore
 * i odpowiadał „wszystkie dane usunięte". Railway kasuje kaskadowo (FK ON DELETE
 * CASCADE), wystarczy jego własne `DELETE /auth/me` z tokenem i hasłem konta.
 *
 * „Konto nie istnieje" (401 z tożsamością, która przepadła, albo 404 z tym samym
 * komunikatem) to SUKCES — ponowiona próba po częściowej awarii musi przejść.
 * Samo 404 bez tego komunikatu to brak trasy, a nie brak danych: rzucamy.
 *
 * @param {{id: string, most_railway_user_id?: string}} uzytkownik
 * @returns {Promise<'brak_mostu'|'usuniete'|'nie_istnialo'>}
 * @throws {Error} gdy nie ma pewności, że dane na Railway zniknęły
 */
export async function usunKontoPomostowe(uzytkownik) {
  const idRailway = uzytkownik?.most_railway_user_id;
  if (!idRailway) return 'brak_mostu';

  const odpowiedz = await zapytajRailway('/auth/me', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenRailway(idRailway)}`,
    },
    body: JSON.stringify({ password: hasloMostu(uzytkownik.id) }),
  });
  if (odpowiedz.ok) return 'usuniete';

  const cialo = await odpowiedz.text().catch(() => '');
  const kontaNieMa = String(cialo).includes('Konto nie istnieje');
  if ((odpowiedz.status === 401 || odpowiedz.status === 404) && kontaNieMa) return 'nie_istnialo';

  throw new Error(`Most: Railway nie usunął konta pomostowego (${odpowiedz.status})`);
}

/** Nagłówki, których NIE wolno przepisywać dalej (hop-by-hop albo nasze własne). */
const NAGLOWKI_POMIJANE = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authorization', 'proxy-authenticate', 'te', 'trailer',
  'authorization', 'content-length', 'accept-encoding',
]);

/**
 * Przekazuje pojedyncze żądanie do Railway.
 *
 * @param {{metoda: string, sciezka: string, naglowki: object, cialo?: Buffer, idRailway: string}} zadanie
 * @returns {Promise<{status: number, naglowki: Headers, cialo: Buffer}>}
 */
export async function przekaz({ metoda, sciezka, naglowki, cialo, idRailway }) {
  const doWyslania = { Authorization: `Bearer ${tokenRailway(idRailway)}` };
  for (const [klucz, wartosc] of Object.entries(naglowki ?? {})) {
    if (!NAGLOWKI_POMIJANE.has(klucz.toLowerCase()) && typeof wartosc === 'string') {
      doWyslania[klucz] = wartosc;
    }
  }

  const bezCiala = metoda === 'GET' || metoda === 'HEAD';
  const odpowiedz = await zapytajRailway(`/api/przetarg${sciezka}`, {
    method: metoda,
    headers: doWyslania,
    body: bezCiala || !cialo?.length ? undefined : cialo,
  });

  return {
    status: odpowiedz.status,
    naglowki: odpowiedz.headers,
    cialo: Buffer.from(await odpowiedz.arrayBuffer()),
  };
}

/**
 * Czy odpowiedź znaczy „tożsamość po tamtej stronie przepadła".
 *
 * Wolumen SQLite Railway może zostać odtworzony z kopii albo wyczyszczony —
 * wtedy zapamiętane mapowanie wskazuje na konto, którego już nie ma. Bez tego
 * rozpoznania użytkownik dostawałby 401 aż do ręcznej interwencji.
 */
export function tozsamoscPrzepadla({ status, cialo }) {
  if (status !== 401) return false;
  return String(cialo ?? '').includes('Konto nie istnieje');
}
