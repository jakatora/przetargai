import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

/*
 * Zakładki („Zapisane") — trzymamy w jednym miejscu ZBIÓR zapisanych identyfikatorów,
 * żeby ikona zakładki na karcie feedu i na szczegółach zawsze pokazywała aktualny stan,
 * a przełączanie było natychmiastowe (optymistyczne) niezależnie od ekranu.
 */

const SavedContext = createContext(null);

export function SavedProvider({ children }) {
  const { user } = useAuth();
  const [ids, setIds] = useState(() => new Set());

  // Wczytanie zapisanych po zalogowaniu (i wyczyszczenie po wylogowaniu).
  useEffect(() => {
    let aktywny = true;
    if (!user) { setIds(new Set()); return undefined; }
    api.getSavedIds()
      .then((d) => { if (aktywny) setIds(new Set(d.ids || [])); })
      .catch(() => {}); // brak zapisanych / offline — zostaje pusty zbiór
    return () => { aktywny = false; };
  }, [user?.id]);

  /**
   * Zapisz / usuń z zakładek. Optymistycznie zmienia ikonę, a przy błędzie
   * cofa zmianę — użytkownik nie zobaczy „zapisano", jeśli serwer odrzucił.
   * @returns {Promise<boolean>} nowy stan (true = zapisany)
   */
  const toggle = useCallback(async (tenderId) => {
    const byloZapisane = ids.has(tenderId);
    setIds((prev) => {
      const nast = new Set(prev);
      if (byloZapisane) nast.delete(tenderId); else nast.add(tenderId);
      return nast;
    });
    try {
      if (byloZapisane) await api.unsaveTender(tenderId);
      else await api.saveTender(tenderId);
      return !byloZapisane;
    } catch (err) {
      setIds((prev) => { // cofnij
        const nast = new Set(prev);
        if (byloZapisane) nast.add(tenderId); else nast.delete(tenderId);
        return nast;
      });
      throw err;
    }
  }, [ids]);

  /** Wymuszone odświeżenie (np. po wejściu na ekran „Zapisane"). */
  const refresh = useCallback(async () => {
    const d = await api.getSavedIds().catch(() => null);
    if (d) setIds(new Set(d.ids || []));
  }, []);

  const wartosc = useMemo(() => ({
    isSaved: (id) => ids.has(id),
    liczba: ids.size,
    toggle,
    refresh,
  }), [ids, toggle, refresh]);

  return <SavedContext.Provider value={wartosc}>{children}</SavedContext.Provider>;
}

export function useSaved() {
  const ctx = useContext(SavedContext);
  if (!ctx) throw new Error('useSaved wymaga <SavedProvider> wyżej w drzewie');
  return ctx;
}
