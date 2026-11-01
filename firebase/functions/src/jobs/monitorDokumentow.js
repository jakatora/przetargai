import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { saved, tenders, alerty, users } from '../db/repos.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';
import { pobierzDokumenty, idPostepowaniaEz } from '../services/eZamowieniaDokumenty.js';
import { noweDokumenty, alertNowychDokumentow, podsumowanieZmian, rodzajDokumentu } from '../lib/noweDokumenty.js';
import { parsujOtwarcie, scalOtwarcie } from '../lib/otwarcieOfert.js';
import { parsujWyborOferty, scalWybor } from '../lib/wyborOferty.js';
import { liniePdf } from '../services/tekstPdf.js';
import { pobierzPdfBase64 } from './autoAnalizaSwz.js';
import { pobierzSzczegol as pobierzSzczegolPz, ZRODLO as ZRODLO_PZ } from '../services/platformaZakupowa.js';

/**
 * Załączniki ogłoszenia z platformazakupowa.pl w kształcie listy z e-Zamówień (2026-11-01): wyjaśnienia,
 * zmiany SWZ i informacja z otwarcia ofert lądują tam jako kolejne pliki. Id = adres pliku (stały).
 */
export function dokumentyZSzczegoluPz(szczegol) {
  return (Array.isArray(szczegol?.zalaczniki) ? szczegol.zalaczniki : []).filter((z) => z?.url && z?.nazwa).map((z) => ({
    id: z.url, nazwa: z.nazwa, plik: z.nazwa, rozszerzenie: z.rozszerzenie ?? null, url: z.url, opublikowano: z.opublikowano ?? null,
  }));
}

async function pobierzPzDomyslnie(t) {
  return dokumentyZSzczegoluPz(await pobierzSzczegolPz(String(t.bzp_external_id ?? t.id).replace(/^pz:/, '')));
}

/** Tekst PDF-a z e-Zamówień → liczby z informacji z otwarcia ofert (≤ 5 MB, tylko dozwolone hosty). */
async function czytajOtwarcieDomyslnie(dok) {
  const linie = await liniePdf(Buffer.from(await pobierzPdfBase64(dok.url), 'base64'));
  return parsujOtwarcie((Array.isArray(linie) ? linie : linie?.linie ?? []).map((l) => (typeof l === 'string' ? l : l?.tekst ?? '')));
}

/** Tekst pisma o wyborze najkorzystniejszej oferty → kogo wybrano (`lib/wyborOferty.js`). */
async function czytajWyborDomyslnie(dok) {
  const linie = await liniePdf(Buffer.from(await pobierzPdfBase64(dok.url), 'base64'));
  return parsujWyborOferty(Array.isArray(linie) ? linie : []);
}
import { dostarcz } from './monitorWyszukiwan.js';

/** Platforma zaczęła odmawiać po ~20 szczegółach pod rząd (1.11) — limit i odstęp na przebieg. */
const LIMIT_PZ = 12;
const ODSTEP_PZ_MS = 3000;

/*
 * MONITORING DOKUMENTÓW ZAPISANYCH PRZETARGÓW (2026-11-01, `lib/noweDokumenty.js`).
 *
 * Biegnie w tej samej funkcji co monitoring wyszukiwań (co 2 h). Bierze przetargi BZP/TED (e-Zamówienia) i
 * platformazakupowa.pl (załączniki szczegółu, od 2026-11-01) z Zapisanych
 * (do 14 dni po terminie — informacja z otwarcia ofert przychodzi po nim), dociąga listę plików
 * z e-Zamówień i porównuje ze znaną. Nowe pliki → alert każdemu, kto ten przetarg zapisał.
 *
 * Koszt: jedno publiczne żądanie do e-Zamówień na przetarg (nie na użytkownika), ZERO AI. Budżet
 * przebiegu: `limit` przetargów i `budzetMs` czasu — najdawniej sprawdzane pierwsze, więc przerwany
 * przebieg nie omija w kółko tych samych. Błąd platformy przy jednym przetargu nie jest błędem
 * przebiegu (wróci za 2 h); idempotencję daje klucz alertu.
 */
const DNI_PO_TERMINIE = 14;
// Zapisane dłużej: wybór oferty przychodzi zwykle 2–6 tygodni po terminie, a od niego biegnie termin odwołania.
const DNI_PO_TERMINIE_ZAPISANYCH = 60;

export async function runMonitorDokumentow({
  teraz = nowIso(), pobierz = pobierzDokumenty, wyslijPush = sendPush, wyslijEmail = sendEmail,
  limit = 80, budzetMs = 150_000, czytajOtwarcie = czytajOtwarcieDomyslnie, czytajWybor = czytajWyborDomyslnie,
  pobierzPz = pobierzPzDomyslnie, limitPz = LIMIT_PZ, czekaj = (ms) => new Promise((r) => { setTimeout(r, ms); }),
} = {}) {
  const start = Date.now();
  const wynik = { ok: true, wpisow: 0, przetargow: 0, sprawdzone: 0, z_nowymi: 0, alerty: 0, push: 0, email: 0, bledy_platformy: 0, bledy: 0 };
  const od = new Date(Date.parse(teraz) - DNI_PO_TERMINIE * 86_400_000).toISOString();
  // Zapisane (alert z pushem) + czołówka feedu (wynik ≥ 70, do 40 na konto, tylko centrum alertów; 1.11: ~950
  // przetargów BZP, 80 na przebieg co 2 h = pełny cykl w kilkanaście godzin): leniwy użytkownik nie
  // zapisuje, a wyjaśnienia SWZ dotyczą i jego. Zapis wygrywa z dopasowaniem tego samego przetargu.
  const odZapisanych = new Date(Date.parse(teraz) - DNI_PO_TERMINIE_ZAPISANYCH * 86_400_000).toISOString();
  // Przetarg z analizą SWZ (Radar / „Zapytaj SWZ”) liczy się jak zapisany — push przy zmianach i wyborze oferty.
  const zapisane = [...await saved.otwarteWszystkich(odZapisanych), ...await saved.zaangazowaneWszystkich().catch(() => [])]
    .map((w) => ({ ...w, zapisany: true }));
  const dopasowane = (await saved.najlepszeDopasowaniaWszystkich(od).catch(() => [])).map((w) => ({ ...w, zapisany: false }));
  const poKluczu = new Map();
  for (const w of [...zapisane, ...dopasowane]) {
    const k = `${w.userId}|${w.tenderId}`;
    if (!poKluczu.has(k)) poKluczu.set(k, w);
  }
  wynik.wpisow = poKluczu.size;
  const poPrzetargu = new Map();
  for (const w of poKluczu.values()) {
    if (!poPrzetargu.has(w.tenderId)) poPrzetargu.set(w.tenderId, []);
    poPrzetargu.get(w.tenderId).push(w);
  }
  // Najpierw przetargi z Zapisanych, potem najdawniej sprawdzane.
  const maZapis = (id) => (poPrzetargu.get(id) ?? []).some((w) => w.zapisany);
  const kandydaci = (await tenders.stanMonitoraDokumentow([...poPrzetargu.keys()]))
    .filter((t) => idPostepowaniaEz(t) || t.source === ZRODLO_PZ)
    // Powiązania SWZ nie znają terminu — tu przycinamy do okna Zapisanych (60 dni po terminie).
    .filter((t) => !t.deadline || String(t.deadline) >= odZapisanych)
    .sort((a, b) => Number(maZapis(b.id)) - Number(maZapis(a.id))
      || String(a.ez_monitor?.sprawdzone_o ?? '').localeCompare(String(b.ez_monitor?.sprawdzone_o ?? '')));
  wynik.przetargow = kandydaci.length;

  const uzytkownicy = new Map();
  const uzytkownik = async (id) => {
    if (!uzytkownicy.has(id)) uzytkownicy.set(id, await users.findById(id).catch(() => null));
    return uzytkownicy.get(id);
  };

  // platformazakupowa: osobny, mały limit (szczegół z SSO, platforma odmawia przy serii żądań).
  const pz = kandydaci.filter((t) => t.source === ZRODLO_PZ).slice(0, limitPz);
  const kolejka = [...kandydaci.filter((t) => t.source !== ZRODLO_PZ).slice(0, limit), ...pz];
  let pierwszyPz = true;
  for (const t of kolejka) {
    if (Date.now() - start > budzetMs) break;
    let dokumenty;
    try {
      if (t.source === ZRODLO_PZ) {
        if (!pierwszyPz) await czekaj(ODSTEP_PZ_MS);
        pierwszyPz = false;
        dokumenty = await pobierzPz(t);
      } else {
        dokumenty = await pobierz(idPostepowaniaEz(t));
      }
    } catch (err) {
      wynik.bledy_platformy += 1;
      logger.warn({ err: err.message, tenderId: t.id }, 'Monitoring dokumentów: platforma nie odpowiedziała — wróci w następnym przebiegu');
      continue;
    }
    try {
      wynik.sprawdzone += 1;
      const znane = Array.isArray(t.ez_monitor?.ids) ? t.ez_monitor.ids : null;
      // Informacja z otwarcia ofert / o kwocie (PDF): każdy taki plik czytamy raz — liczby idą do alertu i na kartę.
      let otwarcie = t.otwarcie_ofert ?? null;
      const przeczytane = new Set(otwarcie?.przeczytane ?? []);
      for (const d of dokumenty.filter((x) => rodzajDokumentu(x) === 'otwarcie' && x.rozszerzenie === 'pdf' && !przeczytane.has(x.id)).slice(0, 2)) {
        const odczyt = await czytajOtwarcie(d).catch((err) => {
          logger.warn({ err: err.message, tenderId: t.id, dokument: d.id }, 'Monitoring dokumentów: nie odczytano PDF-a z otwarcia ofert');
          return null;
        });
        otwarcie = scalOtwarcie(otwarcie, odczyt, d);
        if (odczyt) wynik.otwarcia = (wynik.otwarcia ?? 0) + 1;
      }
      // Pismo o wyborze oferty (PDF, bez unieważnień): też raz — kto wygrał idzie do alertu.
      let wybor = t.wybor_oferty ?? null;
      const przeczytaneWybory = new Set(wybor?.przeczytane ?? []);
      const pisma = dokumenty.filter((x) => rodzajDokumentu(x) === 'rozstrzygniecie' && x.rozszerzenie === 'pdf'
        && !/uniewa[żz]ni|uniewazni/i.test(`${x.nazwa ?? ''} ${x.plik ?? ''}`) && !przeczytaneWybory.has(x.id));
      for (const d of pisma.slice(0, 2)) {
        const odczyt = await czytajWybor(d).catch((err) => {
          logger.warn({ err: err.message, tenderId: t.id, dokument: d.id }, 'Monitoring dokumentów: nie odczytano pisma o wyborze oferty');
          return null;
        });
        wybor = scalWybor(wybor, odczyt, d);
        if (odczyt) wynik.wybory = (wynik.wybory ?? 0) + 1;
      }
      let byloNowe = false;
      for (const wpis of poPrzetargu.get(t.id) ?? []) {
        const nowe = noweDokumenty(dokumenty, { znane, zapisanoO: wpis.saved_at });
        const nipKonta = wybor?.wykonawcy?.length ? (await uzytkownik(wpis.userId))?.company_nip ?? null : null;
        const alert = alertNowychDokumentow({ tender: t, nowe, zapisany: wpis.zapisany, otwarcie, teraz: Date.parse(teraz), wybor, nipKonta });
        if (!alert) continue;
        byloNowe = true;
        const { nowy } = await alerty.dodaj(wpis.userId, alert, teraz);
        if (!nowy) continue;
        wynik.alerty += 1;
        if (!wpis.zapisany) continue; // czołówka feedu: tylko centrum alertów, bez pushu i maila
        const kanal = await dostarcz({ user: await uzytkownik(wpis.userId), alert, wyslijPush, wyslijEmail });
        if (kanal === 'push') wynik.push += 1;
        if (kanal === 'email') wynik.email += 1;
      }
      if (byloNowe) wynik.z_nowymi += 1;
      // Znana lista PO wysyłce — powtórkę po awarii odsiewa klucz alertu. Podsumowanie idzie na karty list.
      wynik.kopie = (wynik.kopie ?? 0) + await tenders.zapiszMonitorDokumentow(t.id, dokumenty, teraz,
        { zmiany: podsumowanieZmian(dokumenty), poprzednie: t.ez_zmiany ?? null, otwarcie, poprzednieOtwarcie: t.otwarcie_ofert ?? null, wybor });
    } catch (err) {
      wynik.bledy += 1;
      logger.error({ err: err.message, tenderId: t.id }, 'Monitoring dokumentów: przetarg pominięty');
    }
  }

  wynik.ok = wynik.bledy === 0;
  wynik.durationMs = Date.now() - start;
  logger.info(wynik, 'runMonitorDokumentow: zakończono');
  return wynik;
}
