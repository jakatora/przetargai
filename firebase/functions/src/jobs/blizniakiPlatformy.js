import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { idBzpZTytulu, znajdzBlizniakaBzp, toSamoPostepowanie } from '../lib/dedupZrodel.js';
import { tenders } from '../db/repos.js';

/*
 * BLIŹNIAKI BZP NA PLATFORMACH — scalenie wstecz (2026-11-03, POST /admin/blizniaki-platformy). Od dziś okna
 * platformazakupowa.pl i e-ProPublico nie tworzą kopii przetargu, który jest już w BZP, a cykl BZP zastępuje kopie
 * wcześniejsze (lib/dedupZrodel.js `toSamoPostepowanie`). To zadanie robi to samo dla otwartych kopii sprzed
 * zmiany: kopia schodzi z puli, wpis BZP dostaje jej link, a kopie w feedach — `tender_zastapiony_przez` (lista
 * chowa kopię, gdy klient ma też wpis BZP). `sucho` = tylko liczby, bez zapisu.
 */
export const ZRODLA_KOPII = ['platformazakupowa', 'epropublico'];

export async function scalBlizniakiPlatformy({ teraz = nowIso(), sucho = false } = {}) {
  const kopie = [];
  for (const zrodlo of ZRODLA_KOPII) {
    for (const k of await tenders.otwarteZeZrodla(zrodlo, teraz)) if (!k.zastapiony_przez) kopie.push({ ...k, source: zrodlo });
  }
  const kandydaci = await tenders.doPorownaniaBlizniakow('bzp', {
    ids: kopie.map((k) => idBzpZTytulu(k.title)).filter(Boolean),
    terminy: kopie.map((k) => k.deadline),
  });
  const pary = [];
  for (const kopia of kopie) {
    const wiodacy = znajdzBlizniakaBzp(kopia, kandydaci);
    if (wiodacy) pary.push({ kopia, wiodacy });
  }
  const wynik = { kopie_otwarte: kopie.length, kandydaci_bzp: kandydaci.length, blizniaki: pary.length, kopie_w_feedach: 0, sucho };
  if (sucho || !pary.length) return { ...wynik, przyklady: pary.slice(0, 5).map((p) => `${p.kopia.title} ⇒ ${p.wiodacy.title}`) };
  await tenders.scalBlizniakiWsadowo(pary, teraz);
  wynik.kopie_w_feedach = await tenders.oznaczKopieWFeedach(new Map(pary.map((p) => [p.kopia.id, p.wiodacy.id])));
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
  let ile = 0;
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
      ile++;
    }
  }
  return ile;
}
