import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import * as storage from '../lib/storage';
import { PALETY, normalizujPreferencje, wybierzSchemat } from '../lib/motyw';

/*
 * Dostawca motywu. Cała logika wyboru schematu żyje w lib/motyw.js (czysta,
 * testowana) — tutaj tylko sklejenie z Reactem: preferencja z magazynu,
 * schemat systemowy z useColorScheme, memoizacja arkuszy stylów.
 *
 * Preferencja jest lokalna dla urządzenia (nie w profilu na backendzie):
 * wygląd to cecha urządzenia, nie konta — telefon może być ciemny, tablet jasny.
 */

const KLUCZ_MAGAZYNU = 'przetargai.motyw';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const systemowy = useColorScheme(); // 'light' | 'dark' | null; nasłuchuje zmian
  const [preferencja, setPreferencja] = useState('system');

  useEffect(() => {
    let aktywny = true;
    storage.getItem(KLUCZ_MAGAZYNU)
      .then((zapisana) => { if (aktywny) setPreferencja(normalizujPreferencje(zapisana)); })
      .catch(() => {}); // brak zapisu = zostaje 'system'
    return () => { aktywny = false; };
  }, []);

  const ustawPreferencje = useCallback((nowa) => {
    const znormalizowana = normalizujPreferencje(nowa);
    setPreferencja(znormalizowana);
    storage.setItem(KLUCZ_MAGAZYNU, znormalizowana).catch(() => {});
  }, []);

  const schemat = wybierzSchemat(preferencja, systemowy);

  const wartosc = useMemo(() => ({
    schemat,                       // 'jasny' | 'ciemny' — rozstrzygnięty
    preferencja,                   // 'system' | 'jasny' | 'ciemny' — wybór usera
    kolory: PALETY[schemat],
    ustawPreferencje,
  }), [schemat, preferencja, ustawPreferencje]);

  return <ThemeContext.Provider value={wartosc}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme wymaga <ThemeProvider> wyżej w drzewie');
  return ctx;
}

/**
 * Arkusz stylów zależny od palety: `const styles = useStyle(tworzStyle)`,
 * gdzie `tworzStyle = (kolory) => StyleSheet.create({...})`.
 * Cache per (fabryka × schemat) — przełączenie motywu tworzy arkusz raz,
 * kolejne rendery dostają ten sam obiekt (bez rewalidacji stylów w RN).
 */
export function useStyle(fabryka) {
  const { schemat, kolory } = useTheme();
  const cache = useRef(new Map());
  const klucz = schemat;
  if (!cache.current.has(klucz)) cache.current.set(klucz, fabryka(kolory));
  return cache.current.get(klucz);
}

/** Do rzadkich miejsc poza Reactem (np. opcje nawigatora budowane w komponencie). */
export { PALETY };

/* Wygodny alias, żeby ekrany nie musiały ręcznie składać StyleSheet.create. */
export function tworzStyle(fabryka) {
  return (kolory) => StyleSheet.create(fabryka(kolory));
}
