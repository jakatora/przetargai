/**
 * Okno potwierdzenia, które działa także w przeglądarce (audyt 2026-09-29).
 *
 * react-native-web implementuje `Alert.alert` jako PUSTĄ funkcję — na webie okno się
 * nie pokazuje, a akcja po „Tak" nigdy nie rusza (tak było z „Wyloguj się"). Na webie
 * pytamy więc przez `window.confirm`, natywnie — przez `Alert.alert`.
 *
 * Czysta logika: platforma i oba mechanizmy są wstrzykiwane (ekran podaje
 * `Platform.OS`, `Alert.alert`, `globalThis.confirm`), więc da się to przetestować
 * bez renderera.
 *
 * @param {{tytul: string, tresc: string, etykietaTak: string, onTak: () => void}} pytanie
 * @param {{platforma: string, alert: Function, confirm: Function}} srodowisko
 */
export function potwierdzAkcje({ tytul, tresc, etykietaTak, etykietaNie = 'Anuluj', onTak }, { platforma, alert, confirm }) {
  if (platforma === 'web') {
    if (confirm(`${tytul}\n\n${tresc}`)) onTak();
    return;
  }
  alert(tytul, tresc, [
    { text: etykietaNie, style: 'cancel' },
    { text: etykietaTak, style: 'destructive', onPress: () => onTak() },
  ]);
}

/**
 * Wybór jednej z kilku opcji (np. „co zawiodło?" w Rejestratorze). `window.confirm`
 * umie tylko tak/nie, więc na webie opcje oddajemy ekranowi (`pokazWLinii`), który
 * rysuje je jako przyciski w treści; natywnie zostaje `Alert.alert` z przyciskami.
 *
 * @param {{tytul: string, tresc: string, opcje: Array<{etykieta: string, onWybor: () => void}>}} pytanie
 * @param {{platforma: string, alert: Function, pokazWLinii: (opcje: Array) => void}} srodowisko
 */
export function wybierzOpcje({ tytul, tresc, opcje }, { platforma, alert, pokazWLinii }) {
  if (platforma === 'web') {
    pokazWLinii(opcje);
    return;
  }
  alert(tytul, tresc, [
    { text: 'Anuluj', style: 'cancel' },
    ...opcje.map((o) => ({ text: o.etykieta, onPress: () => o.onWybor() })),
  ]);
}

/**
 * Komunikat jednoprzyciskowy (np. „Nie udało się …"). Na webie `window.alert`,
 * natywnie `Alert.alert` — bez tego błędy akcji na webie były niewidoczne.
 * @param {{tytul: string, tresc?: string}} komunikat
 * @param {{platforma: string, alert: Function, webAlert: Function}} srodowisko
 */
export function pokazKomunikat({ tytul, tresc }, { platforma, alert, webAlert }) {
  if (platforma === 'web') {
    webAlert(tresc ? `${tytul}\n\n${tresc}` : tytul);
    return;
  }
  if (tresc === undefined) alert(tytul);
  else alert(tytul, tresc);
}
