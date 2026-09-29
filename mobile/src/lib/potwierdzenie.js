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
export function potwierdzAkcje({ tytul, tresc, etykietaTak, onTak }, { platforma, alert, confirm }) {
  if (platforma === 'web') {
    if (confirm(`${tytul}\n\n${tresc}`)) onTak();
    return;
  }
  alert(tytul, tresc, [
    { text: 'Anuluj', style: 'cancel' },
    { text: etykietaTak, style: 'destructive', onPress: () => onTak() },
  ]);
}
