import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  'Narzedzia', 'PrzewodnikStartu', 'ZapisaneWyszukiwania', 'CentrumAlertow',
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

test('lista ekranów w tym teście nie rozjeżdża się z nawigatorem', () => {
  /*
   * `EKRANY` to ręczna kopia nazw tras z RootNavigator — i właśnie dlatego może
   * skłamać w DRUGĄ stronę: ktoś usuwa albo przemianowuje ekran, a strażnik nadal
   * uznaje starą nazwę za poprawną i przepuszcza martwe wejście w hubie. Ten test
   * czyta nawigator i pilnuje, że każda nazwa z listy realnie tam jest.
   */
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const nawigator = fs.readFileSync(path.resolve(__dirname, '../src/navigation/RootNavigator.js'), 'utf8');
  const zarejestrowane = new Set([...nawigator.matchAll(/name="(\w+)"/g)].map((m) => m[1]));

  for (const ekran of EKRANY) {
    assert.ok(zarejestrowane.has(ekran), `„${ekran}" jest na liście testu, ale nie ma go w RootNavigator`);
  }
});
