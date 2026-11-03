import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { idBzpZTytulu, znajdzBlizniakaBzp, toSamoPostepowanie, bezGodziny } from '../lib/dedupZrodel.js';
import { dobaWarszawska } from '../lib/czasPolski.js';
import { tenders, evaluations, matches } from '../db/repos.js';

/*
 * BLIŹNIAKI BZP NA PLATFORMACH — scalenie wstecz (2026-11-03, POST /admin/blizniaki-platformy). Od dziś okna
 * platformazakupowa.pl i e-ProPublico nie tworzą kopii przetargu, który jest już w BZP, a cykl BZP zastępuje kopie
 * wcześniejsze (lib/dedupZrodel.js `toSamoPostepowanie`). To zadanie robi to samo dla otwartych kopii sprzed
 * zmiany: kopia schodzi z puli, wpis BZP dostaje jej link, a kopie w feedach — `tender_zastapiony_przez` (lista
 * chowa kopię, gdy klient ma też wpis BZP). `sucho` = tylko liczby, bez zapisu.
 */
export const ZRODLA_KOPII = ['platformazakupowa', 'epropublico'];

/**
 * Kandydaci z rejestrów wiodących dla kopii z platform: BZP (numer z tytułu + termin co do minuty) i TED (termin
 * z samą datą — doba kopii; po doprecyzowaniu godziny — termin kopii). 2026-11-03: 1034 kopie przetargów z TED.
 */
export async function kandydaciWiodacy(kopie) {
  const lista = (kopie ?? []).filter(Boolean);
  const terminy = lista.map((k) => k.deadline);
  const [bzp, ted] = await Promise.all([
    tenders.doPorownaniaBlizniakow('bzp', { ids: lista.map((k) => idBzpZTytulu(k.title)).filter(Boolean), terminy }),
    tenders.doPorownaniaBlizniakow('ted', { terminy, dobyTerminow: terminy }),
  ]);
  return { bzp, ted };
}

/** Wpis wiodący dla kopii: najpierw BZP, potem TED (kolejność `PRIORYTET_ZRODEL`). */
export const wiodacyKopii = (kopia, kandydaci) =>
  znajdzBlizniakaBzp(kopia, kandydaci.bzp) ?? znajdzBlizniakaBzp(kopia, kandydaci.ted);

/**
 * TED zna samą datę (koniec doby), platforma — godzinę składania ofert tego samego dnia. Wpis wiodący dostaje tę
 * godzinę (wcześniejszą niż „do końca dnia” — bezpieczny kierunek), także w kopiach feedów i Zapisanych.
 */
export async function doprecyzujTerminWiodacego(wiodacy, kopia) {
  if (!bezGodziny(wiodacy?.deadline) || !kopia?.deadline || bezGodziny(kopia.deadline)) return false;
  if (dobaWarszawska(wiodacy.deadline) !== dobaWarszawska(kopia.deadline)) return false;
  await tenders.doprecyzujTermin(wiodacy.id, kopia.deadline);
  wiodacy.deadline = kopia.deadline;
  return true;
}

/** Pola wpisu BZP potrzebne przeniesionym dopasowaniom (`polaTenderuDopasowania`). */
const POLA_WIODACEGO = ['title', 'organization', 'budget', 'currency', 'deadline', 'url', 'cpv_main', 'source', 'wojewodztwo',
  'wadium_wymagane', 'wadium_kwota', 'wadium_wiele_czesci', 'kryterium_oceny', 'kryteria', 'kryteria_rozne_czesci', 'liczba_czesci'];

/**
 * Klient, który miał na liście TYLKO kopię z platformy, dostaje wpis BZP (jak nowa wersja TED, `przeniesNaWersje`):
 * bez ponownej oceny AI i bez powiadomienia, z polami z BZP (kryteria, warunki, dokumenty do auto-SWZ) — kopia
 * przestaje się aktualizować, gdy ustąpi. Kopia znika z listy, bo konto ma już wpis wiodący. Idempotentne.
 * `pary` = [{ kopiaId, wiodacyId }].
 */
export async function przeniesKopieNaBzp(pary) {
  if (!pary?.length) return { oceny: 0, dopasowania: 0, odswiezone: 0 };
  const wiodace = new Map((await tenders.polaWielu(pary.map((p) => p.wiodacyId), POLA_WIODACEGO)).map((t) => [t.id, t]));
  const w = await evaluations.przeniesNaWersje(pary.filter((p) => wiodace.has(p.wiodacyId)).map((p) => ({
    staraId: p.kopiaId, aktualna: { id: p.wiodacyId, deadline: wiodace.get(p.wiodacyId).deadline, url: wiodace.get(p.wiodacyId).url },
  })));
  return { ...w, odswiezone: w.dopasowania ? await matches.odswiezPrzeniesione(wiodace) : 0 };
}

export async function scalBlizniakiPlatformy({ teraz = nowIso(), sucho = false } = {}) {
  const kopie = [];
  const juzZastapione = [];
  for (const zrodlo of ZRODLA_KOPII) {
    for (const k of await tenders.otwarteZeZrodla(zrodlo, teraz)) {
      if (!k.zastapiony_przez) kopie.push({ ...k, source: zrodlo });
      else juzZastapione.push({ kopiaId: k.id, wiodacyId: k.zastapiony_przez });
    }
  }
  const kandydaci = await kandydaciWiodacy(kopie);
  const pary = [];
  for (const kopia of kopie) {
    const wiodacy = wiodacyKopii(kopia, kandydaci);
    if (wiodacy) pary.push({ kopia, wiodacy });
  }
  const zTed = pary.filter((p) => p.wiodacy.source === 'ted').length;
  const wynik = { kopie_otwarte: kopie.length, kandydaci_bzp: kandydaci.bzp.length, kandydaci_ted: kandydaci.ted.length,
    blizniaki: pary.length, z_ted: zTed, terminy_doprecyzowane: 0, kopie_w_feedach: 0, juz_zastapione: juzZastapione.length, przeniesione: null, sucho };
  if (sucho) return { ...wynik, przyklady: pary.slice(0, 5).map((p) => `${p.kopia.title} ⇒ ${p.wiodacy.title}`) };
  if (pary.length) {
    await tenders.scalBlizniakiWsadowo(pary, teraz);
    // Po 8 naraz — każdy termin to też kopie w feedach i Zapisanych (uzgodnijKopiePrzetargu).
    for (let i = 0; i < pary.length; i += 8) {
      const w = await Promise.all(pary.slice(i, i + 8).map((p) => doprecyzujTerminWiodacego(p.wiodacy, p.kopia).catch(() => false)));
      wynik.terminy_doprecyzowane += w.filter(Boolean).length;
    }
    wynik.kopie_w_feedach = await tenders.oznaczKopieWFeedach(new Map(pary.map((p) => [p.kopia.id, p.wiodacy.id])));
  }
  // Także kopie zastąpione wcześniej (scalenie 3.11 przed przenoszeniem, cykl, okno BZP) — przeniesienie jest idempotentne.
  wynik.przeniesione = await przeniesKopieNaBzp([...juzZastapione, ...pary.map((p) => ({ kopiaId: p.kopia.id, wiodacyId: p.wiodacy.id }))]);
  logger.info(wynik, 'Bliźniaki BZP na platformie scalone');
  return wynik;
}

/**
 * Nowe wpisy BZP z okna co 3 h (jobs/oknoBzp.js) zastępują wcześniejsze kopie z platform — jak cykl dobowy, ale po
 * zapisie. `wpisy` = [{ id, title, organization, deadline }]. Z każdego źródła tylko jedna pasująca kopia.
 * @returns {Promise<number>} ile kopii zastąpiono
 */
export async function zastapKopieDlaBzp(wpisy) {
  const zTerminem = (wpisy ?? []).filter((w) => w?.id && w.deadline);
  if (!zTerminem.length) return 0;
  const pary = [];
  for (const zrodlo of ZRODLA_KOPII) {
    const kandydaci = (await tenders.doPorownaniaBlizniakow(zrodlo, { terminy: zTerminem.map((w) => w.deadline) }))
      .filter((k) => !k.zastapiony_przez);
    for (const w of zTerminem) {
      const pasujace = kandydaci.filter((k) => !k.zastapiony_przez && toSamoPostepowanie(k, w));
      if (pasujace.length !== 1) continue;
      const [kopia] = pasujace;
      await tenders.dodajZrodloAlternatywne(w.id, { source: zrodlo, externalId: kopia.bzp_external_id ?? null, url: kopia.url ?? null });
      await tenders.oznaczZastapiony(kopia.id, w.id);
      kopia.zastapiony_przez = w.id;
      pary.push({ kopiaId: kopia.id, wiodacyId: w.id });
    }
  }
  await przeniesKopieNaBzp(pary);
  return pary.length;
}
