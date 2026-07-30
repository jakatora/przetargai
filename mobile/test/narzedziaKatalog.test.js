import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KATALOG_NARZEDZI } from '../src/lib/narzedziaKatalog.js';

// Ekrany zarejestrowane w RootNavigator (branża zalogowana) — hub może kierować TYLKO tu.
const EKRANY = new Set([
  'MatchFeed', 'MatchDetail', 'WynikKontroli', 'PrzeswietlenieUmowy', 'RadarSwz', 'Sejf',
  'RejestratorOferty', 'SymulatorPlynnosci', 'ZabezpieczenieZwrot', 'PodprogoweDetail',
  'PodprogoweUstawienia', 'Kreator118', 'KrokDanePodmiotu', 'BankReferencji', 'StraznikWezwania',
  'KalkulatorPunktow', 'KontrolerGwarancji', 'ObronaCeny', 'TerminZwiazania', 'WizjaLokalna',
  'Konsorcjum', 'CertyfikatWykonawcy', 'Tajemnica', 'Samooczyszczenie', 'KalkulatorTerminow',
  'KalendarzTerminow', 'SciezkaDoOferty', 'KalkulatorCeny', 'SymulatorPunktacji', 'KaryUmowne',
  'KalkulatorOdsetek', 'KartaDecyzji', 'Pulpit', 'KontrolaOferty', 'SprawdzarkaCeny', 'Saved', 'Account',
]);

test('każde narzędzie ma niepusty tytuł i ekran istniejący w nawigatorze', () => {
  for (const kat of KATALOG_NARZEDZI) {
    assert.ok(kat.kategoria && kat.narzedzia.length, `kategoria „${kat.kategoria}" pusta`);
    for (const n of kat.narzedzia) {
      assert.ok(n.tytul && n.tytul.length, 'narzędzie bez tytułu');
      assert.ok(EKRANY.has(n.ekran), `nieznany ekran w katalogu: ${n.ekran} (${n.tytul})`);
    }
  }
});

test('brak zdublowanych ekranów w katalogu', () => {
  const ekrany = KATALOG_NARZEDZI.flatMap((k) => k.narzedzia.map((n) => n.ekran));
  assert.equal(new Set(ekrany).size, ekrany.length, 'katalog ma zdublowane wpisy');
});
