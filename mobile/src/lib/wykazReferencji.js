import { RODZAJE, oknoLat, statusReferencji } from './bankReferencji.js';
import { formatujPLN } from './kalkulatorCeny.js';

/*
 * „Wykaz wykonanych robót / usług / dostaw w 1 klik" — załącznik, o który zamawiający
 * wzywa najczęściej (art. 274 ust. 1 Pzp; § 9 ust. 1 pkt 1–2 rozporządzenia o podmiotowych
 * środkach dowodowych). Dane są już w Banku referencji — tu tylko składamy je w dokument.
 *
 * Do wykazu trafia WYŁĄCZNIE doświadczenie aktualne na dzień składania (5 lat roboty,
 * 3 lata usługi/dostawy — reguła z `bankReferencji.js`, jedna prawda o oknie czasu).
 * Wygasłe pozycje wracają osobno (`pominiete`), żeby ekran mógł powiedzieć dlaczego.
 *
 * CZYSTA logika: bez UI, bez zegara (`teraz`/`dzisiaj` parametrem), nigdy nie rzuca.
 */

const niepusty = (v) => typeof v === 'string' && v.trim().length > 0;
const w = (v) => (niepusty(v) ? v.trim() : '…');

const TYTULY = Object.freeze({
  roboty: { tytul: 'WYKAZ ROBÓT BUDOWLANYCH', nazwa: 'Wykaz wykonanych robót budowlanych', czasownik: 'wykonanych', kolumna: 'Rodzaj i zakres robót' },
  uslugi: { tytul: 'WYKAZ USŁUG', nazwa: 'Wykaz wykonanych usług', czasownik: 'wykonanych (a w przypadku świadczeń powtarzających się lub ciągłych — również wykonywanych)', kolumna: 'Przedmiot usługi' },
  dostawy: { tytul: 'WYKAZ DOSTAW', nazwa: 'Wykaz wykonanych dostaw', czasownik: 'wykonanych (a w przypadku świadczeń powtarzających się lub ciągłych — również wykonywanych)', kolumna: 'Przedmiot dostawy' },
});

function dataPL(isoLubTekst) {
  if (!niepusty(isoLubTekst)) return '…';
  const m = isoLubTekst.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return isoLubTekst.trim();
}

/**
 * Dzieli referencje na aktualne (do wykazu) i wygasłe. `rodzaj` zawęża do jednego typu.
 * Aktualne sortowane od najnowszych.
 */
export function wybierzDoWykazu(referencje, { rodzaj, teraz = Date.now() } = {}) {
  const lista = (Array.isArray(referencje) ? referencje : []).filter((r) => r && typeof r === 'object');
  const wlasciwe = rodzaj ? lista.filter((r) => r.rodzaj === rodzaj) : lista;
  const aktualne = [];
  const wygasle = [];
  for (const r of wlasciwe) {
    const s = statusReferencji(r, teraz).status;
    (s === 'wazna' || s === 'wygasa' ? aktualne : wygasle).push(r);
  }
  const czas = (r) => Date.parse(r.dataZakonczenia ?? '') || 0;
  aktualne.sort((a, b) => czas(b) - czas(a));
  return { aktualne, wygasle };
}

/**
 * Wykaz jako tekst do podpisu. Jedna pozycja = jeden blok z kolumnami wymaganymi przez
 * rozporządzenie (przedmiot, wartość, data wykonania, odbiorca) + miejsce na dowody.
 * @returns {{id, nazwa, podstawa, tresc, liczba, pominiete}}
 */
export function generujWykaz({ wykonawca, przetarg, referencje, rodzaj, teraz = Date.now(), dzisiaj } = {}) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const p = przetarg && typeof przetarg === 'object' ? przetarg : {};
  const rodz = RODZAJE[rodzaj] ? rodzaj : 'roboty';
  const t = TYTULY[rodz];
  const { aktualne, wygasle } = wybierzDoWykazu(referencje, { rodzaj: rodz, teraz });

  const pozycje = aktualne.length
    ? aktualne.flatMap((r, i) => [
      `${i + 1}. ${w(r.przedmiot)}`,
      `   ${t.kolumna}: ${w(r.opis) === '…' ? w(r.przedmiot) : r.opis.trim()}`,
      `   Wartość: ${Number.isFinite(Number(r.wartosc)) && r.wartosc !== '' && r.wartosc !== null ? formatujPLN(Number(r.wartosc)) + ' brutto' : '…'}`,
      `   Data wykonania (zakończenia): ${dataPL(r.dataZakonczenia)}`,
      `   Podmiot, na rzecz którego wykonano: ${w(r.zamawiajacy)}`,
      '   Dowody: referencje / protokół odbioru / inny dokument potwierdzający należyte wykonanie — w załączeniu',
      '',
    ])
    : ['— brak pozycji — w Banku referencji nie ma aktualnego doświadczenia tego rodzaju (sprawdź okno ' + oknoLat(rodz) + ' lat) —', ''];

  const tresc = [
    t.tytul,
    `${t.czasownik} w okresie ostatnich ${oknoLat(rodz)} lat przed upływem terminu składania ofert`,
    '(§ 9 ust. 1 rozporządzenia w sprawie podmiotowych środków dowodowych; art. 274 ust. 1 Pzp)',
    '',
    `Zamawiający: ${w(p.zamawiajacy)}`,
    `Postępowanie: ${w(p.tytul)}${niepusty(p.numer) ? ` (nr ${p.numer.trim()})` : ''}`,
    '',
    `Wykonawca: ${w(k.nazwa)}, ${w(k.adres)}, NIP ${w(k.nip)}`,
    '',
    ...pozycje,
    'Do wykazu załączam dowody określające, czy wymienione zamówienia zostały wykonane należycie (referencje bądź inne dokumenty wystawione przez podmiot, na rzecz którego były wykonywane).',
    '',
    `${w(k.miejscowosc)}, ${dataPL(typeof dzisiaj === 'string' ? dzisiaj : new Date(dzisiaj ?? teraz).toISOString())}`,
    '',
    niepusty(k.stanowisko) ? `${w(k.reprezentant)}, ${k.stanowisko.trim()}` : w(k.reprezentant),
    '(podpis kwalifikowany, podpis zaufany albo podpis osobisty)',
  ].join('\n');

  return {
    id: `wykaz_${rodz}`,
    nazwa: t.nazwa,
    podstawa: '§ 9 ust. 1 rozporządzenia o podmiotowych środkach dowodowych',
    tresc,
    liczba: aktualne.length,
    pominiete: wygasle,
  };
}
