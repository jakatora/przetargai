import { metryczkaZrodla } from './zrodlaDanych.js';

/**
 * Ogłoszenie dla ekranu „Ogłoszenie" (KatalogDetail) otwieranego SPOZA katalogu
 * — czysta logika, zero React Native (audyt 2026-09-25, P1).
 *
 * Katalog podaje pełne ogłoszenie (`publicTender`: `zrodlo` jako metryczka, `url`,
 * `deadline`, `organization`…). Kalendarz, centrum alertów i radar planów
 * przekazywały okrojone `{ id, title }` — kalendarz na dodatek pod złym kluczem
 * `source`. Ekran czyta `tender.zrodlo.kod`, więc ogłoszenie z TED/Bazy
 * Konkurencyjności pokazywało się jako „BZP", znikał przycisk „Otwórz oryginał",
 * a termin był „nieznany", choć ekran-źródło go znał.
 *
 * Backend nie ma trasy pojedynczego ogłoszenia z katalogu (`/tenders` to tylko
 * lista), więc nie dociągamy — każdy ekran-źródło przekazuje wszystko, co ma,
 * a rejestru, którego nikt nie podał, NIE zgadujemy (`zrodloNieznane`).
 */

/** Kod (`'ted'`) albo gotowa metryczka → metryczka; brak → null. */
function zrodloZ(wartosc) {
  if (wartosc && typeof wartosc === 'object') return wartosc.kod ? wartosc : null;
  return metryczkaZrodla(wartosc);
}

/**
 * Normalizacja na wejściu ekranu. Pełne ogłoszenie przechodzi bez zmian;
 * `zrodlo` jako napis albo stary klucz `source` zamieniamy na metryczkę; brak
 * jakiejkolwiek informacji o rejestrze = `zrodloNieznane: true` (nie „BZP").
 */
export function normalizujOgloszenie(tender) {
  if (!tender || typeof tender !== 'object') return null;
  const zrodlo = zrodloZ(tender.zrodlo) ?? zrodloZ(tender.source);
  return { ...tender, zrodlo, zrodloNieznane: !zrodlo };
}

/**
 * Pozycja kalendarza terminów (lib/kalendarzPrzetargu `ulozKalendarz`) → ogłoszenie.
 *
 * Pozycja to JEDEN z trzech terminów (pytania / oferty / związanie), a ekran
 * ogłoszenia pokazuje termin SKŁADANIA — bierzemy go z pozycji „oferty" tego
 * samego przetargu, nie z klikniętej (termin pytań udawałby termin składania).
 * @param {object} pozycja pozycja z `ulozKalendarz`
 * @param {object[]} [przetargi] `dane.przetargi` z `GET /kalendarz`
 */
export function ogloszenieZKalendarza(pozycja, przetargi = []) {
  const id = pozycja?.tenderId ?? null;
  const przetarg = (Array.isArray(przetargi) ? przetargi : []).find((k) => k?.tenderId === id) ?? null;
  const oferty = (przetarg?.pozycje ?? []).find((p) => p?.kod === 'oferty' && p?.znany !== false && p?.at);
  const deadline = oferty?.at ?? (pozycja?.kod === 'oferty' && pozycja?.at ? pozycja.at : null);
  return {
    id,
    title: pozycja?.tytulPrzetargu ?? pozycja?.tytul ?? przetarg?.tytul ?? null,
    zrodlo: zrodloZ(pozycja?.zrodlo ?? przetarg?.zrodlo ?? null),
    deadline,
  };
}

/** Pozycja alertu (lib/centrumAlertow `opisAlertu().pozycje[i]`) → ogłoszenie. */
export function ogloszenieZAlertu(pozycja) {
  return {
    id: pozycja?.tenderId ?? null,
    title: pozycja?.tytul ?? null,
    organization: pozycja?.organizacja ?? null,
    deadline: pozycja?.deadline ?? null,
    zrodlo: zrodloZ(pozycja?.zrodlo ?? null),
  };
}

/**
 * Ogłoszenie dopasowane do planu (`GET /radar-planow/:id` → `ogloszenie`) →
 * ogłoszenie. Backend podaje link, termin i datę publikacji, ale NIE rejestr —
 * zostaje nieznany. Zamawiający jest ten sam co w planie (dopasowanie idzie po NIP).
 * @param {object} ogloszenie `ogloszenie` z odpowiedzi radaru
 * @param {object} [pozycjaPlanu] `pozycja` z tej samej odpowiedzi
 */
export function ogloszenieZRadaru(ogloszenie, pozycjaPlanu) {
  return {
    id: ogloszenie?.tender_id ?? null,
    title: ogloszenie?.tytul ?? null,
    url: ogloszenie?.url ?? null,
    deadline: ogloszenie?.deadline ?? null,
    published_at: ogloszenie?.opublikowano ?? null,
    organization: pozycjaPlanu?.zamawiajacy ?? null,
    zrodlo: zrodloZ(ogloszenie?.zrodlo ?? null),
  };
}
