import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * Globalna referencja do nawigatora — pozwala nawigować spoza drzewa Reacta
 * (z listenera powiadomień push, który żyje w App.js). Ustawiana na
 * `<NavigationContainer ref={navigationRef}>` w RootNavigator.
 */
export const navigationRef = createNavigationContainerRef();

/**
 * Wykonuje cel nawigacji (z `celPush`) na globalnym nawigatorze.
 *
 * Odporny na COLD START: gdy użytkownik dotyka powiadomienia przy zamkniętej
 * aplikacji, listener odpala się, zanim nawigator zdąży się zamontować
 * (`isReady() === false`). Zamiast zgubić dotknięcie, ponawiamy próbę co ~300 ms,
 * maksymalnie ~4,5 s. Gdy docelowy ekran nie jest zarejestrowany (np. użytkownik
 * niezalogowany — trasy przetargów wtedy nie istnieją), `navigate` łagodnie nic
 * nie robi, więc nie trzeba tu tego dodatkowo pilnować.
 *
 * @param {{ekran: string, params?: object}|null} cel wynik `celPush`
 * @param {{proby?: number, odstepMs?: number, setTimeoutFn?: Function}} [opts] wstrzykiwalne dla testów
 */
export function nawigujDoCelu(cel, opts = {}) {
  if (!cel || !cel.ekran) return;
  const { proby = 15, odstepMs = 300, setTimeoutFn = setTimeout } = opts;

  const sprobuj = (pozostalo) => {
    if (navigationRef.isReady()) {
      navigationRef.navigate(cel.ekran, cel.params ?? {});
      return;
    }
    if (pozostalo <= 0) return;
    setTimeoutFn(() => sprobuj(pozostalo - 1), odstepMs);
  };

  sprobuj(proby);
}
