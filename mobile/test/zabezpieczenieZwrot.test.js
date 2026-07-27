import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatujKwota,
  opisStatusuTranszy,
  opisWymagalnosci,
  podsumujHarmonogram,
  podsumujPorownanie,
} from '../src/lib/zabezpieczenieZwrot.js';

/*
 * ODZYSKIWACZ ZABEZPIECZENIA — czysta logika PREZENTACJI panelu (mobile). Bez importów
 * z React Native ani sieci — testowalna zwykłym `node:test`. Cała matematyka (harmonogram,
 * status, odsetki, porównanie kosztu) żyje na BEZSTANOWYM backendzie; tu tylko formatowanie
 * PL i mapowanie statusu na semantyczny `ton` (token/kontrast AA dokłada ekran z motyw.js).
 *
 * Ręczne grupowanie tysięcy (NIE Intl) — spójnie z lib/symulatorPlynnosci.js, bo Hermes w
 * RN nie ma pełnego Intl.
 */

// ─────────────────────── formatowanie kwot ───────────────────────────────────

test('formatujKwota: grupuje tysiące i pokazuje grosze', () => {
  assert.equal(formatujKwota(35_000), '35 000,00 zł');
  assert.equal(formatujKwota(100.5), '100,50 zł');
  assert.equal(formatujKwota(1_234_567.89), '1 234 567,89 zł');
});

test('formatujKwota: null/NaN/ujemne → 0,00 zł (pesymistycznie, bez wywrotki)', () => {
  assert.equal(formatujKwota(null), '0,00 zł');
  assert.equal(formatujKwota(undefined), '0,00 zł');
  assert.equal(formatujKwota(-5), '0,00 zł');
  assert.equal(formatujKwota('xxx'), '0,00 zł');
});

// ─────────────────────── status transzy → ton ────────────────────────────────

test('opisStatusuTranszy: mapuje status na etykietę + semantyczny ton', () => {
  assert.equal(opisStatusuTranszy('oczekuje').ton, 'neutral');
  assert.equal(opisStatusuTranszy('wymagalne').ton, 'ostrzezenie', 'alarm: zadziałaj (bursztyn)');
  assert.equal(opisStatusuTranszy('przeterminowane').ton, 'danger', 'siedzą na Twoich pieniądzach');
  assert.equal(opisStatusuTranszy('cokolwiek').ton, 'neutral', 'nieznany status → neutralny');
  assert.equal(typeof opisStatusuTranszy('wymagalne').etykieta, 'string');
});

// ─────────────────────── opis wymagalności (odmiana PL) ──────────────────────

test('opisWymagalnosci: odmiana dni i sensowny komunikat per status', () => {
  assert.equal(opisWymagalnosci({ status: 'oczekuje', dni: 10 }), 'za 10 dni');
  assert.equal(opisWymagalnosci({ status: 'oczekuje', dni: 1 }), 'za 1 dzień');
  assert.match(opisWymagalnosci({ status: 'wymagalne', dni: 0 }), /dziś/);
  assert.equal(opisWymagalnosci({ status: 'przeterminowane', dni: 30 }), '30 dni po terminie');
  assert.equal(opisWymagalnosci({ status: 'przeterminowane', dni: 1 }), '1 dzień po terminie');
  assert.match(opisWymagalnosci({ status: 'nieznany', dni: null }), /nieustalon/);
});

// ─────────────────────── podsumowanie harmonogramu ───────────────────────────

const HARMONOGRAM = {
  kwota: 50_000,
  procentZatrzymany: 30,
  transze: [
    { etap: 'po_odbiorze', tytul: 'Zwrot po odbiorze (art. 453 ust. 1 Pzp)', procent: 70, kwota: 35_000, termin: '2027-06-30', status: 'wymagalne', dni: 0, odsetki: 0 },
    { etap: 'po_rekojmi', tytul: 'Zwrot po rękojmi/gwarancji (art. 453 ust. 2–3 Pzp)', procent: 30, kwota: 15_000, termin: '2032-06-15', status: 'oczekuje', dni: 1_500, odsetki: 0 },
  ],
};

test('podsumujHarmonogram: wzbogaca transze o etykiety, ton i alarm', () => {
  const p = podsumujHarmonogram({ harmonogram: HARMONOGRAM, alarm: true });
  assert.equal(p.kwotaLabel, '50 000,00 zł');
  assert.equal(p.alarm, true);
  assert.match(p.alarmTekst, /żądać zwrotu/i, 'alarm niesie wezwanie do działania');

  const [t1, t2] = p.transze;
  assert.equal(t1.kwotaLabel, '35 000,00 zł');
  assert.equal(t1.procentLabel, '70%');
  assert.equal(t1.ton, 'ostrzezenie', 'wymagalna → bursztyn');
  assert.equal(t1.wymagalnoscTekst, 'dziś — możesz żądać zwrotu');
  assert.equal(t1.odsetkiLabel, null, 'brak zwłoki → bez odsetek');
  assert.equal(t2.ton, 'neutral', 'oczekująca → neutralny');
});

test('podsumujHarmonogram: przeterminowana transza pokazuje naliczone odsetki', () => {
  const h = {
    kwota: 50_000, procentZatrzymany: 0,
    transze: [{ etap: 'po_odbiorze', tytul: 'Zwrot po odbiorze', procent: 100, kwota: 50_000, termin: '2027-06-30', status: 'przeterminowane', dni: 61, odsetki: 850.5 }],
  };
  const p = podsumujHarmonogram({ harmonogram: h, alarm: true });
  assert.equal(p.transze[0].ton, 'danger');
  assert.equal(p.transze[0].odsetkiLabel, '850,50 zł', 'odsetki sformatowane');
});

test('podsumujHarmonogram: puste/niepoprawne wejście → bezpieczny obiekt (ekran się nie wywraca)', () => {
  const p = podsumujHarmonogram({});
  assert.equal(p.alarm, false);
  assert.deepEqual(p.transze, []);
});

// ─────────────────────── podsumowanie porównania kosztu ──────────────────────

test('podsumujPorownanie: etykiety, tańsza opcja i tekst oszczędności', () => {
  const porownanie = {
    kwota: 100_000, lata: 5,
    zalozenia: { prowizjaGwarancjiRocznaProc: 1.5, kosztKapitaluRocznyProc: 8 },
    gotowka: { koszt: 40_000 }, gwarancja: { koszt: 7_500 },
    tanszaOpcja: 'gwarancja', roznica: 32_500,
  };
  const p = podsumujPorownanie(porownanie);
  assert.equal(p.gotowkaLabel, '40 000,00 zł');
  assert.equal(p.gwarancjaLabel, '7 500,00 zł');
  assert.equal(p.tanszaOpcja, 'gwarancja');
  assert.match(p.tanszaEtykieta, /gwarancj/i);
  assert.equal(p.roznicaLabel, '32 500,00 zł');
  assert.match(p.rekomendacja, /gwarancj/i);
  assert.match(p.rekomendacja, /32 500,00 zł/);
  assert.match(p.zalozeniaTekst, /1,5%/);
  assert.match(p.zalozeniaTekst, /8%/);
});

test('podsumujPorownanie: opcje porównywalne → neutralna rekomendacja', () => {
  const p = podsumujPorownanie({
    kwota: 50_000, lata: 3, zalozenia: { prowizjaGwarancjiRocznaProc: 0, kosztKapitaluRocznyProc: 0 },
    gotowka: { koszt: 0 }, gwarancja: { koszt: 0 }, tanszaOpcja: 'porownywalne', roznica: 0,
  });
  assert.equal(p.tanszaOpcja, 'porownywalne');
  assert.match(p.rekomendacja, /porównywaln/i);
});
