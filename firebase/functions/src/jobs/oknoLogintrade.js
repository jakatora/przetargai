import { logger } from '../lib/logger.js';
import { oknoLt as repoOkna, tenders } from '../db/repos.js';
import { pustyLicznik } from '../lib/licznikZrodla.js';
import { kluczOgloszenia, PRIORYTET_ZRODEL } from '../lib/dedupZrodel.js';
import { ZRODLO, pobierzStrone, pobierzSzczegol, normalizujOgloszenieLt, idLogintrade, czyZagraniczne } from '../services/logintrade.js';

/*
 * OKNO LOGINTRADE (2026-10-31). Co 6 h lista od najnowszych, strona po stronie, aż do dwóch stron
 * z rzędu bez aktywnych zapytań (sufit `MAKS_STRON`). Nowe aktywne zapytanie → karta (kupiec, NIP,
 * termin z godziną) i dopiero wtedy zapis; bez karty nie zapisujemy (przyjdzie w następnym przebiegu).
 * Istniejące: lista zna tylko DZIEŃ terminu — gdy różni się od zapisanego, karta po nową godzinę.
 * Budżet kart na przebieg chroni serwis przy pierwszym przejściu (~300 aktywnych). Dedup z rejestrami
 * wiodącymi jak w oknie e-ProPublico: wpis BZP/TED/BK/… o tym samym kluczu → link poboczny.
 */
export const MAKS_STRON = 25;
export const MAKS_SZCZEGOLOW_NA_PRZEBIEG = 120;
export const ODSTEP_MS = 1_500;
export const PUSTYCH_STRON_DO_KONCA = 2;

const DZIEN_W_POLSCE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' });
const dzienWPolsce = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? DZIEN_W_POLSCE.format(d) : null;
};

export async function runOknoLt({
  fetchFn = fetch, teraz = () => new Date().toISOString(), maksStron = MAKS_STRON, maksSzczegolow = MAKS_SZCZEGOLOW_NA_PRZEBIEG,
  odstepMs = ODSTEP_MS, czekaj = (ms) => new Promise((r) => setTimeout(r, ms)), budzetMs = 480_000,
} = {}) {
  const start = Date.now();
  const licznik = pustyLicznik();
  const wynik = { ok: true, zrodlo: ZRODLO, strony: 0, nowe: 0, zaktualizowane: 0, bez_zmian: 0, scalone_z_rejestrem: 0, szczegoly: 0, bledy_szczegolu: 0, bledy_zapisu: 0, odlozone: 0, ...licznik };
  let szczegolyPozostalo = maksSzczegolow;
  let pustychZRzedu = 0;

  const karta = async (poz) => {
    szczegolyPozostalo--;
    if (odstepMs > 0) await czekaj(odstepMs);
    licznik.zapytania++;
    try {
      const sz = await pobierzSzczegol(poz.url, { fetchFn });
      wynik.szczegoly++;
      return sz;
    } catch (err) {
      wynik.bledy_szczegolu++;
      logger.warn({ err: err.message, id: poz.id }, 'Logintrade: karta zapytania nie powiodła się');
      return null;
    }
  };

  try {
    for (let strona = 1; strona <= maksStron; strona++) {
      if (Date.now() - start > budzetMs) { wynik.przerwane_budzetem = true; break; }
      if (strona > 1 && odstepMs > 0) await czekaj(odstepMs);
      licznik.zapytania++;
      const { pozycje, odrzucone } = await pobierzStrone(strona, { fetchFn });
      licznik.surowe += pozycje.length + odrzucone;
      licznik.odrzucone += odrzucone;
      if (!pozycje.length) break;
      wynik.strony = strona;
      // Zapytania zagranicznych spółek (tytuł cyrylicą) odpadają od razu — bez pobierania karty w każdym przebiegu.
      const zagraniczne = pozycje.filter((p) => p.aktywne && czyZagraniczne(p)).length;
      licznik.odrzucone += zagraniczne;
      const aktywne = pozycje.filter((p) => p.aktywne && !czyZagraniczne(p));
      if (!aktywne.length) {
        if (++pustychZRzedu >= PUSTYCH_STRON_DO_KONCA) break;
        continue;
      }
      pustychZRzedu = 0;

      for (const poz of aktywne) {
        if (Date.now() - start > budzetMs) { wynik.przerwane_budzetem = true; break; }
        const externalId = idLogintrade(poz);
        let istniejacy;
        try {
          istniejacy = await tenders.findById(externalId);
        } catch (err) {
          wynik.bledy_zapisu++;
          logger.warn({ err: err.message, id: externalId }, 'Logintrade: odczyt istniejącego zapytania nie powiódł się');
          continue;
        }

        if (istniejacy) {
          // Lista podaje sam dzień terminu; inny dzień niż zapamiętany = przesunięty termin → karta po godzinę.
          const znanyDzien = istniejacy.lt_dzien_listy ?? dzienWPolsce(istniejacy.deadline);
          if (poz.termin_dzien && znanyDzien !== poz.termin_dzien && szczegolyPozostalo > 0) {
            const sz = await karta(poz);
            if (sz) {
              try {
                const zmiana = Boolean(sz.termin && sz.termin !== istniejacy.deadline);
                if (zmiana) await tenders.zaktualizujZeZrodla({ externalId, title: poz.tytul, organization: sz.zamawiajacy, deadline: sz.termin, url: poz.url });
                await tenders.ustawDzienListyLt(istniejacy.id ?? externalId, poz.termin_dzien);
                if (zmiana) { wynik.zaktualizowane++; continue; }
              } catch (err) {
                wynik.bledy_zapisu++;
                logger.warn({ err: err.message, id: externalId }, 'Logintrade: aktualizacja terminu nie powiodła się');
                continue;
              }
            }
          }
          wynik.bez_zmian++;
          continue;
        }

        if (szczegolyPozostalo <= 0) { wynik.odlozone++; continue; }
        const sz = await karta(poz);
        const t = sz ? normalizujOgloszenieLt(poz, sz) : null;
        if (!t) { if (sz) licznik.odrzucone++; continue; }

        const klucz = kluczOgloszenia(t);
        const istniejace = klucz ? await tenders.poKluczuDedup([klucz]).catch(() => new Map()) : new Map();
        const wiodacy = klucz ? (istniejace.get(klucz) ?? []).find((d) => d.source !== ZRODLO && PRIORYTET_ZRODEL.indexOf(d.source) < PRIORYTET_ZRODEL.indexOf(ZRODLO)) : null;
        if (wiodacy) {
          try { await tenders.dodajZrodloAlternatywne(wiodacy.id, { source: ZRODLO, externalId: t.externalId, url: t.url }); wynik.scalone_z_rejestrem++; } catch (err) {
            logger.warn({ err: err.message, id: t.externalId }, 'Logintrade: dopisanie linku do rejestru wiodącego nie powiodło się');
          }
          continue;
        }
        try {
          const { created, tender } = await tenders.upsert(t);
          if (created) {
            wynik.nowe++;
            await tenders.ustawDzienListyLt(tender.id, poz.termin_dzien).catch((err) => logger.warn({ err: err.message, id: t.externalId }, 'Logintrade: zapis dnia z listy nie powiódł się'));
          } else {
            wynik.bez_zmian++;
          }
        } catch (err) {
          wynik.bledy_zapisu++;
          logger.warn({ err: err.message, id: t.externalId }, 'Logintrade: zapis zapytania nie powiódł się');
        }
      }
    }
  } catch (err) {
    wynik.ok = false;
    wynik.error = err.message;
    logger.error({ err: err.message, strony: wynik.strony }, 'Logintrade: okno przerwane');
  }
  const koniec = teraz();
  Object.assign(wynik, licznik, { durationMs: Date.now() - start, o: koniec, zakonczony_o: koniec });
  await repoOkna.zapiszPrzebieg(wynik).catch((err) => logger.error({ err: err.message }, 'Logintrade: zapis śladu przebiegu nie powiódł się'));
  return wynik;
}
