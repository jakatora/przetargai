import { Alert, Platform } from 'react-native';
import { pokazKomunikat } from '../lib/potwierdzenie';

/**
 * Środowisko dla lib/potwierdzenie.js: platforma + Alert (natywnie) + window.confirm
 * (web — w react-native-web `Alert.alert` jest pustą funkcją).
 * @param {{pokazWLinii?: (opcje: Array) => void}} [dodatki]
 */
export function srodowiskoPotwierdzen(dodatki = {}) {
  return {
    platforma: Platform.OS,
    alert: (...argumenty) => Alert.alert(...argumenty),
    confirm: (tekst) => globalThis.confirm?.(tekst) === true,
    webAlert: (tekst) => globalThis.alert?.(tekst),
    ...dodatki,
  };
}

/** Komunikat działający także na webie: `komunikat('Błąd', err.message)`. */
export function komunikat(tytul, tresc) {
  pokazKomunikat({ tytul, tresc }, srodowiskoPotwierdzen());
}
