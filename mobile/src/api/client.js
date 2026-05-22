import { API_URL } from '../config';

let authToken = null;

/** Ustawia token JWT dołączany do żądań (null = wylogowany). */
export function setAuthToken(token) {
  authToken = token;
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
    throw new Error('Brak połączenia z serwerem. Sprawdź internet.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* odpowiedź bez treści */
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || `Błąd serwera (${res.status}).`);
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
  getMatches: () => request('/matches'),
  getMatch: (id) => request(`/matches/${id}`),
  sendFeedback: (id, helpful) =>
    request(`/matches/${id}/feedback`, { method: 'POST', body: { helpful } }),
};
