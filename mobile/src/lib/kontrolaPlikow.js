/* Czyste pomocnicze automatycznej kontroli plików oferty (components/KontrolaPlikowOferty.js) — testowalne w Node. */

/** Limity zgodne z backendem (Functions `lib/kontrolaPlikowOferty.js`). */
export const MAKS_PLIKOW = 12;
export const MAKS_BAJTOW_PLIKU = 10 * 1024 * 1024;
export const MAKS_BAJTOW_RAZEM = 14 * 1024 * 1024;

/**
 * Wybór z pickera → pliki do wysłania i odrzucone z powodem (za duże, ponad limit liczby lub sumy).
 * @param {{name?: string, size?: number, uri: string}[]} assets
 */
export function sprawdzWyborPlikow(assets) {
  const pliki = [];
  const odrzucone = [];
  let razem = 0;
  for (const a of Array.isArray(assets) ? assets : []) {
    const nazwa = String(a?.name ?? 'plik');
    const rozmiar = Number(a?.size) || 0;
    if (pliki.length >= MAKS_PLIKOW) { odrzucone.push({ nazwa, powod: `najwyżej ${MAKS_PLIKOW} plików naraz` }); continue; }
    if (rozmiar > MAKS_BAJTOW_PLIKU) { odrzucone.push({ nazwa, powod: 'plik ma ponad 10 MB' }); continue; }
    if (razem + rozmiar > MAKS_BAJTOW_RAZEM) { odrzucone.push({ nazwa, powod: 'razem ponad 14 MB — sprawdź w dwóch częściach' }); continue; }
    razem += rozmiar;
    pliki.push(a);
  }
  return { pliki, odrzucone };
}

/** Nagłówek raportu: błędy → czerwony, uwagi → żółty, czysto → zielony. */
export function podsumowanieKontroli(raport) {
  const bledy = Number(raport?.podsumowanie?.bledy) || 0;
  const uwagi = Number(raport?.podsumowanie?.uwagi) || 0;
  if (bledy) return { ton: 'blad', pl: `${bledy === 1 ? '1 błąd' : `${bledy} błędy`} do poprawienia przed wysłaniem`, en: `${bledy} error(s) to fix before sending` };
  if (uwagi) return { ton: 'uwaga', pl: `Bez błędów, ${uwagi === 1 ? '1 rzecz' : `${uwagi} rzeczy`} do sprawdzenia`, en: `No errors, ${uwagi} thing(s) to check` };
  return { ton: 'ok', pl: 'Nie znaleźliśmy problemów w tym, co sprawdzamy', en: 'No problems found in what we check' };
}

/** Opis podpisu pliku w liście. */
export function opisPodpisu(podpis, t) {
  if (podpis === 'wewnetrzny') return t('podpisany', 'signed');
  if (podpis === 'zewnetrzny') return t('podpis w osobnym pliku', 'detached signature');
  if (podpis === 'plik_podpisu') return t('plik podpisu', 'signature file');
  if (podpis === 'brak') return t('BEZ PODPISU', 'NOT SIGNED');
  return '';
}
