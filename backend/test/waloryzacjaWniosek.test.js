import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Generator WNIOSKU O WALORYZACJĘ (podzadanie 12/12 ulepszenia „pilnowanie
 * waloryzacji i pułapek w umowie"). Czysta funkcja, bez I/O i bez sieci:
 * z różnicy wskaźników GUS liczy KWOTĘ waloryzacji, dobiera PODSTAWĘ PRAWNĄ
 * (klauzula z umowy — art. 439 Pzp, a gdy niewystarczająca — art. 455 Pzp)
 * i składa gotową treść pisma do eksportu.
 *
 * Testujemy ADWERSARYJNIE: liczbę-pieniądze (zaokrąglenie do grosza, niezmiennik
 * rozbicia kwoty), granice progu/limitu i konserwatywne „nie generuj" przy braku
 * danych — fałszywa kwota o pieniądzach jest gorsza niż brak wniosku.
 */

const { generujWniosekWaloryzacyjny, wniosekDoPliku } = await import('../src/lib/waloryzacjaWniosek.js');

// ── Kwota + „szczęśliwa ścieżka": klauzula z umowy wystarcza ─────────────────

test('klauzula z progiem, wzrost ponad próg, bez limitu => kwota z pełnego wzrostu, podstawa art. 439', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 1_000_000, wskaznikBazowy: 100, wskaznikAktualny: 112, prog: 5,
  });
  assert.equal(w.mozliwy, true);
  assert.equal(w.wzrost, 12);
  assert.equal(w.kwota, 120000);          // 1 000 000 × 12%
  assert.equal(w.kwotaZKlauzuli, 120000);
  assert.equal(w.kwotaPonadLimit, 0);
  assert.equal(w.podstawa.rodzaj, 'klauzula_umowna');
  assert.ok(w.podstawa.artykuly.some((a) => /439/.test(a)), 'podstawą jest art. 439 Pzp');
});

test('wzrost DOKŁADNIE na progu => niemożliwy (spójne z alarmem „o ponad X%")', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 1_000_000, wskaznikBazowy: 100, wskaznikAktualny: 110, prog: 10,
  });
  assert.equal(w.mozliwy, false);
  assert.equal(w.kwota, null);
  assert.match(w.powod, /prog/i);
});

// ── Konserwatywne „nie generuj" ─────────────────────────────────────────────

test('brak kompletnych danych o wskaźnikach => niemożliwy, bez kwoty', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 1_000_000, wskaznikBazowy: 0, wskaznikAktualny: 112, prog: 5,
  });
  assert.equal(w.mozliwy, false);
  assert.equal(w.kwota, null);
});

test('spadek cen (aktualny < bazowy) => niemożliwy (nie ma o co wnioskować)', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 1_000_000, wskaznikBazowy: 120, wskaznikAktualny: 110, prog: 5,
  });
  assert.equal(w.mozliwy, false);
  assert.equal(w.kwota, null);
});

test('brak/niepoprawna wartość kontraktu => niemożliwy (nie zmyślamy kwoty)', () => {
  for (const wartosc of [0, -100, NaN, undefined, '1000']) {
    const w = generujWniosekWaloryzacyjny({
      wartoscKontraktu: wartosc, wskaznikBazowy: 100, wskaznikAktualny: 112, prog: 5,
    });
    assert.equal(w.mozliwy, false, `wartosc=${wartosc} nie może dać wniosku`);
    assert.match(w.powod, /warto/i);
  }
});

// ── Podstawa prawna: brak / niewystarczająca klauzula => art. 455 ────────────

test('brak klauzuli w umowie (prog i limit null) => podstawa art. 455 Pzp, całość poza klauzulą', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 500_000, wskaznikBazowy: 100, wskaznikAktualny: 108,
  });
  assert.equal(w.mozliwy, true);
  assert.equal(w.wzrost, 8);
  assert.equal(w.kwota, 40000);           // 500 000 × 8%
  assert.equal(w.podstawa.rodzaj, 'art_455');
  assert.ok(w.podstawa.artykuly.some((a) => /455/.test(a)), 'podstawą jest art. 455 Pzp');
  assert.equal(w.kwotaZKlauzuli, 0, 'bez klauzuli nic nie idzie „z klauzuli"');
  assert.equal(w.kwotaPonadLimit, 40000);
});

test('klauzula z limitem, wzrost PONAD limit => klauzula do limitu + art. 455 na nadwyżkę', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 1_000_000, wskaznikBazowy: 100, wskaznikAktualny: 120, prog: 5, limit: 10,
  });
  assert.equal(w.mozliwy, true);
  assert.equal(w.wzrost, 20);
  assert.equal(w.kwota, 200000);          // pełny wzrost 20%
  assert.equal(w.kwotaZKlauzuli, 100000); // klauzula pokrywa do limitu 10%
  assert.equal(w.kwotaPonadLimit, 100000);// nadwyżka ponad limit
  assert.equal(w.podstawa.rodzaj, 'klauzula_i_art_455');
  assert.ok(w.podstawa.artykuly.some((a) => /439/.test(a)));
  assert.ok(w.podstawa.artykuly.some((a) => /455/.test(a)));
});

test('klauzula z limitem, wzrost W GRANICACH limitu => sama klauzula (art. 439), bez nadwyżki', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 1_000_000, wskaznikBazowy: 100, wskaznikAktualny: 108, prog: 5, limit: 10,
  });
  assert.equal(w.mozliwy, true);
  assert.equal(w.kwota, 80000);
  assert.equal(w.kwotaZKlauzuli, 80000);
  assert.equal(w.kwotaPonadLimit, 0);
  assert.equal(w.podstawa.rodzaj, 'klauzula_umowna');
});

// ── Pieniądze: zaokrąglenie do grosza i niezmiennik rozbicia ────────────────

test('kwota zaokrąglona do grosza (2 miejsca)', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 1234.56, wskaznikBazowy: 100, wskaznikAktualny: 110.5, prog: 3,
  });
  // 1234.56 × 10.5% = 129.6288 => 129.63
  assert.equal(w.kwota, 129.63);
});

test('niezmiennik: kwotaZKlauzuli + kwotaPonadLimit === kwota (co do grosza), także z groszami', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 333.33, wskaznikBazowy: 100, wskaznikAktualny: 120, prog: 5, limit: 7,
  });
  assert.equal(w.kwota, 66.67);           // 333.33 × 20%
  assert.equal(w.kwotaZKlauzuli, 23.33);  // × 7%
  assert.equal(w.kwotaPonadLimit, 43.34);
  assert.equal(Math.round((w.kwotaZKlauzuli + w.kwotaPonadLimit) * 100) / 100, w.kwota);
});

// ── Treść pisma + eksport do pliku ──────────────────────────────────────────

test('treść pisma niesie kwotę, procent wzrostu i podstawę prawną; jest deterministyczna', () => {
  const dane = {
    wartoscKontraktu: 1_000_000, wskaznikBazowy: 100, wskaznikAktualny: 112, prog: 5,
    branza: 'budownictwo', numerUmowy: 'ZP/12/2026', dataPisma: '2026-07-25',
  };
  const w = generujWniosekWaloryzacyjny(dane);
  assert.match(w.tresc, /WNIOSEK O WALORYZACJ/i);
  assert.match(w.tresc, /120\D?000/);         // kwota po polsku (spacja/NBSP jako separator)
  assert.match(w.tresc, /12,?\d*\s?%/);       // procent wzrostu po polsku
  assert.match(w.tresc, /art\.?\s*439/);      // podstawa prawna w treści
  assert.match(w.tresc, /2026-07-25/);        // podana data pisma
  assert.match(w.tresc, /ZP\/12\/2026/);      // numer umowy
  // Deterministyczna: te same dane => ta sama treść (żaden „teraz" w środku).
  assert.equal(generujWniosekWaloryzacyjny(dane).tresc, w.tresc);
});

test('treść przy niewystarczającej klauzuli cytuje art. 455 Pzp', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 500_000, wskaznikBazowy: 100, wskaznikAktualny: 120, prog: 5, limit: 8,
  });
  assert.match(w.tresc, /art\.?\s*455/);
});

test('wniosekDoPliku zwraca deskryptor pliku tekstowego z treścią wniosku', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 1_000_000, wskaznikBazowy: 100, wskaznikAktualny: 112, prog: 5, branza: 'budownictwo',
  });
  const plik = wniosekDoPliku(w);
  assert.match(plik.nazwa, /\.txt$/);
  assert.equal(plik.nazwa, w.nazwaPliku);
  assert.match(plik.typ, /text\/plain/);
  assert.match(plik.typ, /utf-8/i);
  assert.equal(plik.zawartosc, w.tresc);
});

test('wniosekDoPliku dla niemożliwego wniosku rzuca (nie ma czego eksportować)', () => {
  const w = generujWniosekWaloryzacyjny({
    wartoscKontraktu: 1_000_000, wskaznikBazowy: 120, wskaznikAktualny: 110, prog: 5,
  });
  assert.equal(w.mozliwy, false);
  assert.throws(() => wniosekDoPliku(w));
});
