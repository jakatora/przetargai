import { normalize } from './textNorm.js';

/**
 * Jeden słownik województw dla WSZYSTKICH rejestrów.
 *
 * Każde źródło opisuje region inaczej (zmierzone na fixture'ach kontraktowych):
 *   • BZP — kod TERYT „PL12" (`organizationProvince`),
 *   • Baza Konkurencyjności — nazwa „małopolskie" (`voivodeship`),
 *   • TED — najczęściej nic.
 *
 * Normalizator rozpoznający wyłącznie cyfry (taki był w aplikacji) zwraca dla BK
 * `null`, więc filtr regionu CHOWAŁ całe źródło bez śladu w logach. Filtr, który
 * po cichu usuwa rejestr, jest gorszy niż brak filtra — stąd wspólny słownik
 * i rozpoznawanie obu postaci.
 */
export const WOJEWODZTWA = {
  '02': 'Dolnośląskie',
  '04': 'Kujawsko-pomorskie',
  '06': 'Lubelskie',
  '08': 'Lubuskie',
  '10': 'Łódzkie',
  '12': 'Małopolskie',
  '14': 'Mazowieckie',
  '16': 'Opolskie',
  '18': 'Podkarpackie',
  '20': 'Podlaskie',
  '22': 'Pomorskie',
  '24': 'Śląskie',
  '26': 'Świętokrzyskie',
  '28': 'Warmińsko-mazurskie',
  '30': 'Wielkopolskie',
  '32': 'Zachodniopomorskie',
};

/** Nazwa bez diakrytyków i separatorów → kod. Budowane raz, z jedynego słownika. */
const PO_NAZWIE = new Map(
  Object.entries(WOJEWODZTWA).map(([kod, nazwa]) => [normalize(nazwa).replace(/[^a-z]/g, ''), kod]),
);

/**
 * Sprowadza dowolny zapis regionu do dwucyfrowego kodu TERYT.
 * @param {string|null|undefined} wartosc „PL12" | „12" | „2" | „małopolskie" | „MAZOWIECKIE"
 * @returns {string|null} kod TERYT albo null, gdy nie da się rozpoznać
 */
export function kodWojewodztwa(wartosc) {
  if (wartosc === null || wartosc === undefined) return null;
  const surowe = String(wartosc).trim();
  if (!surowe) return null;

  const cyfry = surowe.replace(/\D/g, '');
  if (cyfry) {
    const kod = cyfry.slice(-2).padStart(2, '0');
    return WOJEWODZTWA[kod] ? kod : null;
  }

  return PO_NAZWIE.get(normalize(surowe).replace(/[^a-z]/g, '')) ?? null;
}

/** Polska nazwa województwa z dowolnego zapisu (albo null). */
export function nazwaWojewodztwa(wartosc) {
  const kod = kodWojewodztwa(wartosc);
  return kod ? WOJEWODZTWA[kod] : null;
}
