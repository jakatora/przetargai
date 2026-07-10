import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/*
 * Trwałe przechowywanie tokenu sesji.
 *
 * `expo-secure-store` nie ma implementacji na web (rzuca UnavailabilityError),
 * a web jest nam potrzebny do testów E2E w przeglądarce. Na natywnych
 * platformach zostaje SecureStore (Keychain / Keystore); na web schodzimy do
 * localStorage.
 *
 * UWAGA: localStorage NIE jest bezpiecznym magazynem. Web służy wyłącznie do
 * developmentu i testów — nie jest kanałem dystrybucji tej aplikacji.
 */

const isWeb = Platform.OS === 'web';

export async function getItem(key) {
  if (isWeb) return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setItem(key, value) {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key) {
  if (isWeb) {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
