import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { saved, tenders, rozstrzygniecia, users, alerty } from '../db/repos.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';
import { znajdzPonowne, alertPonownego } from '../lib/ponowneOgloszenie.js';
import { zapiszPoAnalizieSwz } from '../services/zapisPoAnalizie.js';
import { dostarcz } from './monitorWyszukiwan.js';

/*
 * PONOWNE OGŁOSZENIA UNIEWAŻNIONYCH PRZETARGÓW (2026-11-01, `lib/ponowneOgloszenie.js`). Bierze Zapisane i przetargi
 * z analizą SWZ do 120 dni po terminie; unieważniony = znacznik anulowania albo wynik, w którym wszystkie części
 * są unieważnione. Dla takich szuka nowego ogłoszenia zamawiającego wśród otwartych (po NIP-ie i po dokładnej
 * nazwie) i — gdy jest — zapisuje je kontu z przypomnieniem i wysyła alert, raz na parę stary × nowy. Koszt:
 * kilkadziesiąt odczytów, a przy pierwszym unieważnionym jeszcze pula otwartych (~10 tys. odczytów pól).
 */
export const DNI_PO_TERMINIE = 120;
const POLA = ['title', 'organization', 'deadline', 'source', 'cpv_main', 'zamawiajacy_nip', 'postepowanie_id', 'anulowany'];

export async function runPonowneOgloszenia({
  teraz = Date.now(), zapisane = saved, przetargi = tenders, wyniki = rozstrzygniecia, konta = users, alertyRepo = alerty,
  wyslijPush = sendPush, wyslijEmail = sendEmail, zapisz = zapiszPoAnalizieSwz,
} = {}) {
  const wynik = { ok: true, wpisow: 0, po_terminie: 0, uniewaznione: 0, ponowne: 0, alerty: 0, zapisane: 0, bledy: 0 };
  const od = new Date(teraz - DNI_PO_TERMINIE * 86_400_000).toISOString();
  const poKluczu = new Map();
  for (const w of [...await zapisane.otwarteWszystkich(od), ...await (zapisane.zaangazowaneWszystkich?.() ?? Promise.resolve([])).catch(() => [])]) {
    if (!poKluczu.has(`${w.userId}|${w.tenderId}`)) poKluczu.set(`${w.userId}|${w.tenderId}`, w);
  }
  wynik.wpisow = poKluczu.size;
  const poPrzetargu = new Map();
  for (const w of poKluczu.values()) poPrzetargu.set(w.tenderId, [...(poPrzetargu.get(w.tenderId) ?? []), w]);
  const stan = await przetargi.polaWielu([...poPrzetargu.keys()], POLA);
  const uzytkownicy = new Map();
  // Pula otwartych raz na przebieg i dopiero przy pierwszym unieważnionym: po NIP-ie i po dokładnej nazwie (nowe
  // ogłoszenie z PZ/ePP bywa bez NIP-u, choć stare z BZP go ma).
  let pula = null;
  const kandydaciDla = async (t) => {
    if (!pula) {
      pula = { poNip: new Map(), poNazwie: new Map() };
      const dopisz = (mapa, klucz, k) => { if (klucz) mapa.set(klucz, [...(mapa.get(klucz) ?? []), k]); };
      for (const k of await przetargi.otwarteZamawiajacych(new Date(teraz).toISOString())) {
        dopisz(pula.poNip, k.zamawiajacy_nip ? String(k.zamawiajacy_nip) : null, k);
        dopisz(pula.poNazwie, k.organization, k);
      }
    }
    const lista = [...(t.zamawiajacy_nip ? pula.poNip.get(String(t.zamawiajacy_nip)) ?? [] : []), ...(pula.poNazwie.get(t.organization) ?? [])];
    return [...new Map(lista.map((k) => [k.id, k])).values()];
  };
  for (const t of stan) {
    if (!(Date.parse(t.deadline ?? '') < teraz) || Date.parse(t.deadline) < Date.parse(od)) continue;
    wynik.po_terminie += 1;
    try {
      let uniewazniony = t.anulowany === true;
      if (!uniewazniony && t.postepowanie_id) {
        const r = await wyniki.poPostepowaniu(t.postepowanie_id);
        uniewazniony = Boolean(r?.czesci?.length) && r.czesci.every((c) => c?.uniewaznione);
      }
      if (!uniewazniony) continue;
      wynik.uniewaznione += 1;
      const znaleziony = znajdzPonowne(t, await kandydaciDla(t), { teraz });
      if (!znaleziony) continue;
      wynik.ponowne += 1;
      const nowy = await przetargi.findById(znaleziony.tender.id);
      if (!nowy) continue;
      for (const wpis of poPrzetargu.get(t.id) ?? []) {
        // Alert już był → konto wie i mogło świadomie usunąć nowe ogłoszenie z Zapisanych: nie zapisujemy drugi raz.
        if (await alertyRepo.istnieje(wpis.userId, alertPonownego({ stary: t, nowy }).klucz)) continue;
        const { zapisany } = await zapisz(wpis.userId, nowy);
        if (zapisany) wynik.zapisane += 1;
        const alert = alertPonownego({ stary: t, nowy, zapisano: zapisany });
        const { nowy: nowyAlert } = await alertyRepo.dodaj(wpis.userId, alert, nowIso());
        if (!nowyAlert) continue;
        wynik.alerty += 1;
        if (!uzytkownicy.has(wpis.userId)) uzytkownicy.set(wpis.userId, await konta.findById(wpis.userId).catch(() => null));
        await dostarcz({ user: uzytkownicy.get(wpis.userId), alert, wyslijPush, wyslijEmail });
      }
    } catch (err) {
      wynik.bledy += 1;
      logger.error({ err: err.message, tenderId: t.id }, 'Ponowne ogłoszenia: przetarg pominięty');
    }
  }
  wynik.ok = wynik.bledy === 0;
  logger.info(wynik, 'runPonowneOgloszenia: zakończono');
  return wynik;
}
