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

export class PoprzetargowaKontrola {
  /**
   * @param {{
   *   postepowanieId?: string|number,
   *   daneZamawiajacego?: string|null,
   *   dataOtwarciaOfert?: string|null,
   *   dataOgloszeniaWyniku?: string|null,
   *   terminOdwolaniaKio?: string|null,
   *   status?: 'nowa'|'wniosek_wyslany'|'dokumenty_otrzymane'|'analiza_gotowa',
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
