import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { tenders } from '../db/repos.js';
import { pobierzSzczegol } from './platformaZakupowa.js';

/*
 * DOKUMENTY Z KOPII NA PLATFORMIE (2026-11-03). 160 z 283 wybranych ogłoszeń BZP z 48 h nie miało dokumentów na
 * e-Zamówieniach (postępowanie prowadzone na innej platformie — portal odpowiada 400 „nieznane”), a 77 z nich ma
 * scaloną kopię z platformazakupowa.pl (lib/dedupZrodel.js, `zrodla_alternatywne`). Jej szczegół ma załączniki
 * z linkami — zapisujemy je w `ez_dokumenty` w tym samym kształcie, więc auto-analiza SWZ, „Zapytaj SWZ”, lista
 * w apce i „Wypełnij moimi danymi” działają bez zmian. Jedno żądanie do platformy na ogłoszenie (cache w `ez_dokumenty`).
 */
export const ZRODLO_PZ = 'platformazakupowa';

/** Id ogłoszenia platformazakupowa.pl z rejestru pobocznego (`pz:1401871` albo `…/transakcja/1401871`) albo null. */
export function idPzZAlternatywnych(tender) {
  for (const z of tender?.zrodla_alternatywne ?? []) {
    if (z?.source !== ZRODLO_PZ) continue;
    const zId = String(z.externalId ?? '').match(/^pz:(\d+)$/)?.[1];
    const zUrl = String(z.url ?? '').match(/\/transakcja\/(\d+)/)?.[1];
    if (zId || zUrl) return zId ?? zUrl;
  }
  return null;
}

/** Załączniki szczegółu platformy w kształcie dokumentów e-Zamówień (`jobs/autoAnalizaSwz.js dokumentyPrzetargu`). */
export function zalacznikiPzJakoDokumenty(szczegol) {
  return (szczegol?.zalaczniki ?? []).filter((z) => z?.url).map((z) => {
    const nazwa = String(z.nazwa ?? '');
    const rozszerzenie = String(z.rozszerzenie ?? (nazwa.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '')).toLowerCase() || null;
    return { id: z.url, nazwa, plik: nazwa, rozszerzenie, url: z.url, rozmiar_kb: typeof z.rozmiar_kb === 'number' ? z.rozmiar_kb : null };
  });
}

/** Czy warto sięgnąć po kopię: BZP/TED bez dokumentów z e-Zamówień (pusta lista albo brak identyfikatora) i z kopią PZ. */
export function czyDokumentyZKopii(tender) {
  if (!['bzp', 'ted'].includes(tender?.source ?? 'bzp')) return false;
  if (Array.isArray(tender?.ez_dokumenty) && tender.ez_dokumenty.length) return false;
  return Boolean(idPzZAlternatywnych(tender));
}

/**
 * Pobiera załączniki kopii z platformy i zapisuje je jako `ez_dokumenty` (ze znacznikiem źródła). Zwraca listę
 * (pustą, gdy kopia nie ma plików) albo null, gdy nie dotyczy. Błąd sieci rzuca — wołający decyduje, co z nim zrobić.
 */
export async function dokumentyZKopiiPlatformy(tender, { szczegolPz = pobierzSzczegol, teraz = nowIso() } = {}) {
  if (!czyDokumentyZKopii(tender)) return null;
  const id = idPzZAlternatywnych(tender);
  const dokumenty = zalacznikiPzJakoDokumenty(await szczegolPz(id));
  await tenders.zapiszDokumentyEz(tender.id, dokumenty, teraz, { zrodlo: ZRODLO_PZ });
  tender.ez_dokumenty = dokumenty;
  tender.ez_dokumenty_zrodlo = ZRODLO_PZ;
  logger.info({ id: tender.id, pz: id, dokumenty: dokumenty.length }, 'Dokumenty z kopii na platformazakupowa.pl');
  return dokumenty;
}
