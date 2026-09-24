import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { NativeModules, Platform } from 'react-native';
import * as storage from '../lib/storage';
import {
  JEZYK_DOMYSLNY, JEZYKI, KLUCZ_JEZYKA, ETYKIETY_JEZYKOW,
  normalizujJezyk, wykryjJezyk, tworzTlumacza,
} from '../lib/jezyk';

/*
 * Dostawca języka interfejsu. Cała logika wyboru wariantu żyje w lib/jezyk.js
 * (czysta, testowana) — tutaj tylko sklejenie z Reactem i trwałość wyboru.
 *
 * Wybór jest lokalny dla urządzenia, nie w profilu na backendzie: język
 * interfejsu to cecha osoby patrzącej w ekran, a nie firmy, która ma konto.
 *
 * Domyślnie POLSKI. Język systemu bierzemy pod uwagę tylko przy pierwszym
 * uruchomieniu i tylko wtedy, gdy to angielski — reszta świata dostaje polski,
 * bo dokumenty przetargowe, z którymi ta aplikacja pracuje, są polskie.
 */

const JezykContext = createContext(null);

/** Locale urządzenia bez dokładania zależności — `expo-localization` nie jest tu potrzebny. */
function localeUrzadzenia() {
  try {
    if (Platform.OS === 'ios') {
      return NativeModules.SettingsManager?.settings?.AppleLocale
        ?? NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        ?? null;
    }
    if (Platform.OS === 'android') return NativeModules.I18nManager?.localeIdentifier ?? null;
    return globalThis.navigator?.language ?? null;
  } catch {
    return null;
  }
}

export function JezykProvider({ children }) {
  const [jezyk, setJezyk] = useState(JEZYK_DOMYSLNY);

  useEffect(() => {
    let aktywny = true;
    storage.getItem(KLUCZ_JEZYKA)
      .then((zapisany) => {
        if (!aktywny) return;
        // Brak zapisu = pierwsze uruchomienie: dopiero wtedy pytamy system.
        setJezyk(zapisany ? normalizujJezyk(zapisany) : wykryjJezyk(localeUrzadzenia()));
      })
      .catch(() => {});
    return () => { aktywny = false; };
  }, []);

  const ustawJezyk = useCallback((nowy) => {
    const kod = normalizujJezyk(nowy);
    setJezyk(kod);
    storage.setItem(KLUCZ_JEZYKA, kod).catch(() => {});
  }, []);

  const wartosc = useMemo(() => ({
    jezyk,
    jezyki: JEZYKI,
    etykiety: ETYKIETY_JEZYKOW,
    ustawJezyk,
    // `t({pl,en})` albo `t('Dla mnie', 'For me')` — obie formy w jednym wywołaniu.
    t: tworzTlumacza(jezyk),
  }), [jezyk, ustawJezyk]);

  return <JezykContext.Provider value={wartosc}>{children}</JezykContext.Provider>;
}

/**
 * Języka używają też ekrany renderowane poza drzewem dostawcy (testy, podglądy),
 * więc brak kontekstu NIE jest błędem — schodzimy na polski tłumacz.
 */
export function useJezyk() {
  return useContext(JezykContext) ?? {
    jezyk: JEZYK_DOMYSLNY,
    jezyki: JEZYKI,
    etykiety: ETYKIETY_JEZYKOW,
    ustawJezyk: () => {},
    t: tworzTlumacza(JEZYK_DOMYSLNY),
  };
}
