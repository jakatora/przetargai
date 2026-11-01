import { normalizeNip } from './nip.js';

/*
 * WYNIK ZAPISANEGO PRZETARGU (2026-11-01). Wykonawca zapisuje przetarg, składa ofertę i… nie wie, jak się
 * skończyło, dopóki nie zajrzy na platformę. Ogłoszenie o wyniku w BZP (`TenderResultNotice`) niesie ten sam
 * identyfikator postępowania (`ocds-…`) co ogłoszenie o zamówieniu, więc przy pobraniu wyników łączymy je
 * z Zapisanymi i wysyłamy jedno zdanie: kto wygrał, za ile, ile było ofert i jaki był rozrzut cen.
 * Gdy wygrał NIP konta — gratulacje i wartość umowy. CZYSTA funkcja; job: `jobs/wynikiZapisanych.js`.
 */

const zl = (n) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} zł`;
const pln = (n) => `PLN ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const liczba = (n) => (Number.isFinite(n) ? n : null);

/** 1 oferta, 2–4 oferty, 5+ ofert (12–14 jak 5). */
function oferty(n) {
  const d = n % 100;
  const j = n % 10;
  if (n === 1) return '1 oferta';
  return `${n} ${j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? 'oferty' : 'ofert'}`;
}

/** „Wygrał X za 120 000 zł (5 ofert: od 98 000 zł do 160 000 zł)” — jedna część. */
function zdanieCzesci(c, { zNumerem }) {
  const przedrostek = zNumerem ? { pl: `Część ${c.numer}: `, en: `Lot ${c.numer}: ` } : { pl: '', en: '' };
  if (c.uniewaznione) return { pl: `${przedrostek.pl}unieważniona.`, en: `${przedrostek.en}cancelled.` };
  const cena = liczba(c.cenaWybrana) ?? liczba(c.wartoscUmowy);
  const ile = liczba(c.liczbaOfert);
  const min = liczba(c.cenaNajnizsza);
  const max = liczba(c.cenaNajwyzsza);
  const rozrzut = ile && ile > 1 && min !== null && max !== null && min !== max && c.spojne !== false;
  const nawias = ile ? {
    pl: ` (${oferty(ile)}${rozrzut ? `: od ${zl(min)} do ${zl(max)}` : ''})`,
    en: ` (${ile} bid${ile === 1 ? '' : 's'}${rozrzut ? `: ${pln(min)} to ${pln(max)}` : ''})`,
  } : { pl: '', en: '' };
  const kto = c.zwyciezca?.nazwa ?? null;
  const zdanie = !kto
    ? { pl: `rozstrzygnięta${nawias.pl}.`, en: `awarded${nawias.en}.` }
    : {
      pl: `wygrał ${kto}${cena !== null ? ` za ${zl(cena)}` : ''}${nawias.pl}.`,
      en: `won by ${kto}${cena !== null ? ` for ${pln(cena)}` : ''}${nawias.en}.`,
    };
  return zNumerem
    ? { pl: przedrostek.pl + zdanie.pl, en: przedrostek.en + zdanie.en }
    : { pl: wielka(zdanie.pl), en: wielka(zdanie.en) };
}

const wielka = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * @param {{tenderId: string, tender?: {title?: string, organization?: string, deadline?: string, source?: string}|null,
 *   wynik: {externalId: string, czesci?: object[]}, nipKonta?: string|null}} wejscie
 * @returns {object|null} alert do centrum (`alerty.dodaj`) albo null, gdy wynik nie ma części
 */
export function alertWynikuZapisanego({ tenderId, tender = null, wynik, nipKonta = null }) {
  const czesci = (Array.isArray(wynik?.czesci) ? wynik.czesci : []).filter(Boolean);
  if (!tenderId || !wynik?.externalId || !czesci.length) return null;
  const tytul = String(tender?.title ?? wynik.tytul ?? 'przetarg').slice(0, 90);
  const nip = normalizeNip(nipKonta);
  const wygrane = nip ? czesci.filter((c) => !c.uniewaznione && normalizeNip(c.zwyciezca?.nip) === nip) : [];
  const wszystkieUniewaznione = czesci.every((c) => c.uniewaznione);
  const zNumerem = czesci.length > 1;
  const pokazane = czesci.slice(0, 2).map((c) => zdanieCzesci(c, { zNumerem }));
  const reszta = czesci.length - pokazane.length;
  const dopisek = reszta > 0 ? { pl: ` I jeszcze ${reszta} ${reszta === 1 ? 'część' : 'części'} w aplikacji.`, en: ` ${reszta} more lot${reszta === 1 ? '' : 's'} in the app.` } : { pl: '', en: '' };

  let naglowek;
  let ton;
  if (wygrane.length) {
    const wartosc = wygrane.reduce((s, c) => s + (liczba(c.wartoscUmowy) ?? liczba(c.cenaWybrana) ?? 0), 0);
    naglowek = {
      tytul: { pl: `Wygrałeś przetarg: ${tytul}`, en: `You won the tender: ${tytul}` },
      wstep: {
        pl: `Twoja firma wygrała${zNumerem ? ` ${wygrane.length === 1 ? `część ${wygrane[0].numer}` : `${wygrane.length} części`}` : ''}${wartosc ? ` — umowa na ${zl(wartosc)}` : ''}. `,
        en: `Your company won${zNumerem ? ` ${wygrane.length === 1 ? `lot ${wygrane[0].numer}` : `${wygrane.length} lots`}` : ''}${wartosc ? ` — contract worth ${pln(wartosc)}` : ''}. `,
      },
    };
    ton = 'sukces';
  } else if (wszystkieUniewaznione) {
    naglowek = {
      tytul: { pl: `Przetarg unieważniony: ${tytul}`, en: `Tender cancelled: ${tytul}` },
      wstep: { pl: 'Zamawiający unieważnił postępowanie — może ogłosić je ponownie. ', en: 'The buyer cancelled the procedure — it may be re-tendered. ' },
    };
    ton = 'ostrzezenie';
  } else {
    naglowek = { tytul: { pl: `Wynik przetargu: ${tytul}`, en: `Tender result: ${tytul}` }, wstep: { pl: '', en: '' } };
    ton = 'neutral';
  }
  const tresc = wszystkieUniewaznione && !zNumerem
    ? { pl: naglowek.wstep.pl.trim(), en: naglowek.wstep.en.trim() }
    : {
      pl: `${naglowek.wstep.pl}${pokazane.map((z) => z.pl).join(' ')}${dopisek.pl}`,
      en: `${naglowek.wstep.en}${pokazane.map((z) => z.en).join(' ')}${dopisek.en}`,
    };
  return {
    klucz: `wynik_${String(tenderId).replace(/[/\s]/g, '_')}`,
    typ: 'wynik_przetargu',
    tender_id: tenderId,
    ton,
    tytul: naglowek.tytul,
    tresc,
    pozycje: [{
      tender_id: tenderId,
      tytul: tender?.title ?? wynik.tytul ?? null,
      organizacja: tender?.organization ?? wynik.zamawiajacy ?? null,
      deadline: tender?.deadline ?? null,
      zrodlo: tender?.source ?? 'bzp',
    }],
  };
}
