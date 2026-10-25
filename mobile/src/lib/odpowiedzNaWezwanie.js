import { pozostalyCzas, podpowiedzDoDokumentu } from './wezwanieUzupelnienie.js';
import { zarejestrujKlucz } from './daneLokalne.js';

/*
 * „Odpowiedź na wezwanie w 1 klik" — z wklejonej treści wezwania zamawiającego
 * rozpoznajemy podstawę prawną (art. 128 / 274 / 223 / 224 Pzp), termin i znak
 * pisma, a potem składamy pismo przewodnie z listą załączników, gotowe do podpisu
 * elektronicznego.
 *
 * Problem: wezwanie jest JEDNOKROTNE i krótkie (3–5 dni). Wykonawca traci czas na
 * pisanie pisma od zera, a najczęstsze błędy to zła podstawa, brak oświadczenia
 * o aktualności dokumentów (art. 128 ust. 2 → dokumenty muszą być aktualne na
 * dzień złożenia) i „ręcznie podpisany skan" zamiast podpisu elektronicznego.
 *
 * CZYSTA logika: bez UI, bez sieci, bez zegara (`dzisiaj`/`teraz` wchodzą parametrem),
 * nigdy nie rzuca. Odliczanie i podpowiedzi aktualności REUŻYWAMY ze strażnika
 * wezwania (`wezwanieUzupelnienie.js`) — jedna prawda o czasie i dokumentach.
 */

const niepusty = (v) => typeof v === 'string' && v.trim().length > 0;
const w = (v) => (niepusty(v) ? v.trim() : '…');

function deepFreeze(wartosc) {
  if (wartosc && typeof wartosc === 'object' && !Object.isFrozen(wartosc)) {
    for (const v of Object.values(wartosc)) deepFreeze(v);
    Object.freeze(wartosc);
  }
  return wartosc;
}

/*
 * Stan odpowiedzi na wezwanie PER PRZETARG (wklejony tekst, rodzaj, termin, znak, załączniki,
 * wyjaśnienia) — użytkownik wraca dokończyć pismo i nic nie wpisuje drugi raz. Klucz per
 * przetarg → indeks konta (wylogowanie kasuje). SecureStore: tylko [A-Za-z0-9._-].
 */
export function kluczStanuWezwania(tenderId) {
  return `przetargai.wezwanie-odpowiedz.${String(tenderId).replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function wczytajStanWezwania(storage, tenderId) {
  if (!tenderId) return null;
  try {
    const raw = await storage.getItem(kluczStanuWezwania(tenderId));
    const dane = raw ? JSON.parse(raw) : null;
    return dane && typeof dane === 'object' ? dane : null;
  } catch {
    return null;
  }
}

export async function zapiszStanWezwania(storage, tenderId, stan) {
  if (!tenderId || !stan || typeof stan !== 'object') return;
  const klucz = kluczStanuWezwania(tenderId);
  await zarejestrujKlucz(storage, klucz);
  await storage.setItem(klucz, JSON.stringify(stan));
}

/** Rodzaje wezwań. Kolejność wzorców = kolejność rozpoznawania; „inne" łapie resztę. */
export const RODZAJE_WEZWANIA = deepFreeze([
  {
    id: 'uzupelnienie',
    podstawa: 'art. 128 ust. 1 Pzp',
    tytul: 'Uzupełnienie, poprawienie lub wyjaśnienie dokumentów',
    opis: 'Oświadczenie z art. 125 ust. 1, podmiotowe środki dowodowe, pełnomocnictwo — brakujące, niekompletne albo z błędami.',
    wzorce: [/art\.?\s*128/i, /uzupełnieni/i, /poprawieni/i],
    zalacznikiWymagane: true,
    ekranPomocy: 'StraznikWezwania',
  },
  {
    id: 'srodki_dowodowe',
    podstawa: 'art. 274 ust. 1 Pzp',
    tytul: 'Złożenie podmiotowych środków dowodowych',
    opis: 'Twoja oferta została najwyżej oceniona — zamawiający prosi o dokumenty potwierdzające brak wykluczenia i spełnianie warunków.',
    wzorce: [/art\.?\s*274/i, /art\.?\s*126/i, /podmiotow\w+\s+środk/i],
    zalacznikiWymagane: true,
    ekranPomocy: 'Sejf',
  },
  {
    id: 'wyjasnienia_tresci',
    podstawa: 'art. 223 ust. 1 Pzp',
    tytul: 'Wyjaśnienia treści oferty',
    opis: 'Zamawiający pyta o treść oferty. Wyjaśnienia NIE mogą zmieniać oferty ani być negocjacją.',
    wzorce: [/art\.?\s*223/i, /wyjaśnie\w*\s+(treści|dotycząc)/i],
    zalacznikiWymagane: false,
    ekranPomocy: null,
  },
  {
    id: 'razaco_niska',
    podstawa: 'art. 224 ust. 1 Pzp',
    tytul: 'Wyjaśnienia rażąco niskiej ceny',
    opis: 'Ciężar dowodu jest po Twojej stronie — ogólniki bez dowodów to odrzucenie oferty.',
    wzorce: [/art\.?\s*224/i, /rażąco\s+nisk/i],
    zalacznikiWymagane: true,
    ekranPomocy: 'ObronaCeny',
  },
  {
    id: 'inne',
    podstawa: null,
    tytul: 'Inne wezwanie',
    opis: 'Nie rozpoznaliśmy podstawy — wybierz ją ręcznie albo zostaw pismo ogólne.',
    wzorce: [],
    zalacznikiWymagane: false,
    ekranPomocy: null,
  },
]);

/** Dokumenty, o które zamawiający wzywa najczęściej — szybkie chipy na ekranie. */
export const TYPOWE_DOKUMENTY = deepFreeze([
  'Oświadczenie o aktualności informacji z art. 125 ust. 1',
  'Oświadczenie o grupie kapitałowej (art. 108 ust. 1 pkt 5)',
  'Zaświadczenie o niezaleganiu z US',
  'Zaświadczenie o niezaleganiu z ZUS',
  'Informacja z Krajowego Rejestru Karnego',
  'Odpis z KRS / wydruk CEIDG',
  'Wykaz robót / usług / dostaw z referencjami',
  'Wykaz osób skierowanych do realizacji',
  'Polisa OC z dowodem opłacenia',
  'Pełnomocnictwo',
  'Zobowiązanie podmiotu udostępniającego zasoby (art. 118)',
]);

const MIESIACE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

function poprawnaData(rok, mies, dzien) {
  if (mies < 1 || mies > 12 || dzien < 1 || dzien > 31) return false;
  const d = new Date(Date.UTC(rok, mies - 1, dzien));
  return d.getUTCFullYear() === rok && d.getUTCMonth() === mies - 1 && d.getUTCDate() === dzien;
}

const iso = (r, m, d) => `${r}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Pierwsza sensowna data w tekście: 27.10.2026 / 2026-10-27 / 27 października 2026. */
function wyciagnijDate(tekst) {
  const kropki = tekst.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/);
  if (kropki && poprawnaData(+kropki[3], +kropki[2], +kropki[1])) return iso(+kropki[3], +kropki[2], +kropki[1]);
  const isoM = tekst.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoM && poprawnaData(+isoM[1], +isoM[2], +isoM[3])) return iso(+isoM[1], +isoM[2], +isoM[3]);
  const slowna = tekst.match(/\b(\d{1,2})\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+(\d{4})/i);
  if (slowna) {
    const m = MIESIACE.indexOf(slowna[2].toLowerCase()) + 1;
    if (poprawnaData(+slowna[3], m, +slowna[1])) return iso(+slowna[3], m, +slowna[1]);
  }
  return null;
}

function wyciagnijGodzine(tekst) {
  const g = tekst.match(/godz(?:iny|\.)?\s*(\d{1,2})[:.](\d{2})/i) ?? tekst.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!g) return null;
  const h = +g[1];
  const m = +g[2];
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function wyciagnijZnak(tekst) {
  const z = tekst.match(/(?:znak|nr|numer|sygn\.?)\s*(?:sprawy|pisma|ref\.?)?\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9.\-/_]{3,})/i);
  if (!z) return null;
  return z[1].replace(/[.,;]+$/, '');
}

/**
 * Rozpoznaje wezwanie z wklejonego tekstu. Nigdy nie rzuca.
 * @returns {{rodzaj: string, termin: string|null, godzina: string|null, znak: string|null}}
 */
export function rozpoznajWezwanie(tekst) {
  const t = typeof tekst === 'string' ? tekst : '';
  const rodzaj = RODZAJE_WEZWANIA.find((r) => r.wzorce.some((re) => re.test(t)))?.id ?? 'inne';
  return { rodzaj, termin: wyciagnijDate(t), godzina: wyciagnijGodzine(t), znak: wyciagnijZnak(t) };
}

function dataPL(isoLubTekst) {
  if (!niepusty(isoLubTekst)) return '…';
  const m = isoLubTekst.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  const d = new Date(isoLubTekst);
  if (Number.isNaN(d.getTime())) return isoLubTekst.trim();
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}

function rodzajWg(id) {
  return RODZAJE_WEZWANIA.find((r) => r.id === id) ?? RODZAJE_WEZWANIA.at(-1);
}

/**
 * Pismo przewodnie w odpowiedzi na wezwanie.
 * @returns {{id, nazwa, rodzaj, podstawa, tresc, termin, ekranPomocy}}
 */
export function generujOdpowiedz({ wykonawca, przetarg, wezwanie, dokumenty, wyjasnienie, dzisiaj } = {}) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const p = przetarg && typeof przetarg === 'object' ? przetarg : {};
  const wz = wezwanie && typeof wezwanie === 'object' ? wezwanie : {};
  const rodzaj = rodzajWg(wz.rodzaj);
  const lista = (Array.isArray(dokumenty) ? dokumenty : [])
    .map((d) => (typeof d === 'string' ? { nazwa: d } : d))
    .filter((d) => d && niepusty(d.nazwa));

  const nawiazanie = [
    'W odpowiedzi na wezwanie',
    niepusty(wz.dataWezwania) ? ` z dnia ${dataPL(wz.dataWezwania)}` : '',
    niepusty(wz.znak) ? ` (znak: ${wz.znak.trim()})` : '',
    rodzaj.podstawa ? `, skierowane na podstawie ${rodzaj.podstawa},` : ',',
  ].join('');

  let korpus;
  switch (rodzaj.id) {
    case 'uzupelnienie':
      korpus = [
        `${nawiazanie} w imieniu Wykonawcy składam uzupełnione / poprawione dokumenty wymienione w załączeniu.`,
        '',
        'Oświadczam, że złożone dokumenty są aktualne na dzień ich złożenia i potwierdzają brak podstaw wykluczenia oraz spełnianie warunków udziału w postępowaniu (art. 128 ust. 2 ustawy Pzp).',
      ].join('\n');
      break;
    case 'srodki_dowodowe':
      korpus = [
        `${nawiazanie} w imieniu Wykonawcy składam podmiotowe środki dowodowe wymienione w załączeniu.`,
        '',
        'Oświadczam, że złożone dokumenty są aktualne na dzień ich złożenia (art. 126 ust. 1 ustawy Pzp).',
      ].join('\n');
      break;
    case 'wyjasnienia_tresci':
      korpus = [
        `${nawiazanie} w imieniu Wykonawcy wyjaśniam, co następuje:`,
        '',
        w(wyjasnienie),
        '',
        'Powyższe wyjaśnienia nie prowadzą do zmiany treści oferty ani nie stanowią negocjacji jej treści (art. 223 ust. 1 ustawy Pzp) — potwierdzają jedynie treść złożonej oferty.',
      ].join('\n');
      break;
    case 'razaco_niska':
      korpus = [
        `${nawiazanie} w imieniu Wykonawcy przedstawiam wyjaśnienia dotyczące wyliczenia ceny oferty wraz z dowodami:`,
        '',
        w(wyjasnienie),
        '',
        'Zaoferowana cena uwzględnia wszystkie koszty wykonania zamówienia, w tym koszty pracy nie niższe niż minimalne wynagrodzenie za pracę, i jest ceną realną, umożliwiającą należyte wykonanie zamówienia. Dowody potwierdzające powyższe wyliczenia załączam.',
      ].join('\n');
      break;
    default:
      korpus = [
        `${nawiazanie} w imieniu Wykonawcy przekazuję, co następuje:`,
        '',
        w(wyjasnienie),
      ].join('\n');
  }

  const zalaczniki = lista.length
    ? ['', 'ZAŁĄCZNIKI:', ...lista.map((d, i) => `${i + 1}. ${d.nazwa.trim()}${niepusty(d.uwaga) ? ` — ${d.uwaga.trim()}` : ''}`)]
    : [];

  const terminLinia = niepusty(wz.termin)
    ? `Termin z wezwania: ${dataPL(wz.termin)}${niepusty(wz.godzina) ? `, godz. ${wz.godzina}` : ''}.`
    : null;

  const osoba = niepusty(k.stanowisko) ? `${w(k.reprezentant)}, ${k.stanowisko.trim()}` : w(k.reprezentant);
  const tresc = [
    `${w(k.miejscowosc)}, ${dataPL(dzisiaj)}`,
    '',
    `Wykonawca: ${w(k.nazwa)}`,
    `Adres: ${w(k.adres)}`,
    `NIP ${w(k.nip)}${niepusty(k.email) ? `, e-mail: ${k.email.trim()}` : ''}`,
    '',
    `Zamawiający: ${w(p.zamawiajacy)}`,
    `Dotyczy: ${w(p.tytul)}${niepusty(p.numer) ? ` (nr ${p.numer.trim()})` : ''}`,
    '',
    `ODPOWIEDŹ NA WEZWANIE${rodzaj.podstawa ? ` — ${rodzaj.podstawa.toUpperCase()}` : ''}`,
    '',
    korpus,
    ...zalaczniki,
    '',
    ...(terminLinia ? [terminLinia, ''] : []),
    osoba,
    '(podpis kwalifikowany, podpis zaufany albo podpis osobisty — odpowiedź i każdy załącznik w formie elektronicznej)',
  ].join('\n');

  return {
    id: `odpowiedz_${rodzaj.id}`,
    nazwa: rodzaj.podstawa ? `Odpowiedź na wezwanie (${rodzaj.podstawa})` : 'Odpowiedź na wezwanie',
    rodzaj: rodzaj.id,
    podstawa: rodzaj.podstawa,
    tresc,
    termin: niepusty(wz.termin) ? wz.termin : null,
    ekranPomocy: rodzaj.ekranPomocy,
  };
}

/**
 * Kontrola przed wysłaniem: termin, załączniki, podpis, forma, aktualność każdego dokumentu.
 * @returns {Array<{id: string, tekst: string, ton: 'neutral'|'ostrzezenie'|'danger'|'sukces'}>}
 */
export function kontrolaPrzedWyslaniem({ rodzaj, termin, godzina, dokumenty, teraz = Date.now() } = {}) {
  const r = rodzajWg(rodzaj);
  const lista = (Array.isArray(dokumenty) ? dokumenty : []).filter((d) => d && niepusty(d.nazwa));
  const punkty = [];

  const zapis = niepusty(termin) ? (niepusty(godzina) ? `${termin}T${godzina}` : termin) : null;
  const czas = pozostalyCzas(zapis, teraz);
  punkty.push({
    id: 'termin',
    ton: czas.znany ? czas.ton : 'neutral',
    tekst: czas.znany
      ? `${czas.etykieta} do końca terminu z wezwania. Wyślij z zapasem — liczy się chwila wpływu na platformę, nie wysyłki.`
      : 'Wpisz termin z wezwania — bez niego nie odliczymy czasu.',
  });

  if (r.zalacznikiWymagane) {
    punkty.push({
      id: 'zalaczniki',
      ton: lista.length ? 'sukces' : 'danger',
      tekst: lista.length
        ? `Załączniki: ${lista.length}. Sprawdź, czy lista pokrywa KAŻDY punkt wezwania — drugiego wezwania nie będzie.`
        : 'Brak załączników — przy tym wezwaniu samo pismo to nic. Dodaj dokumenty, o które prosi zamawiający.',
    });
  }

  for (const d of lista) {
    const podpowiedz = podpowiedzDoDokumentu(d.nazwa);
    if (podpowiedz) punkty.push({ id: `dokument:${d.nazwa}`, ton: 'ostrzezenie', tekst: `${d.nazwa}: ${podpowiedz}` });
  }

  punkty.push({ id: 'podpis', ton: 'ostrzezenie', tekst: 'Podpis elektroniczny (kwalifikowany / zaufany / osobisty) na piśmie i na KAŻDYM załączniku. Skan odręcznego podpisu nie jest podpisem.' });
  punkty.push({ id: 'forma', ton: 'neutral', tekst: 'Wyślij tak, jak wskazano w wezwaniu (zwykle platforma e-Zamówienia lub platforma zakupowa). E-mail tylko, gdy wezwanie wprost na to pozwala.' });
  return punkty;
}
