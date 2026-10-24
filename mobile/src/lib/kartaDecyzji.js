/**
 * Karta decyzji „startować czy odpuścić?" — scala sygnały, które wykonawca i tak waży w głowie,
 * w jeden werdykt GO / ROZWAŻ / ODPUŚĆ, zanim włoży pracę w ofertę. Ratuje czas i pieniądze na
 * przetargach nie do wygrania albo nierentownych.
 *
 * Każdy czynnik ma wagę i 2–3 odpowiedzi (dobrze/średnio/źle → punkty 1/0.5/0). Niektóre
 * odpowiedzi „źle" to BLOKADY (np. brak wadium, strata, nie spełniam warunków) — pojedyncza
 * blokada wywraca werdykt na ODPUŚĆ, niezależnie od reszty. Czysta logika, w pełni testowalna.
 *
 * Czynniki KRYTYCZNE (poprawka 2026-09-25) = te, które mają odpowiedź blokującą. Dopóki choć
 * jeden z nich jest bez odpowiedzi (i nie padła żadna blokada), werdykt to UZUPEŁNIJ z listą
 * braków — wcześniej samo „dopasowanie: wysokie" dawało 100% i STARTUJ.
 */

export const CZYNNIKI = [
  {
    klucz: 'dopasowanie', pytanie: 'Dopasowanie do profilu firmy', waga: 1,
    opcje: [
      { w: 'wysokie', e: 'Wysokie — to moja działka', p: 1 },
      { w: 'srednie', e: 'Średnie — po części', p: 0.5 },
      { w: 'niskie', e: 'Niskie — z doskoku', p: 0 },
    ],
  },
  {
    klucz: 'warunki', pytanie: 'Spełniam warunki udziału (referencje, potencjał)', waga: 2,
    opcje: [
      { w: 'tak', e: 'Tak, mam komplet', p: 1 },
      { w: 'czesc', e: 'Częściowo — muszę pożyczyć zasoby', p: 0.5 },
      { w: 'nie', e: 'Nie spełniam', p: 0, blokada: 'Nie spełniasz warunków udziału — oferta odpadnie.' },
    ],
  },
  {
    klucz: 'konkurencyjnosc', pytanie: 'Mam czym konkurować (cena albo kryteria)', waga: 1.5,
    opcje: [
      { w: 'tak', e: 'Tak — cena lub jakość po mojej stronie', p: 1 },
      { w: 'srednio', e: 'Średnio — będzie ciasno', p: 0.5 },
      { w: 'nie', e: 'Nie — inni są mocniejsi', p: 0 },
    ],
  },
  {
    klucz: 'plynnosc', pytanie: 'Udźwignę finansowo (płynność do pierwszej faktury)', waga: 2,
    opcje: [
      { w: 'tak', e: 'Tak, mam poduszkę', p: 1 },
      { w: 'napiete', e: 'Napięte — na styk', p: 0.5 },
      { w: 'nie', e: 'Nie — zabraknie gotówki', p: 0, blokada: 'Ryzyko utraty płynności — kontrakt może Cię przewrócić.' },
    ],
  },
  {
    klucz: 'wadium', pytanie: 'Wadium (jeśli wymagane) — mam czym wnieść', waga: 1,
    opcje: [
      { w: 'tak', e: 'Tak / nie dotyczy', p: 1 },
      { w: 'nie', e: 'Wymagane, a nie mam', p: 0, blokada: 'Brak wadium = odrzucenie oferty.' },
    ],
  },
  {
    klucz: 'termin', pytanie: 'Zdążę przygotować ofertę do terminu', waga: 1.5,
    opcje: [
      { w: 'tak', e: 'Tak, spokojnie', p: 1 },
      { w: 'ryzyko', e: 'Ryzykownie — mało czasu', p: 0.5 },
      { w: 'nie', e: 'Nie zdążę', p: 0, blokada: 'Za mało czasu na rzetelną ofertę.' },
    ],
  },
  {
    klucz: 'marza', pytanie: 'Zysk po kosztach jest sensowny', waga: 2,
    opcje: [
      { w: 'tak', e: 'Tak — zarobię', p: 1 },
      { w: 'cienko', e: 'Cienko — ledwie na zero', p: 0.5 },
      { w: 'strata', e: 'Strata — dokładam', p: 0, blokada: 'Przy tej cenie dokładasz do kontraktu.' },
    ],
  },
  {
    klucz: 'umowa', pytanie: 'Warunki umowy (kary, płatności) do przyjęcia', waga: 1,
    opcje: [
      { w: 'tak', e: 'Tak', p: 1 },
      { w: 'ryzyko', e: 'Ryzykowne — wysokie kary', p: 0.5 },
      { w: 'nie', e: 'Nie do przyjęcia', p: 0 },
    ],
  },
];

export const WERDYKTY = {
  start: { etykieta: 'STARTUJ', opis: 'Sygnały na TAK — składaj ofertę.' },
  rozwaz: { etykieta: 'ROZWAŻ', opis: 'Da się, ale są słabe punkty — dociśnij je albo policz dokładniej.' },
  odpusc: { etykieta: 'ODPUŚĆ', opis: 'Szanse/rentowność za niskie — lepiej oszczędzić czas na inny przetarg.' },
  uzupelnij: { etykieta: 'UZUPEŁNIJ', opis: 'Odpowiedz na pytania krytyczne — każde z nich może samo przesądzić o ODPUŚĆ.' },
};

/** Klucze czynników krytycznych: tych, których odpowiedź może być BLOKADĄ. */
export const CZYNNIKI_KRYTYCZNE = Object.freeze(
  CZYNNIKI.filter((c) => c.opcje.some((o) => o.blokada)).map((c) => c.klucz),
);

/**
 * @param {Record<string,string>} odpowiedzi mapa klucz→wartość odpowiedzi
 * @returns {{procent:number, werdykt:'start'|'rozwaz'|'odpusc'|'uzupelnij', zBlokada:boolean,
 *   blokady:Array<{klucz:string,tekst:string}>, brakujaceKrytyczne:Array<{klucz:string,pytanie:string}>,
 *   odpowiedziano:number, wszystkich:number}}
 *   Blokada → zawsze 'odpusc'; bez blokady, ale z brakami krytycznymi → 'uzupelnij'.
 */
/**
 * Auto-prefill karty z ogłoszenia i profilu firmy (2026-10-24): leniwy użytkownik dostaje
 * większość sygnałów ustawionych, a sam poprawia tylko to, czego aplikacja nie wie.
 * ZASADA BEZPIECZEŃSTWA: nigdy nie ustawiamy odpowiedzi BLOKUJĄCEJ („nie zdążę", „nie mam
 * wadium", „zabraknie gotówki") — to decyzja człowieka; automat co najwyżej ostrzega („ryzyko",
 * „napięte"). Czysta funkcja: zegar wchodzi parametrem `teraz`.
 * @returns {{odpowiedzi: object, zrodla: Array<{klucz: string, opis: string}>}}
 */
export function prefillKartyDecyzji(we) {
  const { match, user, teraz = Date.now() } = we && typeof we === 'object' ? we : {};
  const m = match && typeof match === 'object' ? match : {};
  const t = m.tender && typeof m.tender === 'object' ? m.tender : {};
  const u = user && typeof user === 'object' ? user : {};
  const odpowiedzi = {};
  const zrodla = [];

  const s = m.confidence_score;
  if (typeof s === 'number') {
    odpowiedzi.dopasowanie = s >= 70 ? 'wysokie' : s >= 40 ? 'srednie' : 'niskie';
    zrodla.push({ klucz: 'dopasowanie', opis: `ocena dopasowania ${Math.round(s)}%` });
  }

  const deadlineMs = t.deadline ? new Date(t.deadline).getTime() : NaN;
  if (Number.isFinite(deadlineMs) && deadlineMs > teraz) {
    const dni = Math.floor((deadlineMs - teraz) / 86_400_000);
    odpowiedzi.termin = dni >= 7 ? 'tak' : 'ryzyko';
    zrodla.push({ klucz: 'termin', opis: dni >= 7 ? `${dni} dni do składania ofert` : `tylko ${dni} dni do składania — sprawdź, czy zdążysz` });
  }

  if (t.wadium_wymagane === false) {
    odpowiedzi.wadium = 'tak';
    zrodla.push({ klucz: 'wadium', opis: 'zamawiający nie wymaga wadium' });
  }

  const budzet = Number(t.budget);
  const maks = Number(u.wartosc_max);
  if (Number.isFinite(budzet) && budzet > 0 && Number.isFinite(maks) && maks > 0) {
    odpowiedzi.plynnosc = budzet <= maks ? 'tak' : 'napiete';
    zrodla.push({ klucz: 'plynnosc', opis: budzet <= maks ? 'wartość w granicach Twojego limitu kontraktu' : 'wartość powyżej limitu kontraktu z profilu — policz płynność' });
  }

  return { odpowiedzi, zrodla };
}

export function ocenStart(odpowiedzi) {
  let sumaP = 0; let sumaW = 0; let odpowiedziano = 0;
  const blokady = [];
  const brakujaceKrytyczne = [];
  for (const c of CZYNNIKI) {
    const w = odpowiedzi?.[c.klucz];
    const opt = c.opcje.find((o) => o.w === w);
    if (!opt) {
      if (CZYNNIKI_KRYTYCZNE.includes(c.klucz)) brakujaceKrytyczne.push({ klucz: c.klucz, pytanie: c.pytanie });
      continue;
    }
    odpowiedziano += 1;
    sumaP += opt.p * c.waga;
    sumaW += c.waga;
    if (opt.blokada) blokady.push({ klucz: c.klucz, tekst: opt.blokada });
  }
  const procent = sumaW > 0 ? Math.round((100 * sumaP) / sumaW) : 0;
  const zBlokada = blokady.length > 0;
  let werdykt;
  if (zBlokada) werdykt = 'odpusc';
  else if (brakujaceKrytyczne.length > 0) werdykt = 'uzupelnij';
  else if (procent >= 70) werdykt = 'start';
  else if (procent >= 45) werdykt = 'rozwaz';
  else werdykt = 'odpusc';
  return { procent, werdykt, zBlokada, blokady, brakujaceKrytyczne, odpowiedziano, wszystkich: CZYNNIKI.length };
}
