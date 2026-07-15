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
  getMe: () => request('/auth/me'),
  updateProfile: (payload) => request('/auth/me', { method: 'PATCH', body: payload }),
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
};
