import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { pobierzSuroweZmianyDnia } from '../services/bzp.js';
import { zmianaTerminu, najnowszeZmiany, alertZmianyTerminu } from '../lib/zmianaTerminuBzp.js';
import { tenders, tenderDocId, saved, users, alerty } from '../db/repos.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';
import { dostarcz } from './monitorWyszukiwan.js';

/*
 * ZMIANY TERMINÓW BZP (2026-11-01, `lib/zmianaTerminuBzp.js`) — przy każdym `bzpOknoFetch` (co 3 h): ogłoszenia
 * o zmianie z ostatnich `dni` dób → najnowsza zmiana terminu na ogłoszenie → `tenders.zaktualizujZeZrodla`, czyli
 * nowy `deadline`, wpis „termin” w historii zmian (alerty zapisanych wyszukiwań) i kopie w Zapisanych oraz
 * dopasowaniach z przeliczonym przypomnieniem. Konta, które przetarg zapisały albo analizowały, dostają alert
 * (gdy nowy termin jeszcze nie minął). Tylko tam, gdzie termin u nas jest inny — powtórka nic nie zapisuje.
 * Koszt: 1–2 zapytania BZP na dobę, jeden `getAll` terminów, a przy zmianach — odczyt zaangażowanych kont.
 */
export const DNI_DOMYSLNIE = 2;
const ROWNOLEGLE = 8;

const dobaWarszawska = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });

export async function runZmianyTerminowBzp({
  teraz = Date.now(), dni = DNI_DOMYSLNIE, doDniTemu = 0, powiadamiaj = true, pobierzDzien = pobierzSuroweZmianyDnia,
  przetargi = tenders, zapisane = saved, konta = users, alertyRepo = alerty, wyslijPush = sendPush, wyslijEmail = sendEmail,
} = {}) {
  const wynik = { ok: true, dob: 0, ogloszen: 0, zmian_terminu: 0, w_bazie: 0, zaktualizowane: 0, alerty: 0, bledy: 0 };
  const zmiany = [];
  // Okno: `dni` dób kończących się `doDniTemu` dób temu (uzupełnianie wstecz), od najstarszej.
  for (let i = dni - 1; i >= 0; i--) {
    const dzien = dobaWarszawska(teraz - (doDniTemu + i) * 86_400_000);
    try {
      const surowe = await pobierzDzien(dzien);
      wynik.dob += 1;
      wynik.ogloszen += surowe.length;
      for (const n of surowe) {
        const z = zmianaTerminu(n);
        if (z) zmiany.push(z);
      }
    } catch (err) {
      wynik.bledy += 1;
      logger.warn({ err: err.message, dzien }, 'Zmiany terminów BZP: doba pominięta');
    }
  }
  // Kilka zmian jednego ogłoszenia (1.11: 3.11 → 13.11, pół godziny później 13.11 → 9.11) — obowiązuje ostatnia.
  const najnowsze = najnowszeZmiany(zmiany);
  wynik.zmian_terminu = najnowsze.length;
  const stan = new Map((await przetargi.polaWielu(najnowsze.map((z) => tenderDocId(z.numerZmienianego)), ['deadline', 'termin_zmiana_o', 'title', 'organization']))
    .map((t) => [t.id, t]));

  // Zaangażowane konta (Zapisane + analiza SWZ) — raz na przebieg i dopiero przy pierwszej zmianie z przyszłym terminem.
  let zaangazowani = null;
  const kontaPrzetargu = async (tenderId) => {
    zaangazowani ??= (async () => {
      const mapa = new Map();
      const od = new Date(teraz - 30 * 86_400_000).toISOString();
      const wpisy = [...await zapisane.otwarteWszystkich(od), ...await zapisane.zaangazowaneWszystkich().catch(() => [])];
      for (const w of wpisy) mapa.set(w.tenderId, new Set([...(mapa.get(w.tenderId) ?? []), w.userId]));
      return mapa;
    })();
    return [...((await zaangazowani).get(tenderId) ?? [])];
  };
  const uzytkownicy = new Map();

  const obsluz = async (z) => {
    const t = stan.get(tenderDocId(z.numerZmienianego));
    if (!t) return; // ogłoszenia nie mamy (starsze niż baza albo spoza pobranych typów)
    wynik.w_bazie += 1;
    if (t.deadline === z.nowyTermin) return;
    // Uzupełnianie wstecz idzie oknami — zmiana starsza niż już zastosowana nie cofa terminu.
    if (t.termin_zmiana_o && String(t.termin_zmiana_o) >= String(z.opublikowano ?? '')) return;
    try {
      const { zmienione } = await przetargi.zaktualizujZeZrodla({
        externalId: z.numerZmienianego, deadline: z.nowyTermin, termin_zmiana_o: z.opublikowano, termin_zmiana_numer: z.numer,
      });
      if (!zmienione) return;
      wynik.zaktualizowane += 1;
      if (!powiadamiaj || !(Date.parse(z.nowyTermin) > teraz)) return;
      const alert = alertZmianyTerminu({ tender: t, staryTermin: t.deadline, nowyTermin: z.nowyTermin });
      for (const userId of await kontaPrzetargu(t.id)) {
        const { nowy } = await alertyRepo.dodaj(userId, alert, nowIso());
        if (!nowy) continue;
        wynik.alerty += 1;
        if (!uzytkownicy.has(userId)) uzytkownicy.set(userId, await konta.findById(userId).catch(() => null));
        await dostarcz({ user: uzytkownicy.get(userId), alert, wyslijPush, wyslijEmail });
      }
    } catch (err) {
      wynik.bledy += 1;
      logger.warn({ err: err.message, numer: z.numerZmienianego }, 'Zmiany terminów BZP: zapis nie powiódł się');
    }
  };
  // ~280 zmian terminu na dobę, każda to kilka operacji (przetarg, historia, kopie) — po kilka naraz, żeby
  // uzupełnianie wstecz oknami mieściło się w limicie trasy (300 s).
  for (let i = 0; i < najnowsze.length; i += ROWNOLEGLE) await Promise.all(najnowsze.slice(i, i + ROWNOLEGLE).map(obsluz));
  wynik.ok = wynik.bledy === 0;
  wynik.zakonczony_o = nowIso();
  logger.info(wynik, 'runZmianyTerminowBzp: zakończono');
  return wynik;
}
