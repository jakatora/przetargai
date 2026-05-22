import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, setAuthToken } from '../api/client';
import { registerForPushNotifications } from '../services/push';

const TOKEN_KEY = 'przetargai_token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);

  // Odtworzenie sesji przy starcie aplikacji.
  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY);
        if (token) {
          setAuthToken(token);
          const data = await api.getMe();
          setUser(data.user);
        }
      } catch {
        // Token nieważny / błąd — czyścimy sesję.
        await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
        setAuthToken(null);
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  const persistSession = useCallback(async (token, userData) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setAuthToken(token);
    setUser(userData);
    // Rejestracja push w tle — nie blokuje logowania.
    registerForPushNotifications()
      .then((pushToken) => {
        if (pushToken) api.setPushToken(pushToken).catch(() => {});
      })
      .catch(() => {});
  }, []);

  const signIn = useCallback(async (email, password) => {
    const data = await api.login({ email, password });
    await persistSession(data.token, data.user);
  }, [persistSession]);

  const signUp = useCallback(async (payload) => {
    const data = await api.register(payload);
    await persistSession(data.token, data.user);
  }, [persistSession]);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    setAuthToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await api.getMe();
    setUser(data.user);
    return data.user;
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, restoring, signIn, signUp, signOut, refreshUser, setUser }}
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
