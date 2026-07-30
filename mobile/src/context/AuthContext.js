import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getItem, setItem, deleteItem } from '../lib/storage';
import { api, setAuthToken, onSesjaWygasla } from '../api/client';
import { registerForPushNotifications } from '../services/push';
import { czyPokazacOnboarding, KLUCZ_ONBOARDING_POMINIETY } from '../lib/onboarding';

const TOKEN_KEY = 'przetargai_token';
const USER_KEY = 'przetargai_user';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  // Czy użytkownik pominął ekran powitalny (first-run). Wczytywane w tym samym
  // cyklu co sesja, żeby nawigator znał trasę startową bez migotania.
  const [onboardingPominiety, setOnboardingPominiety] = useState(false);

  // Odtworzenie sesji przy starcie aplikacji.
  useEffect(() => {
    (async () => {
      // Flaga „pominięto onboarding" — czytamy niezależnie od sesji, best-effort.
      try {
        const pom = await getItem(KLUCZ_ONBOARDING_POMINIETY);
        if (pom === '1') setOnboardingPominiety(true);
      } catch { /* brak dostępu do storage — traktujemy jak niepominięty */ }

      let token = null;
      try {
        token = await getItem(TOKEN_KEY);
        if (token) {
          setAuthToken(token);
          const data = await api.getMe();
          setUser(data.user);
          await setItem(USER_KEY, JSON.stringify(data.user)).catch(() => {});
        }
      } catch (err) {
        // Tylko wygaśnięcie sesji kasuje token. Brak internetu, 429 czy awaria
        // serwera NIE mogą wylogowywać (audyt 2026-07-09) — użytkownik w metrze
        // tracił konto na stałe.
        if (err?.wygaslaSesja) {
          await deleteItem(TOKEN_KEY).catch(() => {});
          await deleteItem(USER_KEY).catch(() => {});
          setAuthToken(null);
        } else if (token) {
          // Token ważny, ale serwer nieosiągalny. Sam token nie wystarczy: nawigacja
          // patrzy na `user`, więc bez profilu apka i tak pokazywała ekran logowania
          // (audyt 2026-07-10). Wchodzimy na ostatnio znanym profilu — dane odświeżą
          // się przy pierwszym udanym żądaniu.
          setAuthToken(token);
          const zapisany = await getItem(USER_KEY).catch(() => null);
          if (zapisany) {
            try { setUser(JSON.parse(zapisany)); } catch { /* uszkodzony zapis */ }
          }
        }
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  /**
   * Rejestruje token powiadomień push. Wołane po zalogowaniu ORAZ po wykupieniu
   * planu Standard.
   *
   * Audyt 2026-07-10: token rejestrował się WYŁĄCZNIE przy logowaniu i rejestracji.
   * Użytkownik, który dopłacał do Standardu w trakcie sesji, nigdy nie prosił
   * o uprawnienie i nie wysyłał tokenu — czyli **płacił za powiadomienia, których
   * nie dostawał**, aż do następnego zalogowania.
   */
  const zarejestrujPush = useCallback(() => {
    registerForPushNotifications()
      .then((pushToken) => {
        if (pushToken) api.setPushToken(pushToken).catch(() => {});
      })
      .catch(() => {}); // odmowa uprawnień nie jest błędem
  }, []);

  const persistSession = useCallback(async (token, userData) => {
    await setItem(TOKEN_KEY, token);
    await setItem(USER_KEY, JSON.stringify(userData)).catch(() => {});
    setAuthToken(token);
    setUser(userData);
    // Rejestracja push w tle — nie blokuje logowania.
    zarejestrujPush();
  }, [zarejestrujPush]);

  const signIn = useCallback(async (email, password) => {
    const data = await api.login({ email, password });
    await persistSession(data.token, data.user);
  }, [persistSession]);

  const signUp = useCallback(async (payload) => {
    const data = await api.register(payload);
    await persistSession(data.token, data.user);
  }, [persistSession]);

  // Odzyskiwanie hasła: prośba o kod (nie zmienia sesji) i ustawienie nowego hasła kodem
  // (backend zwraca token → od razu logujemy, jak przy signIn).
  const forgotPassword = useCallback((email) => api.forgotPassword({ email }), []);

  const resetPassword = useCallback(async (token, password) => {
    const data = await api.resetPassword({ token, password });
    await persistSession(data.token, data.user);
  }, [persistSession]);

  const signOut = useCallback(async () => {
    await deleteItem(TOKEN_KEY).catch(() => {});
    // Zapisany profil znika razem z tokenem — inaczej na urządzeniu zostałyby dane
    // poprzedniego użytkownika (e-mail, NIP), a kolejne konto zobaczyłoby je offline.
    await deleteItem(USER_KEY).catch(() => {});
    setAuthToken(null);
    setUser(null);
  }, []);

  // Serwer odrzucił token w trakcie sesji (wygasł, zmieniono hasło) — wylogowujemy
  // z dowolnego ekranu. Bez tego apka zostawała na ekranie błędu, z którego nie
  // było wyjścia poza reinstalacją (audyt 2026-07-09).
  useEffect(() => {
    onSesjaWygasla(() => { signOut(); });
    return () => onSesjaWygasla(null);
  }, [signOut]);

  /**
   * Jedyne wejście do zmiany profilu w pamięci. Odświeża też kopię na urządzeniu,
   * z której korzystamy przy starcie bez internetu — bez tego po zmianie profilu
   * (PATCH /me) albo po wykupieniu planu apka pokazywałaby offline nieaktualne dane.
   */
  const zapiszUsera = useCallback((userData) => {
    setUser(userData);
    if (userData) setItem(USER_KEY, JSON.stringify(userData)).catch(() => {});
    else deleteItem(USER_KEY).catch(() => {});
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await api.getMe();
    zapiszUsera(data.user);
    return data.user;
  }, [zapiszUsera]);

  /**
   * Zmiana hasła: backend unieważnia stary token (token_version++) i zwraca NOWY —
   * musimy go utrwalić, inaczej najbliższe żądanie z tego telefonu poleciałoby ze
   * starym tokenem i wylogowało właśnie tę sesję.
   */
  const zmienHaslo = useCallback(async (aktualneHaslo, noweHaslo) => {
    const data = await api.changePassword(aktualneHaslo, noweHaslo);
    if (data?.token) {
      await setItem(TOKEN_KEY, data.token).catch(() => {});
      setAuthToken(data.token);
    }
    return data;
  }, []);

  /** Zmiana e-maila: aktualizuje profil w pamięci i kopię offline (bez zmiany tokenu). */
  const zmienEmail = useCallback(async (nowyEmail, haslo) => {
    const data = await api.changeEmail(nowyEmail, haslo);
    if (data?.user) zapiszUsera(data.user);
    return data;
  }, [zapiszUsera]);

  /** Użytkownik świadomie pomija ekran powitalny — zapamiętujemy, by nie nękać. */
  const pominOnboarding = useCallback(() => {
    setOnboardingPominiety(true);
    setItem(KLUCZ_ONBOARDING_POMINIETY, '1').catch(() => {});
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user, restoring, signIn, signUp, signOut, forgotPassword, resetPassword,
        refreshUser, zmienHaslo, zmienEmail, setUser: zapiszUsera, zarejestrujPush,
        pokazOnboarding: czyPokazacOnboarding(user, onboardingPominiety),
        pominOnboarding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth musi być użyte wewnątrz AuthProvider');
  return ctx;
}
