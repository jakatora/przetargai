/**
 * Wyjaśnienie dopasowania na ekranie (P1-4) — czysta warstwa prezentacji.
 *
 * Backend liczy sygnały (`/matches` → `wyjasnienie`). Tu zapada decyzja, co
 * z nich zmieści się na KARCIE, a co należy do SZCZEGÓŁÓW:
 *
 *  • karta ma centymetr wolnego miejsca i konkuruje z tytułem ogłoszenia —
 *    idą na nią wyłącznie sygnały, które ZADZIAŁAŁY, najwyżej dwa,
 *  • szczegóły pokazują komplet czterech, razem z podpowiedziami; to tam
 *    użytkownik przychodzi z pytaniem „dlaczego to widzę i co z tym zrobić".
 *
 * Ton jest nazwą semantyczną („ok" / „uwaga" / „neutralny"), nie kolorem —
 * kolory należą do motywu i przypisuje je ekran.
 */

/** Ile znaczników wyjaśnienia mieści się na karcie, zanim zacznie krzyczeć. */
const MAKS_NA_KARCIE = 2;

export function tonSygnalu(sila) {
  if (sila === 'mocny') return 'ok';
  if (sila === 'czesciowy') return 'uwaga';
  return 'neutralny';
}

/**
 * Znacznik tekstowy. Musi odróżniać trafienie od informacji SAM, bez koloru —
 * inaczej całe wyjaśnienie znika dla osoby nierozróżniającej barw.
 */
export function znakSygnalu(sila) {
  if (sila === 'mocny') return '✓';
  if (sila === 'czesciowy') return '~';
  if (sila === 'brak') return '–';
  return 'i';
}

function odmienSlowa(n) {
  if (n === 1) return 'słowo';
  const setki = n % 100;
  if (setki >= 12 && setki <= 14) return 'słów';
  const jednosci = n % 10;
  return jednosci >= 2 && jednosci <= 4 ? 'słowa' : 'słów';
}

/** Krótki tekst znacznika na kartę — z KONKRETU sygnału, nie z jego nazwy. */
function tekstSkrotu(s) {
  if (s.typ === 'cpv' && s.wartosci?.length) {
    // Druga pozycja to kod OGŁOSZENIA — ten, który użytkownik zobaczy w rejestrze.
    const kod = s.wartosci[1] ?? s.wartosci[0];
    return { pl: `CPV ${kod}`, en: `CPV ${kod}` };
  }
  if (s.typ === 'slowa' && s.wartosci?.length) {
    const ile = s.wartosci.length;
    return ile === 1
      ? { pl: `słowo: ${s.wartosci[0]}`, en: `keyword: ${s.wartosci[0]}` }
      : { pl: `${ile} ${odmienSlowa(ile)} z profilu`, en: `${ile} profile keywords` };
  }
  if (s.typ === 'region') return { pl: 'Twój region', en: 'your region' };
  if (s.typ === 'wartosc') return { pl: 'Twoja skala', en: 'your scale' };
  return s.etykieta ?? { pl: '', en: '' };
}

/**
 * Znaczniki na kartę: tylko to, co zadziałało, najwyżej dwa.
 * Pusty rząd znaczników jest gorszy niż jego brak — to szum, który uczy
 * przewijać wzrokiem miejsce, gdzie czasem stoi ważna informacja.
 */
export function skrotWyjasnienia(wyjasnienie) {
  const sygnaly = Array.isArray(wyjasnienie?.sygnaly) ? wyjasnienie.sygnaly : [];
  return sygnaly
    .filter((s) => s.sila === 'mocny' || s.sila === 'czesciowy')
    .slice(0, MAKS_NA_KARCIE)
    .map((s) => ({ typ: s.typ, ton: tonSygnalu(s.sila), znak: znakSygnalu(s.sila), tekst: tekstSkrotu(s) }));
}

/** Komplet sygnałów do szczegółów — z podpowiedzią, czyli akcją do wykonania. */
export function wierszeWyjasnienia(wyjasnienie) {
  const sygnaly = Array.isArray(wyjasnienie?.sygnaly) ? wyjasnienie.sygnaly : [];
  return sygnaly.map((s) => ({
    typ: s.typ,
    ton: tonSygnalu(s.sila),
    znak: znakSygnalu(s.sila),
    etykieta: s.etykieta,
    szczegol: s.szczegol,
    podpowiedz: s.podpowiedz ?? null,
  }));
}

const SLOWO_SILY = {
  pl: { mocny: 'sygnał mocny', czesciowy: 'sygnał częściowy', brak: 'brak sygnału', informacja: 'informacja' },
  en: { mocny: 'strong signal', czesciowy: 'partial signal', brak: 'no signal', informacja: 'information' },
};

/**
 * Opis dla czytnika ekranu. Symbol („✓", „–") czytnik przeczyta jako nazwę
 * znaku albo pominie, więc siła sygnału musi paść SŁOWEM.
 */
export function opisDlaCzytnika(sygnal, jezyk = 'pl') {
  const kod = jezyk === 'en' ? 'en' : 'pl';
  const etykieta = sygnal?.etykieta?.[kod] ?? sygnal?.etykieta?.pl ?? '';
  const sila = SLOWO_SILY[kod][sygnal?.sila] ?? SLOWO_SILY[kod].informacja;
  const szczegol = sygnal?.szczegol?.[kod] ?? sygnal?.szczegol?.pl ?? '';
  return `${etykieta}: ${sila}. ${szczegol}`;
}
