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

/*
 * REGUŁA OSTRZEŻENIA — podzadanie 4/12. Gdy szacowany czas trwania umowy jest
 * dłuższy niż 6 miesięcy, a klauzuli waloryzacyjnej BRAK, klauzula jest
 * obowiązkowa (art. 439 Pzp) — detektor zwraca wtedy CZERWONĄ flagę w polu
 * `ostrzezenie`. W pozostałych przypadkach (klauzula jest / umowa ≤ 6 mies. /
 * czas trwania nieznany) `ostrzezenie` to `null` — nie zgłaszamy naruszenia,
 * którego nie możemy potwierdzić.
 */

const UMOWA_BEZ_KLAUZULI = 'Umowa na świadczenie usług sprzątania. Wynagrodzenie '
  + 'ryczałtowe 8 000 zł miesięcznie. Kara umowna za zwłokę 0,2% za każdy dzień.';

test('umowa > 6 miesięcy bez klauzuli → czerwona flaga „brak obowiązkowej klauzuli (Pzp)"', () => {
  const r = wykryj_klauzule_waloryzacyjna(UMOWA_BEZ_KLAUZULI, 12);
  assert.equal(r.obecna, false);
  assert.ok(r.ostrzezenie, 'ostrzezenie powinno być obecne');
  assert.equal(r.ostrzezenie.poziom, 'czerwony');
  assert.equal(r.ostrzezenie.tytul, 'brak obowiązkowej klauzuli (Pzp)');
  assert.match(r.ostrzezenie.opis, /439/);
});

test('umowa > 6 miesięcy, ale klauzula JEST → ostrzezenie null (obowiązek spełniony)', () => {
  const r = wykryj_klauzule_waloryzacyjna(KLAUZULA_PELNA, 24);
  assert.equal(r.obecna, true);
  assert.equal(r.ostrzezenie, null);
});

test('dokładnie 6 miesięcy bez klauzuli → ostrzezenie null (obowiązek dotyczy umów DŁUŻSZYCH niż 6 mies.)', () => {
  const r = wykryj_klauzule_waloryzacyjna(UMOWA_BEZ_KLAUZULI, 6);
  assert.equal(r.obecna, false);
  assert.equal(r.ostrzezenie, null);
});

test('krótka umowa (3 mies.) bez klauzuli → ostrzezenie null', () => {
  const r = wykryj_klauzule_waloryzacyjna(UMOWA_BEZ_KLAUZULI, 3);
  assert.equal(r.obecna, false);
  assert.equal(r.ostrzezenie, null);
});

test('nieznany czas trwania (bez 2. argumentu) → ostrzezenie null, kompatybilność wsteczna', () => {
  const r = wykryj_klauzule_waloryzacyjna(UMOWA_BEZ_KLAUZULI);
  assert.equal(r.obecna, false);
  assert.equal(r.ostrzezenie, null, 'bez znanego czasu trwania nie zgłaszamy naruszenia');
});

test('niepoprawny czas trwania (string/NaN/0/ujemny) → traktowany jako nieznany, ostrzezenie null, bez wyjątku', () => {
  for (const m of ['12', NaN, 0, -5, Infinity, null]) {
    const r = wykryj_klauzule_waloryzacyjna(UMOWA_BEZ_KLAUZULI, m);
    assert.equal(r.ostrzezenie, null, `dla czasu trwania ${JSON.stringify(m)}`);
  }
});

/*
 * DEDYKOWANE TESTY JEDNOSTKOWE — podzadanie 8/12. Utwardzenie matrycy przypadków
 * z opisu ulepszenia: kombinacje „z progiem/limitem i bez" oraz granica reguły
 * „> 6 miesięcy", których wcześniejsze testy (dopisane przy detektorach) wprost
 * nie pokrywały.
 */

test('8/12: klauzula z progiem, ale BEZ limitu, umowa > 6 mies. → obowiązek spełniony (ostrzezenie null)', () => {
  // Typowa klauzula „na wskaźniku GUS": jest próg uruchomienia, brak górnego
  // limitu. Obowiązek z art. 439 Pzp dotyczy OBECNOŚCI klauzuli, nie posiadania
  // limitu — więc dla umowy 18-miesięcznej NIE zgłaszamy czerwonej flagi.
  const t = '§ 11. Waloryzacja wynagrodzenia. Wynagrodzenie podlega zmianie, gdy poziom '
    + 'zmiany cen materiałów lub kosztów przekroczy 7% w stosunku do dnia zawarcia '
    + 'umowy. Podstawą jest wskaźnik cen towarów i usług ogłaszany przez GUS.';
  const r = wykryj_klauzule_waloryzacyjna(t, 18);
  assert.equal(r.obecna, true);
  assert.equal(r.prog, 7, 'próg odczytany');
  assert.equal(r.limit, null, 'brak górnego limitu w tej klauzuli');
  assert.equal(r.ostrzezenie, null, 'obecność klauzuli spełnia obowiązek — brak limitu nie jest naruszeniem');
  assert.match(r.opis, /nie wykryto górnego limitu/i, 'opis sygnalizuje brak limitu do weryfikacji');
});

test('8/12: granica reguły — 7 miesięcy (tuż powyżej 6) bez klauzuli → czerwona flaga', () => {
  // Reguła dotyczy umów DŁUŻSZYCH niż 6 mies.: 6 → brak flagi (test wyżej),
  // 7 → już flaga. Domyka granicę od góry.
  const r = wykryj_klauzule_waloryzacyjna(UMOWA_BEZ_KLAUZULI, 7);
  assert.equal(r.obecna, false);
  assert.ok(r.ostrzezenie, 'ostrzezenie powinno być obecne dla umowy > 6 mies.');
  assert.equal(r.ostrzezenie.poziom, 'czerwony');
  assert.equal(r.ostrzezenie.kod, 'brak_obowiazkowej_klauzuli');
});
