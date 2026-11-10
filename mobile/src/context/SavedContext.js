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
  // Czy zbiór pochodzi z serwera. Po nieudanym starcie (słaba sieć) pusty zbiór NIE znaczy „nic nie
  // zapisano” — przełącznik na ★ wysłałby zapis zamiast usunięcia (audyt 2026-11-10).
  const [wczytane, setWczytane] = useState(false);

  // Wczytanie zapisanych po zalogowaniu (i wyczyszczenie po wylogowaniu).
  useEffect(() => {
    let aktywny = true;
    if (!user) { setIds(new Set()); setWczytane(false); return undefined; }
    api.getSavedIds()
      .then((d) => { if (aktywny) { setIds(new Set(d.ids || [])); setWczytane(true); } })
      .catch(() => { if (aktywny) setWczytane(false); }); // offline — dociągniemy przy pierwszym przełączeniu
    return () => { aktywny = false; };
  }, [user?.id]);

  /**
   * Zapisz / usuń z zakładek. Optymistycznie zmienia ikonę, a przy błędzie
   * cofa zmianę — użytkownik nie zobaczy „zapisano", jeśli serwer odrzucił.
   * @returns {Promise<boolean>} nowy stan (true = zapisany)
   */
  const toggle = useCallback(async (tenderId) => {
    let aktualne = ids;
    if (!wczytane) {
      // Nie zgaduj operacji po błędzie odczytu: pusty lokalny zbiór nie
      // oznacza, że przetarg nie jest już zapisany na serwerze.
      const d = await api.getSavedIds();
      if (!Array.isArray(d?.ids)) throw new Error('Nie udało się odczytać zapisanych przetargów.');
      aktualne = new Set(d.ids); setIds(aktualne); setWczytane(true);
    }
    const byloZapisane = aktualne.has(tenderId);
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
  }, [ids, wczytane]);

  /** Wymuszone odświeżenie (np. po wejściu na ekran „Zapisane"). */
  const refresh = useCallback(async () => {
    const d = await api.getSavedIds().catch(() => null);
    if (d) { setIds(new Set(d.ids || [])); setWczytane(true); }
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
