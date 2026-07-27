/**
 * Generator PISMA DO ZAMAWIAJĄCEGO z żądaniem przedłużenia terminu składania ofert
 * (ulepszenie „Czarna skrzynka składania oferty — dowody na awarię platformy",
 * podzadanie 4/7).
 *
 * Z gotowego PAKIETU DOWODOWEGO (podzadanie 3/7, `createPakietDowodowy.zbudujPakiet`)
 * składa gotowe do wysłania pismo. Sytuacja jest krytyczna czasowo: jeśli platforma
 * zawiedzie, pismo trzeba wysłać JESZCZE PRZED upływem terminu składania — po nim
 * czynności nie da się powtórzyć. KIO konsekwentnie wskazuje, że ciężar udowodnienia
 * awarii spoczywa na wykonawcy, a bez utrwalonych NA BIEŻĄCO dowodów odwołanie
 * przepada. Dlatego pismo:
 *   • powołuje się na dowody utrwalone na bieżąco (zrzuty z czasem, log dostępności,
 *     hash oferty, tamper-evidentną sumę kontrolną pakietu),
 *   • opisuje awarię ZE ZNACZNIKAMI CZASU (wprost z pakietu — nie „na oko"),
 *   • żąda przedłużenia terminu i wskazuje linię orzeczniczą KIO (ciężar dowodu).
 *
 * Świadome decyzje (spójnie z `lib/zobowiazanieGenerator.js`):
 *  • CZYSTA funkcja model→tekst: bez UI, bez I/O, bez sieci, bez `Date.now()`. Data
 *    pisma jest WSTRZYKIWANA (`data_pisma`) — funkcja jest deterministyczna.
 *  • NIE „GUBI" braku po cichu: brakujące pole meta WYMAGANE renderuje się jako
 *    widoczny marker `[UZUPEŁNIJ: …]` i podnosi `kompletne=false` z wykazem `braki`.
 *    Osobno: gdy pakiet NIE ma wykrytej awarii, pismo nie zmyśla awarii — wstawia
 *    marker i `kompletne=false` (nie wolno podać jak gotowego pisma o awarii, której
 *    nie ma).
 *  • Opis awarii i wykaz załączników pochodzą z PAKIETU (jedno źródło prawdy) — nie z
 *    ręcznie przepisanej listy, żeby dokument nie rozjechał się z dowodami.
 *  • Wynik jest ZAMROŻONY — to migawka pisma na moment złożenia.
 *
 * Moduł samowystarczalny (zero importów) — świadomie nie dopina się do współdzielonych
 * plików, które w drzewie roboczym mają cudzy WIP.
 */

// ─────────────────────────── Pomocnicze (czyste) ────────────────────────────

/** Czy wartość jest niepustym (po przycięciu) stringiem. */
function niepustyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** Polska nazwa typu awarii (spójna z detektorem `wykryjAwarie` z pakietu 3/7). */
const ETYKIETA_AWARII = {
  blad_wysylki: 'błąd wysyłki oferty',
  brak_epo: 'brak Elektronicznego Poświadczenia Odbioru (EPO)',
  niedostepnosc: 'niedostępność platformy',
};

/** Slug do nazwy pliku: bez polskich diakrytyków, tylko [a-z0-9-]. Pusty → 'postepowanie'. */
function slug(s) {
  const mapa = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  const bezDiakr = String(s ?? '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => mapa[c] || c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const out = bezDiakr.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'postepowanie';
}

// ─────────────────────────── Opis awarii + wykaz załączników ─────────────────

/**
 * Zamienia powody awarii z pakietu na czytelne linie „<nazwa typu> — <czas> (<strefa>):
 * <opis>". Znaczniki czasu pochodzą z append-only logu (zegar serwera) — to one nadają
 * dowodowi wartość. Funkcja CZYSTA. Zwraca `[]`, gdy pakiet nie wykazuje awarii.
 * @param {object} pakiet pakiet dowodowy (`zbudujPakiet`)
 * @returns {string[]}
 */
export function opiszAwarie(pakiet) {
  const powody = pakiet && pakiet.awaria && Array.isArray(pakiet.awaria.powody)
    ? pakiet.awaria.powody
    : [];
  return powody.map((p) => {
    const etykieta = ETYKIETA_AWARII[p.typ] || p.typ || 'awaria';
    const czas = niepustyString(p.czas_serwera)
      ? `${p.czas_serwera}${niepustyString(p.strefa_czasowa) ? ` (${p.strefa_czasowa})` : ''}`
      : 'czas nieutrwalony';
    const opis = niepustyString(p.opis) ? p.opis.trim() : 'bez dodatkowego opisu';
    return `${etykieta} — ${czas}: ${opis}`;
  });
}

/**
 * Buduje wykaz utrwalonych dowodów (załączników) z manifestu pakietu. To one czynią
 * pakiet wiarygodnym w postępowaniu przed KIO. Funkcja CZYSTA.
 * @param {object} pakiet pakiet dowodowy (`zbudujPakiet`)
 * @returns {string[]}
 */
export function wykazZalacznikow(pakiet) {
  const manifest = (pakiet && pakiet.manifest) || {};
  const liczby = manifest.liczby || {};
  const liczbaZrzutow = liczby.zrzuty ?? (Array.isArray(manifest.zrzuty) ? manifest.zrzuty.length : 0);
  const liczbaPingow = liczby.pingi ?? (Array.isArray(manifest.dostepnosc) ? manifest.dostepnosc.length : 0);
  const liczbaZdarzen = liczby.zdarzenia ?? (Array.isArray(manifest.przebieg) ? manifest.przebieg.length : 0);

  const zal = [];
  zal.push(`Zrzuty ekranu z widocznym czasem — ${liczbaZrzutow} szt.`);
  zal.push(`Log cyklicznego sprawdzania dostępności platformy — ${liczbaPingow} pomiar(y)`);
  zal.push(`Zapis pełnego przebiegu sesji składania oferty (append-only) — ${liczbaZdarzen} zdarzeń`);
  if (pakiet && pakiet.oferta && niepustyString(pakiet.oferta.hash)) {
    zal.push(`Suma kontrolna (SHA-256) pliku oferty: ${pakiet.oferta.hash}`);
  }
  if (pakiet && niepustyString(pakiet.sumaKontrolna)) {
    zal.push(`Suma kontrolna całości pakietu dowodowego (tamper-evident, SHA-256): ${pakiet.sumaKontrolna}`);
  }
  return zal;
}

// ─────────────────────────── Meta postępowania i stron ──────────────────────

/** Pola meta (spoza pakietu). `wymagane` decyduje o `kompletne`; reszta to kontekst. */
const POLA_META = [
  { klucz: 'zamawiajacy', etykieta: 'Zamawiający (nazwa i adres)', wymagane: true },
  { klucz: 'numer_postepowania', etykieta: 'numer postępowania', wymagane: true },
  { klucz: 'przedmiot_zamowienia', etykieta: 'przedmiot zamówienia', wymagane: true },
  { klucz: 'wykonawca', etykieta: 'Wykonawca (nazwa, adres, NIP)', wymagane: true },
  { klucz: 'termin_skladania', etykieta: 'termin składania ofert', wymagane: true },
  { klucz: 'miejscowosc', etykieta: 'miejscowość', wymagane: false },
  { klucz: 'data_pisma', etykieta: 'data', wymagane: false },
];

/**
 * Wartość pola meta jako niepusty string albo widoczny marker: `[UZUPEŁNIJ: …]` dla
 * wymaganych, `[…]` dla kontekstowych. Zgłasza `brak` tylko dla pól wymaganych.
 */
function wartoscMeta(m, pole) {
  const v = m[pole.klucz];
  if (niepustyString(v)) return { tekst: v.trim(), brak: false };
  const marker = pole.wymagane ? `[UZUPEŁNIJ: ${pole.etykieta}]` : `[${pole.etykieta}]`;
  return { tekst: marker, brak: pole.wymagane };
}

// ─────────────────────────── Składanie treści pisma ─────────────────────────

const MARKER_AWARII = '[UZUPEŁNIJ: opis awarii platformy — pakiet nie wykazuje awarii]';

/** Składa gotowy tekst pisma z wartości meta, opisu awarii i wykazu załączników. */
function budujTresc(w, liniaAwarii, maAwarie, zalaczniki) {
  const linie = [];
  linie.push(`${w.miejscowosc}, dnia ${w.data_pisma}`);
  linie.push('');
  linie.push('Wykonawca:');
  linie.push(w.wykonawca);
  linie.push('');
  linie.push('Do:');
  linie.push('Zamawiający');
  linie.push(w.zamawiajacy);
  linie.push('');
  linie.push('WNIOSEK O PRZEDŁUŻENIE TERMINU SKŁADANIA OFERT');
  linie.push(`dotyczy postępowania nr ${w.numer_postepowania} pn. „${w.przedmiot_zamowienia}"`);
  linie.push('');
  linie.push(
    `Działając w imieniu Wykonawcy ${w.wykonawca}, w postępowaniu prowadzonym przez `
    + `Zamawiającego ${w.zamawiajacy}, którego przedmiotem jest „${w.przedmiot_zamowienia}" `
    + `(nr postępowania ${w.numer_postepowania}), wnoszę — jeszcze PRZED upływem terminu `
    + `składania ofert — o przedłużenie wyznaczonego terminu składania ofert `
    + `(${w.termin_skladania}) o czas odpowiadający okresowi niedostępności / niesprawności `
    + `platformy, z uwagi na awarię uniemożliwiającą skuteczne złożenie oferty.`,
  );
  linie.push('');
  linie.push('1. Opis awarii ze znacznikami czasu (utrwalone na bieżąco):');
  if (maAwarie) {
    for (const l of liniaAwarii) linie.push(`   • ${l}`);
  } else {
    linie.push(`   ${MARKER_AWARII}`);
  }
  linie.push('');
  linie.push(
    '2. Podstawa żądania. Zgodnie z utrwaloną linią orzeczniczą Krajowej Izby Odwoławczej '
    + '(KIO) ciężar udowodnienia awarii platformy oraz jej wpływu na możliwość złożenia oferty '
    + 'spoczywa na wykonawcy. Dlatego przebieg próby złożenia oferty był rejestrowany i utrwalany '
    + 'NA BIEŻĄCO — dowody powstały w czasie rzeczywistym, przed upływem terminu składania ofert, '
    + 'a nie zostały zrekonstruowane po fakcie. Wykaz utrwalonych dowodów stanowi załącznik do '
    + 'niniejszego pisma.',
  );
  linie.push('');
  linie.push(
    '3. Wobec powyższego wnoszę o przedłużenie terminu składania ofert w sposób umożliwiający '
    + 'skuteczne złożenie oferty po przywróceniu sprawności platformy. Zwracam uwagę na pilny '
    + 'charakter sprawy — po upływie terminu składania ofert czynności tej nie da się powtórzyć.',
  );
  linie.push('');
  linie.push('Wykaz załączników (dowody utrwalone na bieżąco):');
  zalaczniki.forEach((z, i) => linie.push(`   ${i + 1}) ${z}`));
  linie.push('');
  linie.push('.......................................');
  linie.push('(podpis osoby uprawnionej do reprezentacji Wykonawcy)');
  return linie.join('\n');
}

/**
 * Generuje pismo do zamawiającego z żądaniem przedłużenia terminu składania ofert z
 * pakietu dowodowego (3/7) i meta postępowania.
 * @param {object} pakiet pakiet dowodowy (`createPakietDowodowy.zbudujPakiet`).
 * @param {object} [metaDane] kontekst postępowania i strony (spoza pakietu).
 * @param {string} [metaDane.zamawiajacy]
 * @param {string} [metaDane.numer_postepowania]
 * @param {string} [metaDane.przedmiot_zamowienia]
 * @param {string} [metaDane.wykonawca]
 * @param {string} [metaDane.termin_skladania] termin składania ofert (opis/ISO).
 * @param {string} [metaDane.miejscowosc]
 * @param {string} [metaDane.data_pisma] data pisma (WSTRZYKIWANA — funkcja deterministyczna).
 * @returns {{kompletne: boolean, braki: object[], tresc: string, nazwaPliku: string}}
 *   obiekt ZAMROŻONY.
 * @throws {TypeError} gdy `pakiet` nie jest zwykłym obiektem pakietu dowodowego.
 */
export function generujPismoOPrzedluzenie(pakiet, metaDane = {}) {
  if (pakiet === null || typeof pakiet !== 'object' || Array.isArray(pakiet)) {
    throw new TypeError('generujPismoOPrzedluzenie: pakiet musi być obiektem pakietu dowodowego');
  }
  const m = (metaDane && typeof metaDane === 'object' && !Array.isArray(metaDane)) ? metaDane : {};

  const braki = [];
  const w = {};
  for (const pole of POLA_META) {
    const wartosc = wartoscMeta(m, pole);
    w[pole.klucz] = wartosc.tekst;
    if (wartosc.brak) braki.push({ pole: pole.klucz, etykieta: pole.etykieta });
  }

  const liniaAwarii = opiszAwarie(pakiet);
  const maAwarie = Boolean(pakiet.awaria && pakiet.awaria.awaria) && liniaAwarii.length > 0;
  if (!maAwarie) braki.push({ pole: 'awaria', etykieta: 'opis awarii platformy' });

  const zalaczniki = wykazZalacznikow(pakiet);
  const tresc = budujTresc(w, liniaAwarii, maAwarie, zalaczniki);

  const zrodloNazwy = niepustyString(m.numer_postepowania) ? m.numer_postepowania : 'postepowanie';
  return Object.freeze({
    kompletne: braki.length === 0,
    braki,
    tresc,
    nazwaPliku: `pismo-o-przedluzenie-${slug(zrodloNazwy)}.txt`,
  });
}
