/**
 * Model: poprzetargowa kontrola oferty zwycięzcy — podzadanie 1/13 ulepszenia
 * „Prześwietlenie oferty zwycięzcy i szansa na odwołanie".
 *
 * Kontekst: gdy użytkownik przegrywa postępowanie, aplikacja prowadzi go przez
 * wniosek o protokół i oferty konkurencji → analizę przesłanek odrzucenia
 * zwycięzcy → decyzję o odwołaniu do KIO. Ten plik to WYŁĄCZNIE model danych
 * powiązany z postępowaniem plus zapis/odczyt. Bez logiki: `terminOdwolaniaKio`
 * jest tu tylko PRZECHOWYWANY (wyliczany w kolejnym podzadaniu), nie liczymy go.
 *
 * Persystencję wstrzykujemy parametrem `magazyn` (docelowo `../lib/storage`),
 * bo `storage.js` importuje `react-native` i nie da się go załadować w
 * node:test — a chcemy model przetestować jednostkowo.
 */

import { pozostaly_czas_do } from './terminKio.js';

/** Etapy pracy nad kontrolą. Enum jak w `statusPrzetargu.js` ({ wartosc, etykieta }). */
export const STATUSY_KONTROLI = [
  { wartosc: 'nowa', etykieta: 'Nowa' },
  { wartosc: 'wniosek_wyslany', etykieta: 'Wniosek wysłany' },
  { wartosc: 'dokumenty_otrzymane', etykieta: 'Dokumenty otrzymane' },
  { wartosc: 'analiza_gotowa', etykieta: 'Analiza gotowa' },
];

export const STATUS_KONTROLI_DOMYSLNY = 'nowa';

function normalizujStatus(wartosc) {
  return STATUSY_KONTROLI.some((s) => s.wartosc === wartosc) ? wartosc : STATUS_KONTROLI_DOMYSLNY;
}

/** Niepusty tekst albo null — daty trzymamy jako znaczniki ISO (string). */
function tekstAlboNull(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Identyfikator postępowania bywa liczbą (tender.id) lub stringiem — sprowadzamy do stringa. */
function idAlboNull(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return tekstAlboNull(v);
}

/**
 * Kategorie wgrywanych dokumentów (podzadanie 7/13). Dwie, w ustalonej kolejności:
 * oferta wybranego wykonawcy oraz protokół postępowania (z załącznikami). Rekord
 * `dokumenty` ma zawsze dokładnie te klucze — nieznane kategorie ignorujemy.
 */
export const KATEGORIE_DOKUMENTOW = ['ofertaZwyciezcy', 'protokol'];

/**
 * Normalizuje pojedynczą referencję pliku do `{ nazwa, uri, rozmiar, typMime }`.
 * Wejściem jest asset z pickera (`expo-document-picker`: `{ uri, name, size,
 * mimeType }`) — akceptujemy też odpowiedniki PL. Referencja bez `uri` jest
 * bezużyteczna → `null` (wołający ją odfiltruje).
 */
function normalizujPlik(plik) {
  if (!plik || typeof plik !== 'object') return null;
  const uri = tekstAlboNull(plik.uri);
  if (!uri) return null;
  const rozmiarSurowy = pierwsze(plik.rozmiar, plik.size);
  const rozmiar =
    typeof rozmiarSurowy === 'number' && Number.isFinite(rozmiarSurowy) && rozmiarSurowy >= 0
      ? rozmiarSurowy
      : null;
  return {
    nazwa: tekstAlboNull(pierwsze(plik.nazwa, plik.name)),
    uri,
    rozmiar,
    typMime: tekstAlboNull(pierwsze(plik.typMime, plik.mimeType, plik.type)),
  };
}

/** Lista referencji plików → tablica znormalizowanych wpisów (pomija błędne). */
function normalizujListePlikow(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.map(normalizujPlik).filter((p) => p !== null);
}

/** Surowe `dokumenty` → `{ ofertaZwyciezcy: [...], protokol: [...] }` (tylko znane kategorie). */
function normalizujDokumenty(dane) {
  const zrodlo = dane && typeof dane === 'object' ? dane : {};
  const wynik = {};
  for (const kat of KATEGORIE_DOKUMENTOW) {
    wynik[kat] = normalizujListePlikow(zrodlo[kat]);
  }
  return wynik;
}

export class PoprzetargowaKontrola {
  /**
   * @param {{
   *   postepowanieId?: string|number,
   *   daneZamawiajacego?: string|null,
   *   dataOtwarciaOfert?: string|null,
   *   dataOgloszeniaWyniku?: string|null,
   *   terminOdwolaniaKio?: string|null,
   *   status?: 'nowa'|'wniosek_wyslany'|'dokumenty_otrzymane'|'analiza_gotowa',
   *   dokumenty?: { ofertaZwyciezcy?: Array, protokol?: Array },
   * }} [dane]
   */
  constructor(dane = {}) {
    // Powiązanie z postępowaniem (klucz naturalny — jedna kontrola na postępowanie).
    this.postepowanieId = idAlboNull(dane.postepowanieId);
    this.daneZamawiajacego = tekstAlboNull(dane.daneZamawiajacego);
    this.dataOtwarciaOfert = tekstAlboNull(dane.dataOtwarciaOfert);
    this.dataOgloszeniaWyniku = tekstAlboNull(dane.dataOgloszeniaWyniku);
    this.terminOdwolaniaKio = tekstAlboNull(dane.terminOdwolaniaKio);
    this.status = normalizujStatus(dane.status);
    // Wgrane referencje plików (oferta zwycięzcy + protokół) — zawsze pełny kształt.
    this.dokumenty = normalizujDokumenty(dane.dokumenty);
  }

  /** Postać do serializacji (JSON w magazynie). */
  toJSON() {
    return {
      postepowanieId: this.postepowanieId,
      daneZamawiajacego: this.daneZamawiajacego,
      dataOtwarciaOfert: this.dataOtwarciaOfert,
      dataOgloszeniaWyniku: this.dataOgloszeniaWyniku,
      terminOdwolaniaKio: this.terminOdwolaniaKio,
      status: this.status,
      dokumenty: this.dokumenty,
    };
  }

  /** Odtworzenie z odczytanego JSON-a (normalizacja przez konstruktor). */
  static fromJSON(obj) {
    return new PoprzetargowaKontrola(obj ?? {});
  }
}

const kluczKontroli = (postepowanieId) => `kontrola:${postepowanieId}`;

/**
 * Zapis kontroli. `magazyn` = obiekt z `setItem(key, value)` (np. `../lib/storage`).
 * @returns {Promise<PoprzetargowaKontrola>} znormalizowany model
 */
export async function zapiszKontrole(magazyn, kontrola) {
  const model = kontrola instanceof PoprzetargowaKontrola
    ? kontrola
    : new PoprzetargowaKontrola(kontrola);
  if (!model.postepowanieId) {
    throw new Error('PoprzetargowaKontrola: brak postepowanieId — nie ma jak powiązać z postępowaniem.');
  }
  await magazyn.setItem(kluczKontroli(model.postepowanieId), JSON.stringify(model.toJSON()));
  return model;
}

/**
 * Odczyt kontroli po id postępowania. Brak wpisu lub uszkodzony JSON → null.
 * @returns {Promise<PoprzetargowaKontrola|null>}
 */
export async function wczytajKontrole(magazyn, postepowanieId) {
  const id = idAlboNull(postepowanieId);
  if (!id) return null;
  const surowe = await magazyn.getItem(kluczKontroli(id));
  if (!surowe) return null;
  try {
    return PoprzetargowaKontrola.fromJSON(JSON.parse(surowe));
  } catch {
    return null; // uszkodzony wpis traktujemy jak brak
  }
}

/**
 * Pierwsze pole z listy, które nie jest null/undefined (zachowuje 0/false).
 * Nie używamy `??` w łańcuchu, żeby czytelnie wypisać priorytety źródeł pól.
 */
function pierwsze(...wartosci) {
  for (const w of wartosci) if (w !== undefined && w !== null) return w;
  return null;
}

/**
 * Wykrycie przegranej (podzadanie 2/13) — wołane, gdy status postępowania zmienia
 * się na „przegrana". Zakłada poprzetargową kontrolę oferty zwycięzcy: tworzy
 * rekord {@link PoprzetargowaKontrola} ze statusem „nowa" i PRZEPISUJE dostępne
 * daty z postępowania. Reszta (wyliczenie terminu KIO, analiza przesłanek) —
 * w kolejnych podzadaniach.
 *
 * Przepisanie pól z tendera:
 *  - dataOtwarciaOfert ← termin składania ofert (`deadline`) — otwarcie ofert jest
 *    jawne i następuje zaraz po upływie terminu składania; to jedyna pewna data,
 *    jaką mamy w momencie oznaczenia przegranej.
 *  - daneZamawiajacego ← `organization`.
 *  - dataOgloszeniaWyniku ← przepisujemy, jeśli postępowanie ją niesie (zwykle null
 *    na tym etapie).
 *
 * IDEMPOTENTNA: jeśli kontrola już istnieje (np. użytkownik ponownie oznaczył
 * przegraną albo analiza już ruszyła), zwracamy istniejącą BEZ nadpisania — żeby
 * nie skasować postępów. Best-effort: brak id → `null` (hook nie może wywrócić UI).
 *
 * `magazyn` wstrzykiwany jak w {@link zapiszKontrole} (ekrany podają `../lib/storage`).
 * @param {object} magazyn magazyn z `getItem`/`setItem`
 * @param {object} postepowanie tender/postępowanie (lub obiekt z zagnieżdżonym `tender`)
 * @returns {Promise<PoprzetargowaKontrola|null>}
 */
export async function utworzKontrolePoPrzegranej(magazyn, postepowanie) {
  const post = postepowanie ?? {};
  const tender = post.tender ?? {};

  const postepowanieId = idAlboNull(pierwsze(post.id, post.postepowanieId, tender.id));
  if (!postepowanieId) return null; // bez klucza nie ma jak powiązać kontroli z postępowaniem

  // Nie nadpisujemy istniejącej kontroli — mogła już ruszyć analiza / zmienić status.
  const istniejaca = await wczytajKontrole(magazyn, postepowanieId);
  if (istniejaca) return istniejaca;

  const kontrola = new PoprzetargowaKontrola({
    postepowanieId,
    daneZamawiajacego: pierwsze(post.daneZamawiajacego, post.organization, tender.organization),
    dataOtwarciaOfert: pierwsze(post.dataOtwarciaOfert, post.deadline, tender.deadline),
    dataOgloszeniaWyniku: pierwsze(post.dataOgloszeniaWyniku, post.result_date, tender.dataOgloszeniaWyniku),
    status: STATUS_KONTROLI_DOMYSLNY, // „nowa"
  });
  return zapiszKontrole(magazyn, kontrola);
}

/**
 * Dolicza do kontroli POLE POMOCNICZE `pozostalyCzas` — odliczanie do terminu
 * odwołania (podzadanie 4/13), policzone z `terminOdwolaniaKio` przez
 * {@link ../lib/terminKio pozostaly_czas_do}.
 *
 * To pole jest POCHODNE i ULOTNE: countdown starzeje się co godzinę, więc świadomie
 * NIE trafia do `toJSON()` (nie utrwalamy go — liczymy na żądanie przy renderze).
 * `terminOdwolaniaKio === null` (jeszcze niewyliczony) → `pozostalyCzas = null`.
 *
 * Mutuje i zwraca przekazany obiekt (best-effort: `null`/`undefined` przepuszczamy).
 * @param {PoprzetargowaKontrola|null} kontrola
 * @param {number} [teraz] czas odniesienia w ms — wstrzykiwany w testach
 * @returns {PoprzetargowaKontrola|null}
 */
export function dolaczPozostalyCzas(kontrola, teraz) {
  if (!kontrola) return kontrola;
  kontrola.pozostalyCzas = pozostaly_czas_do(kontrola.terminOdwolaniaKio, teraz);
  return kontrola;
}

/** Pozycja statusu na osi postępu ({@link STATUSY_KONTROLI}). Nieznany → -1. */
function indeksStatusu(wartosc) {
  return STATUSY_KONTROLI.findIndex((s) => s.wartosc === wartosc);
}

/**
 * Oznacza kontrolę jako „wniosek_wyslany" (podzadanie 6/13) — wołane z przycisku
 * „Wygeneruj wniosek" po wygenerowaniu i pobraniu pisma o protokół.
 *
 * Load-or-create: hook {@link utworzKontrolePoPrzegranej} jest best-effort i mógł
 * nie zdążyć założyć rekordu — wtedy zakładamy minimalną kontrolę pod tym
 * postępowaniem. MONOTONICZNIE: nie cofamy dalszego etapu (dokumenty_otrzymane /
 * analiza_gotowa), żeby ponowne kliknięcie nie skasowało postępu. Best-effort:
 * brak id → `null` (przycisk nie może wywrócić UI).
 *
 * @param {object} magazyn magazyn z `getItem`/`setItem`
 * @param {string|number} postepowanieId klucz naturalny (tender.id)
 * @returns {Promise<PoprzetargowaKontrola|null>}
 */
export async function oznaczWniosekWyslany(magazyn, postepowanieId) {
  const id = idAlboNull(postepowanieId);
  if (!id) return null;

  const kontrola =
    (await wczytajKontrole(magazyn, id)) ?? new PoprzetargowaKontrola({ postepowanieId: id });

  // Tylko naprzód: gdy kontrola jest już dalej niż „wniosek_wyslany", zostaje.
  const cel = 'wniosek_wyslany';
  if (indeksStatusu(kontrola.status) < indeksStatusu(cel)) {
    kontrola.status = cel;
  }
  return zapiszKontrole(magazyn, kontrola);
}

/**
 * Zapisuje wgrane dokumenty (ofertę zwycięzcy i/lub protokół) do rekordu kontroli
 * i przesuwa status na „dokumenty_otrzymane" (podzadanie 7/13). Wołane z ekranu po
 * wybraniu plików w pickerze.
 *
 * TYLKO upload + zapis — bez parsowania treści (analiza przesłanek odrzucenia to
 * kolejne podzadania). „Zapis plików" w apce mobilnej = zapis REFERENCJI (uri +
 * metadane z pickera), nie bajtów: magazyn trzyma tylko mały JSON.
 *
 * Load-or-create + MONOTONICZNIE jak {@link oznaczWniosekWyslany}: hook po
 * przegranej jest best-effort, więc rekordu może nie być; nie cofamy dalszego
 * etapu (np. `analiza_gotowa`). Kategorie łączymy PER-KATEGORIA — podanie niepustej
 * listy dla kategorii NADPISUJE ją (pozwala poprawić błędny plik), a kategoria
 * niepodana zostaje. To celowe: oferta jest jawna od otwarcia, a załączniki
 * dochodzą do 3 dni później, więc pliki wpływają w dwóch turach i drugie wgranie
 * nie może skasować pierwszego.
 *
 * Status przechodzi na „dokumenty_otrzymane" tylko, gdy po zapisie jest co najmniej
 * jeden plik — puste wywołanie nie „udaje" otrzymania dokumentów. Best-effort:
 * brak id → `null` (ekran nie może wywrócić UI).
 *
 * @param {object} magazyn magazyn z `getItem`/`setItem`
 * @param {string|number} postepowanieId klucz naturalny (tender.id)
 * @param {{ ofertaZwyciezcy?: Array, protokol?: Array }} [dokumenty] referencje
 *   plików z pickera (`{ uri, name, size, mimeType }` lub odpowiedniki PL). Wpisy
 *   bez `uri` pomijamy; nieznane kategorie ignorujemy.
 * @returns {Promise<PoprzetargowaKontrola|null>}
 */
export async function zapiszDokumenty(magazyn, postepowanieId, dokumenty) {
  const id = idAlboNull(postepowanieId);
  if (!id) return null;

  const kontrola =
    (await wczytajKontrole(magazyn, id)) ?? new PoprzetargowaKontrola({ postepowanieId: id });

  // Per-kategoria: niepusta lista nadpisuje, brak/pusto → zostaje to, co było.
  const nowe = normalizujDokumenty(dokumenty);
  for (const kat of KATEGORIE_DOKUMENTOW) {
    if (nowe[kat].length > 0) kontrola.dokumenty[kat] = nowe[kat];
  }

  // „dokumenty_otrzymane" tylko gdy faktycznie mamy plik — i tylko naprzód.
  const maPliki = KATEGORIE_DOKUMENTOW.some((kat) => kontrola.dokumenty[kat].length > 0);
  const cel = 'dokumenty_otrzymane';
  if (maPliki && indeksStatusu(kontrola.status) < indeksStatusu(cel)) {
    kontrola.status = cel;
  }

  return zapiszKontrole(magazyn, kontrola);
}
