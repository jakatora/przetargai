import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/*
 * P1 — FEED „DLA MNIE" I SZCZEGÓŁY PRZETARGU MUSZĄ BYĆ DWUJĘZYCZNE.
 *
 * Po przełączeniu na EN ekrany „Wszystkie", „Zapisane", „Pulpit" mówiły po
 * angielsku, a główny feed i szczegóły przetargu — czyli dwa ekrany, na których
 * użytkownik spędza najwięcej czasu — zostawały po polsku. Karta przetargu
 * (MatchCard) nie wołała tłumacza ani razu.
 *
 * Strażnik czyta ŹRÓDŁO: wycina komentarze i wywołania `t(…)`, a potem szuka
 * polskich znaków w tym, co zostało. Każdy polski znak poza `t(…)` to tekst
 * wstawiony na sztywno (etykieta, placeholder, accessibilityLabel, tytuł
 * Alertu, treść udostępniania). Teksty z `src/lib/*` przechodzą przez `t(x)`
 * jednoargumentowo — to przepust (string zostaje stringiem, para {pl,en}
 * wybiera wariant), więc nie wymagają drugiego argumentu.
 */
const PLIKI = [
  'components/MatchCard.js',
  'screens/MatchFeedScreen.js',
  'screens/MatchDetailScreen.js',
];

const POLSKIE = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/** Indeks tuż za napisem zaczynającym się w `i` (', " albo ` z zagnieżdżonym ${…}). */
function koniecNapisu(kod, i) {
  const q = kod[i];
  let j = i + 1;
  while (j < kod.length && kod[j] !== q) {
    if (kod[j] === '\\') { j += 2; continue; }
    if (q !== '`' && kod[j] === '\n') return j; // niedomknięty '…' / "…" (np. apostrof w tekście JSX)
    if (q === '`' && kod[j] === '$' && kod[j + 1] === '{') {
      j += 2;
      let klamry = 1;
      while (j < kod.length && klamry > 0) {
        const c = kod[j];
        if (c === "'" || c === '"' || c === '`') { j = koniecNapisu(kod, j); continue; }
        if (c === '{') klamry++;
        else if (c === '}') klamry--;
        j++;
      }
      continue;
    }
    j++;
  }
  return j + 1;
}

/** Komentarze (// i /* *\/) zamienione na spacje; napisy nietknięte, nowe linie zachowane. */
function bezKomentarzy(kod) {
  let wynik = '';
  let i = 0;
  while (i < kod.length) {
    const c = kod[i];
    const n = kod[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      const k = koniecNapisu(kod, i);
      wynik += kod.slice(i, k);
      i = k;
    } else if (c === '/' && n === '/') {
      while (i < kod.length && kod[i] !== '\n') { wynik += ' '; i++; }
    } else if (c === '/' && n === '*') {
      const k = kod.indexOf('*/', i + 2);
      const koniec = k < 0 ? kod.length : k + 2;
      wynik += kod.slice(i, koniec).replace(/[^\n]/g, ' ');
      i = koniec;
    } else {
      wynik += c;
      i++;
    }
  }
  return wynik;
}

/** Wywołania `t(…)`: zakres argumentów i czy mają drugi argument (wariant EN). */
function wywolaniaT(kod) {
  const wynik = [];
  const re = /(^|[^\w$.])t\(/g;
  let m;
  while ((m = re.exec(kod))) {
    const start = m.index + m[0].length;
    let i = start;
    let glebokosc = 1;
    let dwaArgumenty = false;
    while (i < kod.length && glebokosc > 0) {
      const c = kod[i];
      if (c === "'" || c === '"' || c === '`') { i = koniecNapisu(kod, i); continue; }
      if ('([{'.includes(c)) glebokosc++;
      else if (')]}'.includes(c)) glebokosc--;
      else if (c === ',' && glebokosc === 1) dwaArgumenty = true;
      i++;
    }
    wynik.push({ start, koniec: i - 1, dwaArgumenty });
  }
  return wynik;
}

/** Linie z polskimi znakami poza komentarzami i poza `t(…)` + polskie `t(…)` bez wariantu EN. */
function naruszenia(zrodlo) {
  let kod = bezKomentarzy(zrodlo);
  const styl = kod.indexOf('const tworzStyle');
  if (styl > 0) kod = kod.slice(0, styl); // nazwy pól stylu to identyfikatory, nie tekst
  const znaki = kod.split('');
  const bezEn = [];
  for (const w of wywolaniaT(kod)) {
    const argumenty = kod.slice(w.start, w.koniec);
    if (!w.dwaArgumenty && POLSKIE.test(argumenty)) bezEn.push(argumenty.trim().slice(0, 60));
    for (let k = w.start; k < w.koniec; k++) if (znaki[k] !== '\n') znaki[k] = ' ';
  }
  const gole = znaki.join('').split('\n')
    .map((linia, nr) => ({ linia: linia.trim(), nr: nr + 1 }))
    .filter(({ linia }) => POLSKIE.test(linia))
    .map(({ linia, nr }) => `${nr}: ${linia.slice(0, 70)}`);
  return { gole, bezEn };
}

describe('skaner strażnika działa (inaczej zielony test niczego nie dowodzi)', () => {
  test('łapie goły polski tekst w JSX, w atrybucie i w Alercie', () => {
    const { gole } = naruszenia([
      '<Text>Usuń z zapisanych</Text>',
      '<TextInput placeholder="Szukaj po nazwie lub zamawiającym" />',
      "Alert.alert('Błąd', err.message);",
    ].join('\n'));
    assert.equal(gole.length, 3);
  });

  test('przepuszcza t(pl, en), komentarze i zagnieżdżone t() w szablonie', () => {
    const { gole, bezEn } = naruszenia([
      "<Text>{t('Zapisz przetarg', 'Save tender')}</Text>",
      '// Zażółć gęślą jaźń',
      '{/* Źródło pierwotne */}',
      "label={t(`Wadium ${t(wadium.wartosc)}`, `Bid security ${t(wadium.wartosc)}`)}",
      "t(\n  'Przejdź na Standard — 49 zł/mc: https://przetargai.web.app',\n  'Upgrade: https://przetargai.web.app',\n)",
    ].join('\n'));
    assert.deepEqual(gole, []);
    assert.deepEqual(bezEn, []);
  });

  test('łapie polski literał w t() bez wariantu EN', () => {
    const { bezEn } = naruszenia("<Text>{t('Błąd')}</Text>");
    assert.equal(bezEn.length, 1);
  });
});

describe('feed „Dla mnie" i szczegóły przetargu są dwujęzyczne', () => {
  for (const plik of PLIKI) {
    const zrodlo = readFileSync(join(SRC, plik), 'utf8');

    test(`${plik} sięga po tłumacza z JezykContext`, () => {
      assert.match(zrodlo, /useJezyk\(\)/, `${plik} nie woła useJezyk() — zostanie po polsku`);
    });

    test(`${plik}: żaden polski tekst poza t(pl, en)`, () => {
      const { gole, bezEn } = naruszenia(zrodlo);
      assert.deepEqual(gole, [], 'polski tekst wstawiony na sztywno — opakuj go w t(pl, en)');
      assert.deepEqual(bezEn, [], 'polski literał w t() bez drugiego argumentu — brak wariantu EN');
    });
  }
});
