import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const EKRANY = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'screens');
const zrodlo = (nazwa) => readFileSync(join(EKRANY, `${nazwa}.js`), 'utf8');

/*
 * P1-5 — ŚCIEŻKA WEJŚCIA MUSI BYĆ DWUJĘZYCZNA.
 *
 * `JezykProvider` wykrywa locale urządzenia przy PIERWSZYM uruchomieniu, więc
 * użytkownik z angielskim systemem dostaje angielski interfejs od razu. Dopóki
 * ekran powitalny, rejestracja i logowanie były wyłącznie polskie, obietnica
 * dwujęzyczności pękała dokładnie tam, gdzie zaczyna się korzystanie z aplikacji:
 * przełącznik języka mieszka w „Koncie", czyli ZA logowaniem, którego ktoś
 * niemówiący po polsku może nie przejść.
 *
 * Ten test czyta ŹRÓDŁO, bo to jedyny sposób, żeby wyłapać cichy powrót do
 * polskiego literału w nowo dopisanym przycisku.
 */
const SCIEZKA_WEJSCIA = [
  'LoginScreen',
  'RegisterScreen',
  'ForgotPasswordScreen',
  'ResetPasswordScreen',
  'WitajScreen',
  'SavedScreen',
  'PulpitScreen',
  'NarzedziaScreen',
];

/** Kod bez komentarzy i bez bloków stylów — tam polskie słowa są nazwami pól. */
function kodEkranu(nazwa) {
  const bezKomentarzy = zrodlo(nazwa)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const styl = bezKomentarzy.indexOf('const tworzStyle');
  return styl > 0 ? bezKomentarzy.slice(0, styl) : bezKomentarzy;
}

describe('ścieżka wejścia jest dwujęzyczna (P1-5)', () => {
  for (const ekran of SCIEZKA_WEJSCIA) {
    test(`${ekran} sięga po tłumacza`, () => {
      const kod = kodEkranu(ekran);
      assert.match(kod, /useJezyk/, `${ekran} nie importuje useJezyk — interfejs zostanie polski`);
      assert.match(kod, /\bt\(/, `${ekran} ma tłumacza, ale go nie używa`);
    });
  }

  test('żaden tekst widoczny dla użytkownika nie został jako goły polski literał', () => {
    /*
     * Szukamy polskich znaków w miejscach, które NA PEWNO trafiają na ekran:
     * treści między znacznikami oraz wartości `title`/`placeholder`/`label`/`hint`.
     * Literał w wywołaniu `t('…', '…')` jest w porządku — to pierwszy argument
     * tłumacza, nie tekst wstawiony na sztywno.
     */
    const naruszenia = [];
    for (const ekran of SCIEZKA_WEJSCIA) {
      const kod = kodEkranu(ekran);
      const wzorce = [
        /(?:title|placeholder|label|hint|accessibilityLabel)="([^"]*[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ][^"]*)"/g,
        />\s*([^<>{}\n]*[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ][^<>{}\n]*?)\s*</g,
      ];
      for (const wzorzec of wzorce) {
        for (const m of kod.matchAll(wzorzec)) {
          naruszenia.push(`${ekran}: ${m[1].trim().slice(0, 60)}`);
        }
      }
    }
    assert.deepEqual(naruszenia, [],
      'polski tekst wstawiony na sztywno — opakuj go w t(pl, en)');
  });

  test('strażnik pilnuje CAŁEJ ścieżki, a nie jednego ekranu', () => {
    // Bez tej asercji lista mogłaby się cicho skurczyć i test przestałby chronić.
    assert.ok(SCIEZKA_WEJSCIA.length >= 8);
    for (const ekran of SCIEZKA_WEJSCIA) assert.ok(zrodlo(ekran).length > 0);
  });
});
