/**
 * Generator wniosku o udostępnienie protokołu postępowania wraz z załącznikami —
 * podzadanie 5/13 ulepszenia „Prześwietlenie oferty zwycięzcy i szansa na
 * odwołanie".
 *
 * WYŁĄCZNIE czysta funkcja: bierze postępowanie/tender (albo model
 * {@link ../lib/poprzetargowaKontrola PoprzetargowaKontrola}) i zwraca gotowy do
 * pobrania dokument (tytuł + treść pisma + sugerowana nazwa pliku + typ MIME).
 * Sam szablon i wypełnianie — bez UI, bez storage, bez pobierania pliku (to
 * zrobi kolejne podzadanie na ekranie).
 *
 * Podstawa prawna kodowana w piśmie:
 *  - art. 18 ust. 1 ustawy z dnia 11 września 2019 r. — Prawo zamówień publicznych
 *    (dalej „Pzp") — zasada jawności postępowania,
 *  - art. 74 ust. 1 Pzp — protokół postępowania jest jawny i udostępnia się go na
 *    wniosek,
 *  - art. 74 ust. 2 pkt 1 Pzp — oferty wraz z załącznikami udostępnia się
 *    niezwłocznie po otwarciu ofert, nie później jednak niż w terminie 3 dni od
 *    dnia otwarcia ofert.
 *
 * Determinizm jak w {@link ../lib/terminKio}: NIE wołamy `Date.now()` — datę
 * pisma wstrzykuje wołający przez `opcje.dataPisma` (brak → placeholder do
 * uzupełnienia ręcznie). Braki danych NIGDY nie wywracają generatora: wstawiamy
 * czytelny placeholder `[…]`, żeby użytkownik uzupełnił pismo, zamiast wypisywać
 * „undefined"/„null".
 */

export const TYTUL_WNIOSKU =
  'Wniosek o udostępnienie protokołu postępowania wraz z załącznikami';

/**
 * Podstawa prawna wniosku (krótkie oznaczenia przepisów). Wystawiona osobno, żeby
 * ekran/analiza mogły ją pokazać bez parsowania treści pisma. Kolejność = tok
 * wywodu w piśmie: zasada jawności → jawność protokołu → jawność ofert (3 dni).
 */
export const PODSTAWA_PRAWNA_WNIOSKU = [
  'art. 18 ust. 1 Pzp',
  'art. 74 ust. 1 Pzp',
  'art. 74 ust. 2 pkt 1 Pzp',
];

/**
 * Pierwsza wartość z listy, która nie jest null/undefined (zachowuje 0/false).
 * Ten sam wzorzec priorytetu źródeł pól co w {@link ../lib/poprzetargowaKontrola}.
 */
function pierwsze(...wartosci) {
  for (const w of wartosci) if (w !== undefined && w !== null) return w;
  return null;
}

/** Niepusty, przycięty tekst albo null. Liczby (np. tender.id) sprowadzamy do stringa. */
function tekstAlboNull(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Formatuje datę do polskiego zapisu `DD.MM.RRRR`. Dla stringa ISO bierzemy
 * pierwsze 10 znaków (YYYY-MM-DD), deterministycznie i bez przesuwania dnia przez
 * strefę czasową — spójnie z {@link ../lib/terminKio}. Wejścia bez rozpoznawalnej
 * daty zwracamy w postaci surowej (best-effort), a puste → null.
 */
function formatujDatePL(wartosc) {
  const tekst = tekstAlboNull(wartosc);
  if (tekst === null) return null;
  const m = tekst.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return tekst; // nierozpoznany format — pokazujemy jak jest, nie zgadujemy
}

/** Bezpieczny fragment nazwy pliku: litery/cyfry/kropka/myślnik; reszta → myślnik. */
function slugId(id) {
  return String(id)
    .trim()
    .replace(/[^a-zA-Z0-9.-]+/g, '-') // spacje, ukośniki, „/" numeru ogłoszenia itd.
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Wyciąga z wejścia pola potrzebne do pisma. Wejściem może być surowy tender,
 * postępowanie z zagnieżdżonym `tender`, albo model
 * {@link ../lib/poprzetargowaKontrola PoprzetargowaKontrola}. Priorytety pól:
 * najpierw pola „poprzetargowej kontroli" (już znormalizowane), potem pola tendera.
 */
function wyciagnijDane(postepowanie) {
  const post = postepowanie ?? {};
  const tender = post.tender ?? {};

  return {
    id: tekstAlboNull(pierwsze(post.postepowanieId, post.id, tender.id)),
    zamawiajacy: tekstAlboNull(
      pierwsze(post.daneZamawiajacego, post.organization, tender.organization),
    ),
    nazwa: tekstAlboNull(pierwsze(post.nazwa, post.title, tender.title)),
    // Otwarcie ofert: kontrola trzyma je wprost; dla surowego tendera używamy
    // `deadline` (otwarcie następuje zaraz po upływie terminu składania) — tak
    // samo jak `utworzKontrolePoPrzegranej` w poprzetargowaKontrola.js.
    dataOtwarciaOfert: formatujDatePL(
      pierwsze(post.dataOtwarciaOfert, post.deadline, tender.deadline),
    ),
    urlOgloszenia: tekstAlboNull(pierwsze(post.url, tender.url)),
  };
}

/**
 * Buduje treść pisma. Braki danych → placeholder `[…]` (do ręcznego uzupełnienia).
 * Reguła jawności ofert („po otwarciu ofert", „3 dni") jest w treści jako cytat z
 * przepisu; jeśli znamy datę otwarcia — dopisujemy ją zdaniem informacyjnym.
 */
function budujTresc(dane, opcje) {
  const dataPisma = formatujDatePL(opcje?.dataPisma) ?? '[miejscowość], [data]';
  const wnioskodawca = tekstAlboNull(opcje?.wnioskodawca) ?? '[nazwa i adres wnioskodawcy]';
  const zamawiajacy = dane.zamawiajacy ?? '[nazwa i adres zamawiającego]';
  const nazwa = dane.nazwa ?? '[nazwa/przedmiot postępowania]';

  // Oznaczenie postępowania: numer + ewentualnie link do ogłoszenia.
  const oznaczenia = [];
  if (dane.id) oznaczenia.push(`znak/nr postępowania: ${dane.id}`);
  if (dane.urlOgloszenia) oznaczenia.push(`ogłoszenie: ${dane.urlOgloszenia}`);
  const wierszOznaczenia = oznaczenia.length ? `\n${oznaczenia.join('\n')}` : '';

  // Zdanie o dacie otwarcia — tylko gdy znamy datę (inaczej sama reguła prawna).
  const zdanieOtwarcia = dane.dataOtwarciaOfert
    ? ` Otwarcie ofert w niniejszym postępowaniu nastąpiło w dniu ${dane.dataOtwarciaOfert}.`
    : '';

  return [
    dataPisma,
    '',
    'Wnioskodawca:',
    wnioskodawca,
    '',
    'Do zamawiającego:',
    zamawiajacy,
    '',
    TYTUL_WNIOSKU.toUpperCase(),
    '',
    `Dotyczy postępowania: ${nazwa}${wierszOznaczenia}`,
    '',
    'Na podstawie art. 74 ust. 1 ustawy z dnia 11 września 2019 r. – Prawo zamówień',
    'publicznych (dalej „Pzp"), w związku z zasadą jawności postępowania wyrażoną w',
    'art. 18 ust. 1 Pzp, wnoszę o udostępnienie protokołu wyżej wymienionego',
    'postępowania.',
    '',
    'Na podstawie art. 74 ust. 2 pkt 1 Pzp wnoszę ponadto o udostępnienie ofert',
    'złożonych w postępowaniu wraz z załącznikami, w tym oferty wykonawcy wybranego',
    'jako najkorzystniejsza. Oferty wraz z załącznikami udostępnia się niezwłocznie',
    `po otwarciu ofert, nie później jednak niż w terminie 3 dni od dnia otwarcia ofert.${zdanieOtwarcia}`,
    '',
    'Proszę o udostępnienie dokumentów przy użyciu środków komunikacji elektronicznej,',
    'w formie umożliwiającej ich zapisanie i wydruk, na adres wskazany poniżej.',
    '',
    'Z poważaniem,',
    '[podpis wnioskodawcy]',
  ].join('\n');
}

/**
 * Generuje wniosek o udostępnienie protokołu postępowania wraz z załącznikami.
 *
 * Nazwa i pierwszy argument zgodnie ze specyfikacją podzadania. Drugi argument
 * (opcjonalny) wstrzykuje dane spoza postępowania — jak `teraz` w
 * {@link ../lib/terminKio pozostaly_czas_do} — więc funkcja pozostaje czysta i
 * deterministyczna (brak `Date.now()`).
 *
 * @param {object|null|undefined} postepowanie surowy tender, postępowanie z
 *   zagnieżdżonym `tender`, albo model `PoprzetargowaKontrola`. Braki pól →
 *   placeholdery w piśmie (best-effort — nie rzuca).
 * @param {{ wnioskodawca?: string, dataPisma?: string }} [opcje]
 *   `wnioskodawca` — dane firmy składającej wniosek; `dataPisma` — data pisma
 *   (ISO `YYYY-MM-DD` lub gotowy tekst). Brak → placeholdery.
 * @returns {{ tytul: string, nazwaPliku: string, typMime: string,
 *   podstawaPrawna: string[], tresc: string }} dokument gotowy do pobrania.
 */
export function wygeneruj_wniosek_o_protokol(postepowanie, opcje) {
  const dane = wyciagnijDane(postepowanie);
  const tresc = budujTresc(dane, opcje);

  const nazwaPliku = dane.id
    ? `wniosek-o-protokol-${slugId(dane.id)}.txt`
    : 'wniosek-o-protokol.txt';

  return {
    tytul: TYTUL_WNIOSKU,
    nazwaPliku,
    typMime: 'text/plain; charset=utf-8',
    podstawaPrawna: [...PODSTAWA_PRAWNA_WNIOSKU],
    tresc,
  };
}
