import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Detektor KLAUZULI WALORYZACYJNEJ `wykryj_klauzule_waloryzacyjna` — podzadanie
 * 3/12 ulepszenia „pilnowanie waloryzacji i pułapek w umowie". Czysta funkcja,
 * testy jednostkowe (bez serwera) na realistycznych fragmentach klauzul Pzp
 * (art. 439). Sprawdzamy zarówno „szczęśliwą ścieżkę" (obecna + próg + limit),
 * jak i ADWERSARYJNIE: że limit kar umownych ani VAT nie zostaną wzięte za
 * limit waloryzacji (dlatego detektor skanuje % tylko w zasięgu klauzuli).
 */

const { wykryj_klauzule_waloryzacyjna } = await import('../src/lib/umowaWaloryzacja.js');

const KLAUZULA_PELNA = `
§ 12. Waloryzacja wynagrodzenia.
Strony przewidują zmianę wysokości wynagrodzenia w przypadku zmiany ceny
materiałów lub kosztów związanych z realizacją zamówienia. Poziom zmiany ceny
materiałów lub kosztów uprawniający do żądania zmiany wynagrodzenia strony
ustalają na 10%. Maksymalna łączna wartość zmiany wynagrodzenia w wyniku
waloryzacji nie przekroczy 20% wynagrodzenia brutto. Podstawą waloryzacji jest
wskaźnik cen towarów i usług ogłaszany przez GUS.
`;

test('wykrywa klauzulę oraz odczytuje próg i limit', () => {
  const r = wykryj_klauzule_waloryzacyjna(KLAUZULA_PELNA);
  assert.equal(r.obecna, true);
  assert.equal(r.prog, 10);
  assert.equal(r.limit, 20);
  assert.match(r.opis, /Wykryto klauzulę waloryzacyjną/);
});

test('rozpoznaje po art. 439 nawet bez słowa „waloryzacja", odczytuje sam próg', () => {
  const t = 'Zgodnie z art. 439 ustawy Pzp strony dopuszczają zmianę wynagrodzenia, '
    + 'jeżeli wskaźnik zmiany cen materiałów przekroczy 8% w stosunku do dnia zawarcia umowy.';
  const r = wykryj_klauzule_waloryzacyjna(t);
  assert.equal(r.obecna, true);
  assert.equal(r.prog, 8);
  assert.equal(r.limit, null);
  assert.match(r.opis, /8%/);
});

test('brak klauzuli → obecna=false, prog/limit null, opis o obowiązku >6 mies. i art. 439', () => {
  const t = 'Umowa na dostawę materiałów biurowych. Termin realizacji 3 miesiące. '
    + 'Wynagrodzenie ryczałtowe 50 000 zł. VAT 23%. Kara umowna za zwłokę 0,2% za '
    + 'każdy dzień, nie więcej niż 20% wartości umowy.';
  const r = wykryj_klauzule_waloryzacyjna(t);
  assert.equal(r.obecna, false);
  assert.equal(r.prog, null);
  assert.equal(r.limit, null);
  assert.match(r.opis, /6 miesięcy/);
  assert.match(r.opis, /439/);
});

test('klauzula obecna, ale opisowa (bez liczb) → prog/limit null, opis prosi o weryfikację', () => {
  const t = 'Strony przewidują waloryzację wynagrodzenia na zasadach określonych w '
    + 'odrębnym porozumieniu, w oparciu o wskaźniki publikowane przez GUS. '
    + 'Szczegółowy tryb zostanie ustalony po podpisaniu umowy.';
  const r = wykryj_klauzule_waloryzacyjna(t);
  assert.equal(r.obecna, true);
  assert.equal(r.prog, null);
  assert.equal(r.limit, null);
  assert.match(r.opis, /progu/);
  assert.match(r.opis, /limitu/);
});

test('ADWERSARYJNIE: nie myli limitu kar umownych z limitem waloryzacji (skoping do klauzuli)', () => {
  const t = 'Kary umowne. Wykonawca zapłaci karę umowną za zwłokę w wysokości 0,5% '
    + 'wynagrodzenia za każdy dzień opóźnienia, przy czym łączna wysokość kar '
    + 'umownych nie przekroczy 20% wynagrodzenia. '
    + 'Postanowienia ogólne dotyczące realizacji, odbiorów częściowych i końcowych, '
    + 'zabezpieczenia należytego wykonania umowy oraz obowiązków stron. '.repeat(3)
    + '§ 15. Klauzula waloryzacyjna. Wynagrodzenie podlega zmianie, gdy poziom '
    + 'zmiany cen materiałów przekroczy 12%.';
  const r = wykryj_klauzule_waloryzacyjna(t);
  assert.equal(r.obecna, true);
  assert.equal(r.prog, 12);
  assert.equal(r.limit, null, 'limit kar (20%) jest poza zasięgiem klauzuli waloryzacyjnej');
});

test('odczytuje ułamek dziesiętny w progu i słowo „procent" w limicie', () => {
  const t = 'Waloryzacja przysługuje, gdy wskaźnik cen wzrośnie o więcej niż 5,5%. '
    + 'Łączna waloryzacja nie może przekroczyć 15 procent wynagrodzenia.';
  const r = wykryj_klauzule_waloryzacyjna(t);
  assert.equal(r.obecna, true);
  assert.equal(r.prog, 5.5);
  assert.equal(r.limit, 15);
  assert.match(r.opis, /5,5%/);
});

test('ADWERSARYJNIE: drugi zapis limitowy nie wycieka do progu (klasyfikacja rozłączna)', () => {
  // Klauzula z DWOMA zdaniami o limicie i bez progu — „przekrocz" w drugim
  // zdaniu to nadal limit, nie może zostać wzięte za próg uruchomienia.
  const t = 'Klauzula waloryzacyjna. Łączna wartość waloryzacji nie przekroczy 20% '
    + 'wynagrodzenia. W żadnym wypadku zmiana wynagrodzenia nie przekroczy 20%.';
  const r = wykryj_klauzule_waloryzacyjna(t);
  assert.equal(r.obecna, true);
  assert.equal(r.limit, 20);
  assert.equal(r.prog, null, 'brak progu — drugi limit nie może go udawać');
});

test('wejście puste/null/undefined → obecna=false, bez wyjątku', () => {
  for (const w of [null, undefined, '', '    ', 123]) {
    const r = wykryj_klauzule_waloryzacyjna(w);
    assert.equal(r.obecna, false, `dla wejścia ${JSON.stringify(w)}`);
    assert.equal(r.prog, null);
    assert.equal(r.limit, null);
    assert.equal(typeof r.opis, 'string');
  }
});
