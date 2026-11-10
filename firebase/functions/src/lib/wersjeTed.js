/*
 * WERSJE OGŁOSZEŃ TED (2026-11-01). TED publikuje zmianę ogłoszenia (najczęściej przesunięty termin) jako NOWE
 * ogłoszenie konkursowe z tym samym `procedure-identifier` i polem `change-notice-version-identifier` — 30.10 było
 * to 139 z 250 polskich ogłoszeń konkursowych. Pobieranie zapisuje każdą wersję jako osobny dokument `ted:<numer>`:
 * 1.11 na prod 9421 dokumentów TED na 6795 postępowań, 2626 starych wersji, w 1537 postępowaniach różne terminy,
 * w 539 stara wersja wyglądała na zamkniętą, a aktualna przyjmowała oferty. Użytkownik widział przetarg dwa razy,
 * raz ze złym terminem. Aktualna wersja = najpóźniej opublikowana, przy tej samej dacie (TED podaje sam dzień)
 * — wyższy numer publikacji. CZYSTA logika; job: `jobs/wersjeTed.js`.
 */

/** „ted:752719-2026” → liczba rosnąca z kolejnością publikacji (rok, potem numer w roku). */
export function porzadekPublikacji(id) {
  const m = /(\d+)-(\d{4})$/.exec(String(id ?? ''));
  return m ? Number(m[2]) * 1e8 + Number(m[1]) : 0;
}

/** Najnowsza wersja z dokumentów jednego postępowania. */
export function aktualnaWersja(dokumenty) {
  let wynik = null;
  for (const d of dokumenty ?? []) {
    if (!d?.id) continue;
    if (!wynik) { wynik = d; continue; }
    const a = String(d.published_at ?? '').slice(0, 10);
    const b = String(wynik.published_at ?? '').slice(0, 10);
    if (a > b || (a === b && porzadekPublikacji(d.id) > porzadekPublikacji(wynik.id))) wynik = d;
  }
  return wynik;
}

/**
 * @param {{id: string, published_at?: string, deadline?: string, zastapiony_przez?: string|null}[]} dokumenty
 *   dokumenty TED jednego postępowania
 * @returns {{aktualna: object|null, starsze: object[]}} starsze = do oznaczenia (jeszcze nie wskazują aktualnej)
 */
export function wersjeDoZastapienia(dokumenty) {
  const aktualna = aktualnaWersja(dokumenty);
  if (!aktualna) return { aktualna: null, starsze: [] };
  const starsze = (dokumenty ?? []).filter((d) => d?.id && d.id !== aktualna.id && d.zastapiony_przez !== aktualna.id);
  return { aktualna, starsze };
}

/*
 * ALERT O NOWEJ WERSJI OGŁOSZENIA TED (2026-11-10). Sprostowanie w TED to nowa wersja ogłoszenia — termin, warunki
 * albo dokumenty. Dotąd stara wersja tylko ustępowała, a konto, które przetarg zapisało, nie dostawało nic; dokumenty
 * TED leżą zwykle poza e-Zamówieniami (1.11: pliki u 7 z 80), więc monitoring dokumentów tego nie widział.
 * Klucz = aktualna wersja: kilka zapisanych starych wersji tego samego postępowania daje jeden alert.
 */
const czystyKlucz = (s) => String(s).replace(/[/\s:.]/g, '_');
const KONIEC_DOBY = /T2[12]:59:59\.999Z$/;

function terminTed(iso) {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return null;
  const opcje = { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' };
  // TED zna często samą datę (koniec doby warszawskiej) — wtedy bez godziny, żeby nie udawać „23:59”.
  return KONIEC_DOBY.test(String(iso))
    ? new Date(t).toLocaleDateString('pl-PL', opcje)
    : new Date(t).toLocaleString('pl-PL', { ...opcje, hour: '2-digit', minute: '2-digit' });
}

/**
 * @param {{tender: {id: string, title?: string, organization?: string, deadline?: string}, staryTermin?: string|null}} wejscie
 *   `tender` = aktualna wersja; `staryTermin` = termin wersji, którą konto zapisało
 */
export function alertNowejWersjiTed({ tender, staryTermin = null }) {
  if (!tender?.id) return null;
  const tytul = String(tender.title ?? 'przetarg').slice(0, 90);
  const nowy = terminTed(tender.deadline);
  const stary = terminTed(staryTermin);
  const zmianaTerminu = nowy && stary && nowy !== stary;
  const termin = zmianaTerminu
    ? { pl: ` Nowy termin ofert: ${nowy} (było ${stary}) — przypomnienie ustawiliśmy na nowy termin.`, en: ` New bid deadline: ${nowy} (was ${stary}) — your reminder follows the new date.` }
    : nowy ? { pl: ` Termin ofert bez zmian: ${nowy}.`, en: ` Bid deadline unchanged: ${nowy}.` } : { pl: '', en: '' };
  return {
    klucz: `ted_wersja_${czystyKlucz(tender.id)}`,
    typ: 'zmiany',
    tender_id: tender.id,
    ton: 'ostrzezenie',
    tytul: { pl: `Zmiana ogłoszenia w zapisanym przetargu: ${tytul}`, en: `Notice changed in a saved tender: ${tytul}` },
    tresc: {
      pl: `${tender.organization ?? 'Zamawiający'} opublikował w TED sprostowanie ogłoszenia (nową wersję).${termin.pl} Sprawdź zmiany i dokumenty przed złożeniem oferty.`,
      en: `${tender.organization ?? 'The buyer'} published a corrigendum (a new version of the notice) in TED.${termin.en} Check the changes and documents before you bid.`,
    },
    pozycje: [{ tender_id: tender.id, tytul: tender.title ?? null, organizacja: tender.organization ?? null, deadline: tender.deadline ?? null, zrodlo: 'ted' }],
  };
}
