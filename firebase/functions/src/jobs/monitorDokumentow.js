import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { saved, tenders, alerty, users } from '../db/repos.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';
import { pobierzDokumenty, czyIdPostepowania } from '../services/eZamowieniaDokumenty.js';
import { noweDokumenty, alertNowychDokumentow, podsumowanieZmian, rodzajDokumentu } from '../lib/noweDokumenty.js';
import { parsujOtwarcie, scalOtwarcie } from '../lib/otwarcieOfert.js';
import { liniePdf } from '../services/tekstPdf.js';
import { pobierzPdfBase64 } from './autoAnalizaSwz.js';

/** Tekst PDF-a z e-Zamówień → liczby z informacji z otwarcia ofert (≤ 5 MB, tylko dozwolone hosty). */
async function czytajOtwarcieDomyslnie(dok) {
  const linie = await liniePdf(Buffer.from(await pobierzPdfBase64(dok.url), 'base64'));
  return parsujOtwarcie((Array.isArray(linie) ? linie : linie?.linie ?? []).map((l) => (typeof l === 'string' ? l : l?.tekst ?? '')));
}
import { dostarcz } from './monitorWyszukiwan.js';

/*
 * MONITORING DOKUMENTÓW ZAPISANYCH PRZETARGÓW (2026-11-01, `lib/noweDokumenty.js`).
 *
 * Biegnie w tej samej funkcji co monitoring wyszukiwań (co 2 h). Bierze przetargi BZP z Zapisanych
 * (do 14 dni po terminie — informacja z otwarcia ofert przychodzi po nim), dociąga listę plików
 * z e-Zamówień i porównuje ze znaną. Nowe pliki → alert każdemu, kto ten przetarg zapisał.
 *
 * Koszt: jedno publiczne żądanie do e-Zamówień na przetarg (nie na użytkownika), ZERO AI. Budżet
 * przebiegu: `limit` przetargów i `budzetMs` czasu — najdawniej sprawdzane pierwsze, więc przerwany
 * przebieg nie omija w kółko tych samych. Błąd platformy przy jednym przetargu nie jest błędem
 * przebiegu (wróci za 2 h); idempotencję daje klucz alertu.
 */
const DNI_PO_TERMINIE = 14;

export async function runMonitorDokumentow({
  teraz = nowIso(), pobierz = pobierzDokumenty, wyslijPush = sendPush, wyslijEmail = sendEmail,
  limit = 80, budzetMs = 150_000, czytajOtwarcie = czytajOtwarcieDomyslnie,
} = {}) {
  const start = Date.now();
  const wynik = { ok: true, wpisow: 0, przetargow: 0, sprawdzone: 0, z_nowymi: 0, alerty: 0, push: 0, email: 0, bledy_platformy: 0, bledy: 0 };
  const od = new Date(Date.parse(teraz) - DNI_PO_TERMINIE * 86_400_000).toISOString();
  // Zapisane (alert z pushem) + czołówka feedu (wynik ≥ 70, do 40 na konto, tylko centrum alertów; 1.11: ~950
  // przetargów BZP, 80 na przebieg co 2 h = pełny cykl w kilkanaście godzin): leniwy użytkownik nie
  // zapisuje, a wyjaśnienia SWZ dotyczą i jego. Zapis wygrywa z dopasowaniem tego samego przetargu.
  const zapisane = (await saved.otwarteWszystkich(od)).map((w) => ({ ...w, zapisany: true }));
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
    .filter((t) => czyIdPostepowania(t.postepowanie_id))
    .sort((a, b) => Number(maZapis(b.id)) - Number(maZapis(a.id))
      || String(a.ez_monitor?.sprawdzone_o ?? '').localeCompare(String(b.ez_monitor?.sprawdzone_o ?? '')));
  wynik.przetargow = kandydaci.length;

  const uzytkownicy = new Map();
  const uzytkownik = async (id) => {
    if (!uzytkownicy.has(id)) uzytkownicy.set(id, await users.findById(id).catch(() => null));
    return uzytkownicy.get(id);
  };

  for (const t of kandydaci.slice(0, limit)) {
    if (Date.now() - start > budzetMs) break;
    let dokumenty;
    try {
      dokumenty = await pobierz(t.postepowanie_id);
    } catch (err) {
      wynik.bledy_platformy += 1;
      logger.warn({ err: err.message, tenderId: t.id }, 'Monitoring dokumentów: e-Zamówienia nie odpowiedziały — wróci w następnym przebiegu');
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
      let byloNowe = false;
      for (const wpis of poPrzetargu.get(t.id) ?? []) {
        const nowe = noweDokumenty(dokumenty, { znane, zapisanoO: wpis.saved_at });
        const alert = alertNowychDokumentow({ tender: t, nowe, zapisany: wpis.zapisany, otwarcie, teraz: Date.parse(teraz) });
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
        { zmiany: podsumowanieZmian(dokumenty), poprzednie: t.ez_zmiany ?? null, otwarcie, poprzednieOtwarcie: t.otwarcie_ofert ?? null });
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
