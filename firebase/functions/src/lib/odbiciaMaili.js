import { createHash } from 'node:crypto';

/*
 * ODBITE ADRESY (2026-11-07). Resend przyjmuje mail do wysyłki („sent”), a odbicie przychodzi później — `sendEmail`
 * go nie widzi, więc ten sam adres dostawał maile codziennie. Pomiar 7.11 (200 ostatnich maili): 40% odbitych, wszystkie
 * od kont testowych i fikcyjnych (`@test.pl`, nieistniejące skrzynki `@przetargai.pl`, dwa konta firm z identycznym
 * profilem). Tyle odbić psuje reputację nadawcy (Resend zawiesza konta przy kilku procentach) i wpycha maile
 * prawdziwych klientów do spamu. Czyste funkcje — odczyt listy i zapis są w jobs/odbiciaMaili.js.
 */
export const ZDARZENIA_ODBICIA = new Set(['bounced', 'complained']);
/** Powyżej tego odsetka odbić w dobie (przy co najmniej MIN_MAILI maili) `/health` zgłasza problem. */
export const PROG_ODSETKA = 0.05;
export const MIN_MAILI = 20;

export const normalizujAdres = (adres) => String(adres ?? '').trim().toLowerCase();

/** Id dokumentu w `odbite_adresy` — skrót adresu (adres w id dokumentu = dane osobowe w ścieżkach i logach). */
export const idAdresu = (adres) => createHash('sha256').update(normalizujAdres(adres)).digest('hex');

/** Czas z listy Resend („2026-11-07 11:04:07.381+00”) → ms; nieczytelny = NaN. */
export const czasMaila = (mail) => Date.parse(String(mail?.created_at ?? '').replace(' ', 'T').replace(/\+00$/, 'Z'));

/**
 * Maile z listy Resend → adresy do zablokowania (ostatnie zdarzenie odbicie albo zgłoszenie spamu) i licznik doby.
 * @param {object[]} maile elementy `data` z GET /emails
 * @returns {{ adresy: Map<string, {typ: string, o: string}>, maili24h: number, odbite24h: number, odsetek: number|null }}
 */
export function podsumujMaile(maile, { teraz }) {
  const granica = Date.parse(teraz) - 24 * 3_600_000;
  const adresy = new Map();
  let maili24h = 0;
  let odbite24h = 0;
  for (const mail of maile ?? []) {
    const odbity = ZDARZENIA_ODBICIA.has(mail?.last_event);
    const czas = czasMaila(mail);
    if (Number.isFinite(czas) && czas >= granica) {
      maili24h++;
      if (odbity) odbite24h++;
    }
    if (!odbity) continue;
    const o = Number.isFinite(czas) ? new Date(czas).toISOString() : teraz;
    for (const adres of [mail.to ?? []].flat()) {
      const klucz = normalizujAdres(adres);
      if (!klucz) continue;
      const byl = adresy.get(klucz);
      if (!byl || byl.o < o) adresy.set(klucz, { typ: mail.last_event, o });
    }
  }
  return { adresy, maili24h, odbite24h, odsetek: maili24h ? odbite24h / maili24h : null };
}

/** Czy odsetek odbić w dobie to problem (za mało maili = nie oceniamy). */
export const odbiciaZaWysokie = (stan) => typeof stan?.odsetek === 'number'
  && (stan.maili_24h ?? 0) >= MIN_MAILI && stan.odsetek > PROG_ODSETKA;
