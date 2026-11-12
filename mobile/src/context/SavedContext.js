import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

/*
 * Zakładki („Zapisane") — trzymamy w jednym miejscu ZBIÓR zapisanych identyfikatorów,
 * żeby ikona zakładki na karcie feedu i na szczegółach zawsze pokazywała aktualny stan,
 * a przełączanie było natychmiastowe (optymistyczne) niezależnie od ekranu.
 */

const SavedContext = createContext(null);

function odczytaneIds(data) {
  if (!Array.isArray(data?.ids)) throw new Error('Nie udało się odczytać zapisanych przetargów.');
  return new Set(data.ids);
}

export function SavedProvider({ children }) {
  const { user } = useAuth();
  // Zmiana konta tworzy nowy stan PRZED renderem dzieci. Sam efekt
  // czyszczący po renderze pokazywałby na chwilę zapisane poprzedniej osoby.
  return <SavedAccountProvider key={user?.id ?? 'signed-out'} userId={user?.id}>{children}</SavedAccountProvider>;
}

function SavedAccountProvider({ userId, children }) {
  const [ids, setIds] = useState(() => new Set());
  // Czy zbiór pochodzi z serwera. Po nieudanym starcie (słaba sieć) pusty zbiór NIE znaczy „nic nie
  // zapisano” — przełącznik na ★ wysłałby zapis zamiast usunięcia (audyt 2026-11-10).
  const [wczytane, setWczytane] = useState(false);

  // Wszystkie odczyty i mutacje korzystają z jednej kolejki konta.
  // Spóźniony refresh nie może nadpisać nowszego zapisu; dwie karty
  // tego samego przetargu nie mogą wysłać sprzecznych operacji równolegle.
  const current = useRef({ ids: new Set(), ready: false });
  const pending = useRef(Promise.resolve());
  const active = useRef(true);
  const serial = useCallback((operation) => {
    const result = pending.current.then(() => {
      if (!active.current) throw new Error('Konto zostało zmienione. Odśwież dane ponownie.');
      return operation();
    });
    pending.current = result.catch(() => {});
    return result;
  }, []);
  const publish = useCallback((nextIds, ready) => {
    current.current = { ids: nextIds, ready };
    setIds(nextIds); setWczytane(ready);
  }, []);

  /**
   * Zapisz / usuń z zakładek. Optymistycznie zmienia ikonę, a przy błędzie
   * cofa zmianę — użytkownik nie zobaczy „zapisano", jeśli serwer odrzucił.
   * @returns {Promise<boolean>} nowy stan (true = zapisany)
   */
  const toggle = useCallback((tenderId, desired) => serial(async () => {
    if (!userId) throw new Error('Zaloguj się, aby zapisać przetarg.');
    let aktualne = current.current.ids;
    if (!current.current.ready) {
      // Nie zgaduj operacji po błędzie odczytu: pusty lokalny zbiór nie
      // oznacza, że przetarg nie jest już zapisany na serwerze.
      const d = await api.getSavedIds();
      aktualne = odczytaneIds(d); publish(aktualne, true);
    }
    if (!active.current) throw new Error('Konto zostało zmienione. Odśwież dane ponownie.');
    const byloZapisane = aktualne.has(tenderId);
    // Akcje „Biorę”, „Zapisz” i „Usuń” przekazują zamiar. Dociągnięcie
    // stanu po offline nie może odwrócić żądanej operacji.
    const bedzieZapisane = typeof desired === 'boolean' ? desired : !byloZapisane;
    if (bedzieZapisane === byloZapisane) return bedzieZapisane;
    const next = new Set(aktualne);
    if (bedzieZapisane) next.add(tenderId); else next.delete(tenderId);
    publish(next, true);
    try {
      if (bedzieZapisane) await api.saveTender(tenderId);
      else await api.unsaveTender(tenderId);
      return bedzieZapisane;
    } catch (err) {
      publish(aktualne, true);
      throw err;
    }
  }), [serial, publish, userId]);

  /** Wymuszone odświeżenie (np. po wejściu na ekran „Zapisane"). */
  const refresh = useCallback(() => serial(async () => {
    if (!userId) return false;
    try {
      const d = await api.getSavedIds();
      publish(odczytaneIds(d), true);
      return true;
    } catch { publish(current.current.ids, false); return false; }
  }), [serial, publish, userId]);

  useEffect(() => {
    active.current = true;
    if (userId) void refresh().catch(() => {});
    return () => { active.current = false; };
  }, [userId, refresh]);

  const wartosc = useMemo(() => ({
    isSaved: (id) => ids.has(id),
    liczba: ids.size,
    ready: wczytane,
    toggle,
    refresh,
  }), [ids, wczytane, toggle, refresh]);

  return <SavedContext.Provider value={wartosc}>{children}</SavedContext.Provider>;
}

export function useSaved() {
  const ctx = useContext(SavedContext);
  if (!ctx) throw new Error('useSaved wymaga <SavedProvider> wyżej w drzewie');
  return ctx;
}
