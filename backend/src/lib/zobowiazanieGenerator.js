import {
  ID_POL,
  POLA_ZOBOWIAZANIA,
  walidujKompletnoscZobowiazania,
} from './zobowiazaniePodmiotu.js';
import { normalize } from './textNorm.js';
import { isMainModule } from './ids.js';

/**
 * GENERATOR dokumentu „zobowiązanie podmiotu udostępniającego zasoby" (art. 118
 * ust. 3 i 4 Pzp) — podzadanie 7/12 ulepszenia „Pożycz doświadczenie: kreator
 * polegania na zasobach podmiotu trzeciego".
 *
 * Czysta funkcja model→tekst, bez UI, bez I/O, bez sieci. Bierze wypełniony model
 * z podzadania 4/12 ({@link szablonZobowiazania}) plus meta identyfikującą
 * postępowanie i strony (spoza modelu) i składa gotowy do podpisu tekst pisma ze
 * WSZYSTKIMI elementami, które orzecznictwo KIO/TSUE uznaje za konieczne, by
 * udostępnienie zasobów było realne, a nie fikcyjne.
 *
 * Świadome decyzje:
 *  • JEDNO ŹRÓDŁO PRAWDY: co jest wymagane i jak się nazywa — czyta z modelu
 *    (`POLA_ZOBOWIAZANIA`, `walidujKompletnoscZobowiazania`), a nie z własnej listy.
 *    Dołożenie/zmiana pola w modelu automatycznie przechodzi na dokument i braki,
 *    bez rozjazdu „formularz mówi co innego niż pismo".
 *  • NIE „GUBI" braku po cichu: brakujące pole WYMAGANE renderuje się jako widoczny
 *    marker `[UZUPEŁNIJ: …]` ORAZ podnosi `kompletne=false` i wykazuje `braki`.
 *    Dokument, który wygląda na gotowy do podpisu, a pomija np. zakres
 *    podwykonawstwa, to dokładnie ta pułapka fikcyjności, którą cały kreator
 *    zwalcza — lepiej głośny brak niż ciche, pozorne zobowiązanie.
 *  • NIEZMIENNIKI PRAWNE zawsze w treści, niezależnie od danych: klauzula
 *    RZECZYWISTEGO udziału podmiotu (art. 118 ust. 2 — filar niefikcyjności) oraz
 *    przypomnienie, że pismo składa się WRAZ Z OFERTĄ i podpisuje je sam podmiot.
 *  • DETERMINIZM: data pisma jest WSTRZYKIWANA (`data_pisma`); nic tu nie sięga po
 *    `Date.now()` — brak daty daje placeholder `[data]`, nie „dzisiaj".
 *  • Meta (wykonawca, zamawiający, przedmiot, numer, miejscowość, data) to KONTEKST,
 *    nie warunek prawnej kompletności — przy braku wchodzą placeholdery `[...]`,
 *    ale nie blokują `kompletne` (o kompletności decydują pola modelu).
 *  • Wynik jest ZAMROŻONY — to migawka złożenia dokumentu.
 */

/** Czy wartość jest niepustym (po przycięciu) stringiem. */
function niepustyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** Bezpiecznie czyta wartość spod ścieżki (np. ['dane_podmiotu','nazwa']). */
function odczytajSciezke(obiekt, sciezka) {
  let biezacy = obiekt;
  for (const segment of sciezka) {
    if (biezacy === null || typeof biezacy !== 'object') return undefined;
    biezacy = biezacy[segment];
  }
  return biezacy;
}

/** Szybki dostęp do metadanych pola modelu po jego id (jedno źródło prawdy). */
const POLE_WG_ID = new Map(POLA_ZOBOWIAZANIA.map((p) => [p.id, p]));

/**
 * Zwraca przyciętą wartość pola modelu spod jego id, a gdy pole jest puste —
 * widoczny marker: `[UZUPEŁNIJ: <etykieta>]` dla pól wymaganych albo `[<placeholder>]`
 * dla zalecanych. Etykieta i ścieżka pochodzą z modelu, więc nie da się ich rozjechać.
 */
function wartoscPola(zobowiazanie, idPola, placeholderZalecany) {
  const pole = POLE_WG_ID.get(idPola);
  const wartosc = odczytajSciezke(zobowiazanie, pole.sciezka);
  if (niepustyString(wartosc)) return wartosc.trim();
  return pole.wymagane ? `[UZUPEŁNIJ: ${pole.etykieta}]` : `[${placeholderZalecany}]`;
}

/** Meta jako niepusty string lub czytelny placeholder `[etykieta]`. */
function meta(wartosc, placeholder) {
  return niepustyString(wartosc) ? wartosc.trim() : `[${placeholder}]`;
}

/** Slug do nazwy pliku: bez diakrytyków, tylko [a-z0-9-]. Pusty → 'podmiot'. */
function slug(s) {
  const out = normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'podmiot';
}

/** Składa treść pisma z wartości modelu i meta. */
function budujTresc(zobowiazanie, m) {
  const nazwaPodmiotu = wartoscPola(zobowiazanie, ID_POL.DANE_PODMIOTU_NAZWA);
  const identyfikator = wartoscPola(zobowiazanie, ID_POL.DANE_PODMIOTU_IDENTYFIKATOR);
  const adres = odczytajSciezke(zobowiazanie, ['dane_podmiotu', 'adres']);
  const reprezentant = wartoscPola(
    zobowiazanie, ID_POL.DANE_PODMIOTU_REPREZENTANT,
    'imię i nazwisko osoby uprawnionej do reprezentacji podmiotu',
  );

  const wykonawca = meta(m.wykonawca, 'Wykonawca');
  const zamawiajacy = meta(m.zamawiajacy, 'Zamawiający');
  const przedmiot = meta(m.przedmiot_zamowienia, 'przedmiot zamówienia');
  const numer = meta(m.numer_postepowania, 'numer postępowania');
  const miejscowosc = meta(m.miejscowosc, 'miejscowość');
  const dataPisma = meta(m.data_pisma, 'data');

  const linie = [];
  linie.push(`${miejscowosc}, dnia ${dataPisma}`);
  linie.push('');
  // Nagłówek — podmiot udostępniający (to on składa i podpisuje pismo)
  linie.push(nazwaPodmiotu);
  if (niepustyString(adres)) linie.push(adres.trim());
  linie.push(identyfikator);
  linie.push('');
  linie.push('ZOBOWIĄZANIE PODMIOTU UDOSTĘPNIAJĄCEGO ZASOBY');
  linie.push('(art. 118 ust. 3 i 4 ustawy z 11 września 2019 r. — Prawo zamówień publicznych)');
  linie.push('');
  linie.push(
    `Działając jako podmiot udostępniający zasoby w rozumieniu art. 118 ustawy Pzp, `
    + `zobowiązuję się do oddania do dyspozycji Wykonawcy ${wykonawca} zasobów niezbędnych `
    + `do wykonania zamówienia pn. „${przedmiot}" (postępowanie nr ${numer}), prowadzonego `
    + `przez Zamawiającego ${zamawiajacy}, na następujących zasadach:`,
  );
  linie.push('');
  linie.push('1. Zakres udostępnianych zasobów (doświadczenia) — art. 118 ust. 4 pkt 1 Pzp:');
  linie.push(`   ${wartoscPola(zobowiazanie, ID_POL.ZAKRES_DOSWIADCZENIA)}`);
  linie.push('');
  linie.push('2. Sposób udostępnienia i wykorzystania zasobów przy wykonywaniu zamówienia — art. 118 ust. 4 pkt 2 Pzp:');
  linie.push(`   ${wartoscPola(zobowiazanie, ID_POL.SPOSOB_UDOSTEPNIENIA)}`);
  linie.push('');
  linie.push('3. Okres udostępnienia zasobów — art. 118 ust. 4 pkt 2 Pzp:');
  linie.push(`   ${wartoscPola(zobowiazanie, ID_POL.OKRES_UDOSTEPNIENIA)}`);
  linie.push('');
  linie.push('4. Zakres i sposób udziału w realizacji zamówienia (podwykonawstwo) — art. 118 ust. 4 pkt 3 Pzp:');
  linie.push(`   ${wartoscPola(zobowiazanie, ID_POL.ZAKRES_PODWYKONAWSTWA)}`);
  linie.push('');
  // Klauzula realnego udziału — filar niefikcyjności (zawsze obecna)
  linie.push(
    'Oświadczam, że stosownie do art. 118 ust. 2 ustawy Pzp — jako podmiot udostępniający '
    + 'doświadczenie w zakresie robót budowlanych lub usług — RZECZYWIŚCIE zrealizuję wskazaną '
    + 'wyżej część zamówienia, do której to doświadczenie jest wymagane. Udostępnienie zasobów '
    + 'nie ogranicza się do przekazania referencji.',
  );
  linie.push('');
  // Przypomnienie o złożeniu wraz z ofertą i podpisie podmiotu (zawsze obecne)
  linie.push(
    'Niniejsze zobowiązanie składam wraz z ofertą Wykonawcy i podpisuję we własnym imieniu jako '
    + 'podmiot udostępniający zasoby.',
  );
  linie.push('');
  linie.push('.......................................');
  linie.push(reprezentant);
  linie.push('(podpis podmiotu udostępniającego zasoby)');
  return linie.join('\n');
}

/**
 * Generuje dokument „zobowiązanie podmiotu udostępniającego zasoby" z wypełnionego
 * modelu 4/12 i meta postępowania.
 * @param {object} zobowiazanie draft/model zobowiązania (jak z {@link szablonZobowiazania}).
 * @param {object} [metaDane] kontekst postępowania i strony (spoza modelu).
 * @param {string} [metaDane.wykonawca] wykonawca polegający na zasobach.
 * @param {string} [metaDane.zamawiajacy]
 * @param {string} [metaDane.przedmiot_zamowienia]
 * @param {string} [metaDane.numer_postepowania]
 * @param {string} [metaDane.miejscowosc]
 * @param {string} [metaDane.data_pisma] data pisma (WSTRZYKIWANA — funkcja deterministyczna).
 * @returns {{kompletne: boolean, braki: object[], ostrzezenia: object[], tresc: string,
 *   nazwaPliku: string}} obiekt ZAMROŻONY.
 * @throws {TypeError} gdy `zobowiazanie` nie jest zwykłym obiektem.
 */
export function generujZobowiazanie(zobowiazanie, metaDane = {}) {
  if (zobowiazanie === null || typeof zobowiazanie !== 'object' || Array.isArray(zobowiazanie)) {
    throw new TypeError('generujZobowiazanie: zobowiazanie musi być obiektem');
  }
  const m = (metaDane && typeof metaDane === 'object' && !Array.isArray(metaDane)) ? metaDane : {};

  const walidacja = walidujKompletnoscZobowiazania(zobowiazanie);
  const tresc = budujTresc(zobowiazanie, m);
  const zrodloNazwy = odczytajSciezke(zobowiazanie, ['dane_podmiotu', 'nazwa'])
    || m.numer_postepowania;

  return Object.freeze({
    kompletne: walidacja.kompletne,
    braki: walidacja.braki,
    ostrzezenia: walidacja.ostrzezenia,
    tresc,
    nazwaPliku: `zobowiazanie-podmiotu-${slug(zrodloNazwy)}.txt`,
  });
}

/**
 * Eksport zobowiązania do pliku — deskryptor pliku tekstowego (bez I/O, testowalny).
 * ODMAWIA eksportu dokumentu niekompletnego: zobowiązanie z brakującym elementem
 * wymaganym nie jest gotowe do podpisu i nie wolno go podać jak gotowego.
 * @param {ReturnType<typeof generujZobowiazanie>} wynik
 * @returns {{nazwa: string, typ: string, zawartosc: string}}
 * @throws {Error} gdy zobowiązanie jest niekompletne (niegotowe do podpisu).
 */
export function zobowiazanieDoPliku(wynik) {
  if (!wynik?.kompletne) {
    throw new Error(
      'Nie można wyeksportować niekompletnego zobowiązania — uzupełnij pola wymagane '
      + 'orzecznictwem, zanim dokument będzie gotowy do podpisu.',
    );
  }
  return {
    nazwa: wynik.nazwaPliku,
    typ: 'text/plain; charset=utf-8',
    zawartosc: wynik.tresc,
  };
}

// Podgląd: `node src/lib/zobowiazanieGenerator.js --demo`
if (isMainModule(import.meta.url) && process.argv.includes('--demo')) {
  const demo = generujZobowiazanie(
    {
      dane_podmiotu: {
        nazwa: 'Budrem Sp. z o.o.',
        identyfikator: 'NIP 5252525252',
        adres: 'ul. Budowlana 1, 00-001 Warszawa',
        reprezentant: 'Jan Kowalski, prezes zarządu',
      },
      zakres_doswiadczenia:
        'Budowa oczyszczalni ścieków o przepustowości min. 5000 m³/d (jedna realizacja, 6,2 mln zł).',
      sposob_udostepnienia:
        'Udział jako podwykonawca robót technologicznych oraz nadzór własnej kadry nad tym zakresem.',
      okres_udostepnienia: 'Przez cały okres realizacji zamówienia (18 miesięcy).',
      zakres_podwykonawstwa:
        'Wykonanie części technologicznej oczyszczalni (montaż i rozruch ciągu technologicznego).',
    },
    {
      wykonawca: 'Instal-Bud Nowak Sp.k.', zamawiajacy: 'Gmina Przykładowa',
      przedmiot_zamowienia: 'Budowa oczyszczalni ścieków', numer_postepowania: 'ZP/12/2026',
      miejscowosc: 'Warszawa', data_pisma: '2026-07-26',
    },
  );
  console.log(JSON.stringify({
    kompletne: demo.kompletne, braki: demo.braki, nazwaPliku: demo.nazwaPliku,
  }, null, 2));
  console.log('\n--- treść ---\n');
  console.log(demo.tresc);
}
