import { test } from 'node:test';
import assert from 'node:assert/strict';
import { odmianaPrzetargow, zdanieRaportu, mailSelekcji } from '../src/lib/mailSelekcji.js';
import { mailProbyPrzypomnienie, mailProbyKoniec, dniDoKoncaProby } from '../src/lib/mailProby.js';

const LINKI = { linkWypisu: 'https://api/pracownik/wypisz?token=abc', linkAplikacji: 'https://przetarg-ai.pl' };
const POZ = { tytul: 'Remont <b>dachu</b>', organizacja: 'Gmina & Miasto', termin: '2026-11-10T10:00:00.000Z', punkty: ['Zakres: dachy', 'Teren: Podkarpackie', 'trzeci'] };

test('odmiana', () => {
  assert.deepEqual([1, 2, 4, 5, 12, 22, 25].map(odmianaPrzetargow), [
    '1 nowy przetarg', '2 nowe przetargi', '4 nowe przetargi', '5 nowych przetargów',
    '12 nowych przetargów', '22 nowe przetargi', '25 nowych przetargów']);
});

test('raport dnia: liczby i trzy najczęstsze przyczyny', () => {
  const z = zdanieRaportu({ przejrzane: 1043, wybrane: 4, odrzucone: { branza: 900, teren: 21, za_duze: 9, termin: 7, inne: 0 } });
  assert.equal(z, 'Dziś przejrzeliśmy 1043 ogłoszeń, wybraliśmy 4, odrzuciliśmy 937 (900 — nie twoja branża, 21 — poza twoim terenem, 9 — za duże dla twojej firmy).');
  assert.equal(zdanieRaportu(null), null);
});

test('mail Free: temat z odmianą, escape HTML, link wypisu, bez słowa „pracownik”', () => {
  const m = mailSelekcji({ pozycje: [POZ, POZ, POZ], plan: 'free', ...LINKI });
  assert.equal(m.subject, 'Mamy dla Ciebie 3 nowe przetargi');
  assert.ok(m.html.includes('Remont &lt;b&gt;dachu&lt;/b&gt;'));
  assert.ok(m.html.includes('Gmina &amp; Miasto'));
  assert.ok(m.html.includes(LINKI.linkWypisu) && m.text.includes(LINKI.linkWypisu));
  assert.ok(m.text.includes('termin 10.11.2026'));
  assert.ok(!m.text.includes('trzeci'), 'najwyżej 2 punkty w mailu');
  assert.ok(!/pracownik/i.test(m.subject + m.text.replaceAll(LINKI.linkWypisu, '') + m.html.replaceAll(LINKI.linkWypisu, '')));
});

test('mail Standard z jednym przetargiem: tytuł w temacie i pierwszy krok', () => {
  const m = mailSelekcji({ pozycje: [{ ...POZ, tytul: 'Remont dachu', krok: 'Pytania do SWZ do 28.10' }], plan: 'standard', ...LINKI });
  assert.equal(m.subject, 'Nowy przetarg dla Twojej firmy: Remont dachu');
  assert.ok(m.text.includes('Pytania do SWZ do 28.10'));
});

test('maile próby', () => {
  assert.equal(mailProbyPrzypomnienie({ dniZostalo: 2, ...LINKI }).subject, 'Twoja próba Standard kończy się za 2 dni');
  assert.equal(mailProbyPrzypomnienie({ dniZostalo: 1, ...LINKI }).subject, 'Twoja próba Standard kończy się jutro');
  assert.equal(mailProbyPrzypomnienie({ dniZostalo: 0, ...LINKI }).subject, 'Twoja próba Standard kończy się dziś');
  // Dni KALENDARZOWE w Warszawie: rejestracja o 15:00, przebieg 12:00 dzień przed końcem = „jutro” (27 h, nie „za 2 dni”).
  assert.equal(dniDoKoncaProby('2026-10-23T13:00:00.000Z', '2026-10-22T10:00:00.000Z'), 1);
  assert.equal(dniDoKoncaProby('2026-10-24T13:00:00.000Z', '2026-10-22T10:00:00.000Z'), 2);
  assert.equal(dniDoKoncaProby('2026-10-22T21:30:00.000Z', '2026-10-22T10:00:00.000Z'), 0, '23:30 tego samego dnia = dziś');
  const k = mailProbyKoniec(LINKI);
  assert.equal(k.subject, 'Próba Standard się skończyła — od dziś 5 przetargów dziennie');
  assert.ok(k.text.includes('Konto') && k.text.includes('99 zł'));
});
