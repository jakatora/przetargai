/**
 * Reguły walidacji zmiany hasła i e-maila (czyste, testowalne bez renderera).
 * Ekran `BezpieczenstwoKontaScreen` tylko je woła. Reguła siły hasła (min. 8 znaków)
 * jest lustrem walidacji backendu — spójny komunikat po obu stronach.
 */

const MIN_HASLO = 8;
// Ten sam pragmatyczny wzorzec, którego używa reszta apki do adresów e-mail.
const WZORZEC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Ocenia nowe hasło razem z jego powtórzeniem.
 * @returns {{poprawne: boolean, komunikat: string}}
 */
export function ocenHaslo(nowe, powtorzenie) {
  const h = typeof nowe === 'string' ? nowe : '';
  if (h.length < MIN_HASLO) {
    return { poprawne: false, komunikat: `Nowe hasło musi mieć min. ${MIN_HASLO} znaków.` };
  }
  if (h !== powtorzenie) {
    return { poprawne: false, komunikat: 'Powtórzone hasło nie jest takie samo.' };
  }
  return { poprawne: true, komunikat: 'Hasło wygląda dobrze.' };
}

/**
 * Waliduje zmianę adresu e-mail. Zwraca znormalizowany (lowercase, trim) adres,
 * gdy jest poprawny, różny od obecnego i niepusty.
 * @returns {{poprawne: boolean, email: string, komunikat: string}}
 */
export function walidujZmianeEmaila(nowy, obecny) {
  const email = String(nowy ?? '').toLowerCase().trim();
  if (!email) {
    return { poprawne: false, email: '', komunikat: 'Podaj nowy adres e-mail.' };
  }
  if (!WZORZEC_EMAIL.test(email)) {
    return { poprawne: false, email, komunikat: 'To nie wygląda na poprawny adres e-mail.' };
  }
  if (email === String(obecny ?? '').toLowerCase().trim()) {
    return { poprawne: false, email, komunikat: 'To jest już Twój aktualny adres e-mail.' };
  }
  return { poprawne: true, email, komunikat: 'Adres wygląda dobrze.' };
}
