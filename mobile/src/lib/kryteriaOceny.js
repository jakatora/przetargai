/*
 * „Za co są punkty” (2026-10-31, z analizy konkurencji) — czysta logika karty kryteriów oceny.
 * Serwer oddaje listę z ogłoszenia BZP (`GET /wygrywalnosc/tender/:id/kryteria`: nazwa, waga,
 * udział, rodzaj), a tu składamy to, co oszczędza wykonawcy czytanie SWZ: ile waży cena,
 * co zadeklarować przy każdym kryterium i o co zapytać SWZ, żeby wziąć maksimum punktów.
 * Bez zegara, bez UI, nigdy nie rzuca.
 */

/** Krótka etykieta i wskazówka „co zrobić” dla rodzaju kryterium (rodzaje z Functions `lib/ogloszenieMeta.js`). */
export const RODZAJE_KRYTERIOW = Object.freeze({
  cena: {
    pl: 'Cena', en: 'Price',
    wskazowka: { pl: 'Najniższa cena dostaje komplet punktów, reszta proporcjonalnie mniej — wzór jest w SWZ.', en: 'The lowest price gets full points, others proportionally fewer — the formula is in the tender documents.' },
  },
  gwarancja: {
    pl: 'Gwarancja', en: 'Warranty',
    wskazowka: { pl: 'Wpisz w formularzu ofertowym najdłuższą gwarancję, którą SWZ jeszcze punktuje. Dłuższa nie da więcej punktów, a wiąże Cię w umowie.', en: 'Enter the longest warranty the documents still score. Longer gives no extra points but binds you in the contract.' },
  },
  termin: {
    pl: 'Termin', en: 'Deadline',
    wskazowka: { pl: 'Krótszy termin daje punkty, ale spóźnienie oznacza kary umowne. Deklaruj termin, którego na pewno dotrzymasz.', en: 'A shorter deadline scores points, but delay means contractual penalties. Declare a deadline you will surely meet.' },
  },
  platnosc: {
    pl: 'Termin płatności', en: 'Payment term',
    wskazowka: { pl: 'Sprawdź w SWZ, który termin płatności daje maksimum punktów (zwykle dłuższy), i policz, czy udźwigniesz czekanie na pieniądze.', en: 'Check which payment term scores the maximum (usually the longer one) and whether you can afford to wait for the money.' },
  },
  reakcja: {
    pl: 'Czas reakcji', en: 'Response time',
    wskazowka: { pl: 'Deklarujesz czas reakcji lub naprawy, a jego przekroczenie zwykle kosztuje karę. Wpisz czas, który zapewnisz też w weekend i w nocy, jeśli SWZ tego wymaga.', en: 'You declare a response or repair time, and missing it usually costs a penalty. Enter a time you can keep at weekends and nights if required.' },
  },
  doswiadczenie: {
    pl: 'Doświadczenie osób', en: 'Staff experience',
    wskazowka: { pl: 'Punkty za doświadczenie wskazanych osób. Przygotuj wykaz z konkretnymi robotami lub usługami i datami, bo zamawiający może poprosić o dowody.', en: 'Points for the experience of named people. Prepare a list of specific works or services with dates, as proof may be requested.' },
  },
  koncepcja: {
    pl: 'Koncepcja i organizacja', en: 'Approach and organisation',
    wskazowka: { pl: 'Kryterium opisowe, oceniane według zasad z SWZ. Pisz konkretnie pod każdy punktowany element, nie ogólnikami.', en: 'A descriptive criterion scored by the rules in the documents. Address each scored element concretely, not in general terms.' },
  },
  spoleczne: {
    pl: 'Aspekty społeczne', en: 'Social aspects',
    wskazowka: { pl: 'Zwykle zobowiązanie do zatrudnienia przy zamówieniu określonych osób (np. bezrobotnych, z niepełnosprawnością). Wiąże w umowie i bywa kontrolowane.', en: 'Usually a commitment to employ specific people on the contract (e.g. unemployed, disabled). It binds you and is often checked.' },
  },
  srodowisko: {
    pl: 'Środowisko', en: 'Environment',
    wskazowka: { pl: 'Deklaracja parametru, np. normy emisji spalin albo pojazdów elektrycznych. Sprawdź w SWZ, jakim dokumentem to potwierdzić.', en: 'A declared parameter, e.g. emission standard or electric vehicles. Check which document proves it.' },
  },
  certyfikat: {
    pl: 'Certyfikat', en: 'Certificate',
    wskazowka: { pl: 'Punkty za posiadany certyfikat (np. ISO). Dołącz kopię. Jeśli go nie masz, policz, czy wygrasz bez tych punktów.', en: 'Points for holding a certificate (e.g. ISO). Attach a copy. Without it, check whether you can win without these points.' },
  },
  umowa: {
    pl: 'Warunki umowy', en: 'Contract terms',
    wskazowka: { pl: 'Deklarujesz warunki umowy (kary, ubezpieczenie, klauzule). Punkty dostajesz teraz, a obowiązują Cię przez cały kontrakt.', en: 'You declare contract terms (penalties, insurance, clauses). You score now, but they bind you for the whole contract.' },
  },
  dodatkowe: {
    pl: 'Świadczenia dodatkowe', en: 'Extra services',
    wskazowka: { pl: 'Punkty za usługi ponad minimum z SWZ. Wlicz ich koszt w cenę, bo po wygranej musisz je wykonać.', en: 'Points for services beyond the minimum. Price them in, because after winning you must deliver them.' },
  },
  dostepnosc: {
    pl: 'Lokalizacja i dostępność', en: 'Location and availability',
    wskazowka: { pl: 'Punkty za bliskość lub dostępność (odległość, liczba placówek, godziny). Wpisz dane, które zamawiający łatwo sprawdzi.', en: 'Points for proximity or availability (distance, number of sites, hours). Enter data the buyer can easily verify.' },
  },
  jakosc: {
    pl: 'Jakość i parametry', en: 'Quality and parameters',
    wskazowka: { pl: 'Parametry oferowanego produktu lub usługi. Wpisz wartości z karty katalogowej, bo zamawiający może zażądać dowodu.', en: 'Parameters of the offered product or service. Use values from the datasheet, as proof may be requested.' },
  },
  inne: {
    pl: 'Inne', en: 'Other',
    wskazowka: { pl: 'Nietypowe kryterium. Sprawdź w SWZ, jak jest punktowane.', en: 'An unusual criterion. Check in the documents how it is scored.' },
  },
});

const rodzajZnany = (r) => (Object.prototype.hasOwnProperty.call(RODZAJE_KRYTERIOW, r) ? r : 'inne');

function udzialTekst(k, sposob) {
  if (typeof k.udzial === 'number') return `${String(Math.round(k.udzial * 10) / 10).replace('.', ',')}%`;
  if (typeof k.waga === 'number' && sposob === 'punktowo') return `${k.waga} pkt`;
  return null;
}

/**
 * Ile procent ceny jest wart 1 punkt przewagi w pozostałych kryteriach — przy typowym wzorze
 * „najniższa cena / cena badana × waga”. Oferta droższa o x od najtańszej traci waga·x/(1+x)
 * punktu, więc 1 punkt = x = 1/(waga − 1). Tylko gdy jest JEDNO kryterium ceny z udziałem
 * i coś poza ceną (rabat albo marża jako drugie kryterium mają inny wzór — wtedy milczymy).
 */
export function procentCenyZaPunkt(kryteria) {
  const lista = Array.isArray(kryteria) ? kryteria : [];
  const ceny = lista.filter((k) => k?.rodzaj === 'cena');
  if (ceny.length !== 1 || lista.length < 2) return null;
  const u = ceny[0].udzial;
  if (typeof u !== 'number' || u <= 1 || u >= 100) return null;
  return Math.round((100 / (u - 1)) * 10) / 10;
}

/**
 * Model karty. `dane` = odpowiedź serwera. null, gdy listy nie ma (karta się nie pokazuje).
 * @returns {null|{tylkoCena: boolean, wiersze: object[], procentZaPunkt: number|null, udzialCeny: number|null, rozneWCzesciach: boolean}}
 */
export function kartaKryteriow(dane) {
  if (!dane?.dostepne || !Array.isArray(dane.kryteria) || !dane.kryteria.length) return null;
  const wiersze = dane.kryteria
    .filter((k) => k && typeof k.nazwa === 'string' && k.nazwa.trim())
    .map((k) => {
      const rodzaj = rodzajZnany(k.rodzaj);
      return {
        nazwa: k.nazwa.trim(),
        rodzaj,
        etykieta: RODZAJE_KRYTERIOW[rodzaj],
        wskazowka: RODZAJE_KRYTERIOW[rodzaj].wskazowka,
        udzial: udzialTekst(k, dane.sposob),
        udzialLiczba: typeof k.udzial === 'number' ? k.udzial : null,
      };
    });
  if (!wiersze.length) return null;
  const cena = dane.kryteria.find((k) => k?.rodzaj === 'cena');
  return {
    tylkoCena: wiersze.every((w) => w.rodzaj === 'cena'),
    wiersze,
    procentZaPunkt: procentCenyZaPunkt(dane.kryteria),
    udzialCeny: typeof cena?.udzial === 'number' ? cena.udzial : null,
    rozneWCzesciach: dane.rozne_w_czesciach === true,
  };
}

/** Długość pytania jak w „Zapytaj SWZ” (`lib/zapytajSwz.js`: do 500 znaków). */
const MAKS_NAZWY_W_PYTANIU = 160;

/**
 * Gotowe pytania do „Zapytaj SWZ” o punktowanie kryteriów pozacenowych — najcięższe najpierw.
 * @returns {{pl: string, en: string}[]}
 */
export function pytaniaOKryteria(dane, maks = 2) {
  const karta = kartaKryteriow(dane);
  if (!karta) return [];
  const poza = karta.wiersze
    .filter((w) => w.rodzaj !== 'cena')
    .sort((a, b) => (b.udzialLiczba ?? 0) - (a.udzialLiczba ?? 0));
  return poza.slice(0, maks).map((w) => {
    const nazwa = w.nazwa.length > MAKS_NAZWY_W_PYTANIU ? `${w.nazwa.slice(0, MAKS_NAZWY_W_PYTANIU - 1)}…` : w.nazwa;
    return {
      pl: `Jak punktowane jest kryterium „${nazwa}” i co zadeklarować, żeby dostać maksimum punktów?`,
      en: `How is the criterion "${nazwa}" scored and what should I declare to get the maximum points?`,
    };
  });
}
