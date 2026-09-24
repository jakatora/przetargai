import { test } from 'node:test';
import assert from 'node:assert/strict';
import { potwierdzenieEksportu, komunikatWyniku, komunikatBledu } from '../src/lib/eksport.js';

test('potwierdzenie mówi, CO i DOKĄD pójdzie', () => {
  assert.match(potwierdzenieEksportu('zapisane', 'firma@x.pl', 'pl'), /zapisanych przetargów.*firma@x\.pl/s);
  assert.match(potwierdzenieEksportu('katalog', 'firma@x.pl', 'en'), /catalogue.*firma@x\.pl/s);
  assert.match(potwierdzenieEksportu('katalog', null, 'pl'), /Twój adres e-mail/);
});

test('wynik: odmiana pozycji, obcięcie, tryb degradacji', () => {
  assert.equal(komunikatWyniku({ wyslano: true, do: 'a@b.pl', wierszy: 1, obciety: false }, 'pl'),
    'Wysłaliśmy plik z 1 pozycją na a@b.pl. Otwórz go w Excelu dwuklikiem.');
  assert.equal(komunikatWyniku({ wyslano: true, do: 'a@b.pl', wierszy: 3, obciety: false }, 'pl'),
    'Wysłaliśmy plik z 3 pozycjami na a@b.pl. Otwórz go w Excelu dwuklikiem.');
  assert.match(komunikatWyniku({ wyslano: true, do: 'a@b.pl', wierszy: 500, obciety: true }, 'pl'), /500 pozycjami.*zawęź filtry/s);
  assert.match(komunikatWyniku({ wyslano: false, tryb_degradacji: true }, 'pl'), /chwilowo niedostępna/);
  assert.equal(komunikatWyniku({ wyslano: true, do: 'a@b.pl', wierszy: 2, obciety: false }, 'en'),
    'We sent a file with 2 rows to a@b.pl. Open it in Excel with a double click.');
});

test('błąd: limit (429) pokazuje komunikat serwera, sieć — prośbę o ponowienie', () => {
  assert.equal(komunikatBledu({ status: 429, message: 'Dzienny limit wysyłek eksportu (10) wyczerpany — spróbuj jutro.' }, 'pl'),
    'Dzienny limit wysyłek eksportu (10) wyczerpany — spróbuj jutro.');
  assert.match(komunikatBledu({ status: 0, message: 'x' }, 'pl'), /Brak połączenia/);
  assert.match(komunikatBledu({ status: 503, message: 'Nie udało się wysłać' }, 'pl'), /Nie udało się wysłać/);
});
