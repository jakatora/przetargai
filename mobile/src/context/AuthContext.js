import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import * as storage from '../lib/storage';
import { getItem, setItem, deleteItem } from '../lib/storage';
import { api, setAuthToken, onSesjaWygasla } from '../api/client';
import { registerForPushNotifications, anulujPowiadomieniaKonta } from '../services/push';
import { czyPokazacOnboarding, KLUCZ_ONBOARDING_POMINIETY } from '../lib/onboarding';
import { przeprowadzWylogowanie, zwiazDaneZKontem } from '../lib/daneLokalne';

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
          // Dane lokalne należą do konta (2026-09-25). Brak znacznika właściciela =
          // aktualizacja apki u zalogowanego użytkownika — jego dane przejmuje jego
          // konto; obcy właściciel = dane znikają (sesja zostaje). Błąd magazynu nie
          // może wywrócić odtworzenia sesji.
          if (data.user?.id !== undefined && data.user?.id !== null) {
            const { wyczyszczono } = await zwiazDaneZKontem(storage, data.user.id, {
              przyjmijNieznane: true,
              zachowaj: [TOKEN_KEY, USER_KEY],
            }).catch(() => ({ wyczyszczono: false }));
            if (wyczyszczono) {
              setOnboardingPominiety(false);
              anulujPowiadomieniaKonta();
            }
          }
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
    // Logowanie INNEGO konta niż właściciel danych na telefonie (albo nieznanego —
    // np. po wylogowaniu w starszej wersji, która nic nie kasowała) → dane
    // poprzedniej firmy znikają PRZED zapisem nowej sesji (audyt 2026-09-25).
    // Czyszczenie łapie błędy per klucz, więc `catch` tu łapie co najwyżej zapis
    // znacznika właściciela — dane są już wtedy skasowane.
    try {
      const { wyczyszczono } = await zwiazDaneZKontem(storage, userData?.id);
      if (wyczyszczono) {
        setOnboardingPominiety(false);
        anulujPowiadomieniaKonta();
      }
    } catch { /* patrz wyżej */ }
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

  // Trwające wylogowanie. Wyrejestrowanie push idzie z tokenem — gdy serwer odpowie
  // 401, klient API zawoła `onSesjaWygasla` → `signOut` drugi raz. Zamiast drugiego
  // przebiegu (albo pętli) oddajemy ten, który już trwa.
  const wylogowanieWToku = useRef(null);

  /**
   * Wylogowanie.
   *
   * Audyt 2026-09-25 (P0): kasowało tylko token i profil — rejestr kontraktów,
   * checklisty ofert i ścieżki odwołań zostawały następnej firmie na wspólnym
   * telefonie, a token push dalej dostawał powiadomienia konta. Teraz:
   * wyrejestrowanie push (best-effort, z limitem czasu) → lokalne powiadomienia →
   * wszystkie dane konta (lib/daneLokalne). Preferencje telefonu zostają.
   *
   * @param {{ wyrejestrujPush?: boolean, sesjaWygasla?: boolean }} [opcje]
   *   `wyrejestrujPush: false` — usunięte konto (backend skasował rekord z tokenem);
   *   `sesjaWygasla: true` — serwer odrzucił token: znika tylko sesja, dane zostają
   *   przypisane do konta (lib/daneLokalne `zwiazDaneZKontem` skasuje je, jeśli
   *   zaloguje się ktoś inny). Wygaśnięcie co 30 dni nie może kasować ręcznie
   *   prowadzonego banku referencji.
   */
  const signOut = useCallback((opcje) => {
    if (wylogowanieWToku.current) return wylogowanieWToku.current;
    const przebieg = (async () => {
      if (opcje?.sesjaWygasla === true) {
        await deleteItem(TOKEN_KEY).catch(() => {});
        // Zapisany profil znika razem z tokenem — inaczej na urządzeniu zostałyby dane
        // poprzedniego użytkownika (e-mail, NIP), a kolejne konto zobaczyłoby je offline.
        await deleteItem(USER_KEY).catch(() => {});
      } else {
        await przeprowadzWylogowanie({
          storage,
          anulujPowiadomienia: anulujPowiadomieniaKonta,
        }).catch(() => {});
        setOnboardingPominiety(false);
      }
      setAuthToken(null);
      setUser(null);
    })().finally(() => { wylogowanieWToku.current = null; });
    wylogowanieWToku.current = przebieg;
    return przebieg;
  }, []);

  // Serwer odrzucił token w trakcie sesji (wygasł, zmieniono hasło) — wylogowujemy
  // z dowolnego ekranu. Bez tego apka zostawała na ekranie błędu, z którego nie
  // było wyjścia poza reinstalacją (audyt 2026-07-09).
  useEffect(() => {
    onSesjaWygasla(() => { signOut({ sesjaWygasla: true }); });
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
