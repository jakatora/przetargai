/**
 * Ekran „Twoje przetargi” — czyste reguły „liczba → zdanie” (plans/PRACOWNIK-PROJEKT-2026-10-23.md §10, §14).
 * Kody przyczyn MUSZĄ zgadzać się z firebase/functions/src/lib/przyczyny.js.
 * Teksty mówią „my” — słowo „pracownik” nie pada w aplikacji.
 */
export const PRZYCZYNY = ['branza', 'wykluczenie', 'teren', 'za_duze', 'za_male', 'termin', 'warunki', 'inne'];
export const PRZYCZYNY_KLIENTA = PRZYCZYNY.filter((k) => k !== 'wykluczenie');

export const ETYKIETY_PRZYCZYN = {
  branza: { pl: 'Nie Twoja branża', en: 'Not your trade' },
  wykluczenie: { pl: 'Na liście „nie bierzemy”', en: 'On your “we don’t do” list' },
  teren: { pl: 'Poza Twoim terenem', en: 'Outside your area' },
  za_duze: { pl: 'Za duże dla Twojej firmy', en: 'Too large for your company' },
  za_male: { pl: 'Za małe', en: 'Too small' },
  termin: { pl: 'Za mało czasu na ofertę', en: 'Not enough time to bid' },
  warunki: { pl: 'Warunki udziału nie do spełnienia', en: 'Participation conditions not met' },
  inne: { pl: 'Inne', en: 'Other' },
};

export function etykietaPrzyczyny(kod) {
  return ETYKIETY_PRZYCZYN[kod] ?? ETYKIETY_PRZYCZYN.inne;
}

/** Polska odmiana: 1 → [0], 2–4 (bez 12–14) → [1], reszta → [2]. */
function odmiana(n, formy) {
  if (n === 1) return formy[0];
  const j = n % 10;
  const d = n % 100;
  return j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? formy[1] : formy[2];
}

export function zdanieRaportu(raport) {
  const r = raport ?? {};
  if (!r.ostatni_przebieg_o && !r.przejrzane) {
    return {
      pl: 'Pierwszy przegląd rynku zrobimy przy najbliższym przebiegu.',
      en: 'We will run the first market review at the next scheduled pass.',
    };
  }
  const n = r.przejrzane ?? 0;
  return {
    pl: `Dziś przejrzeliśmy ${n} ${odmiana(n, ['ogłoszenie', 'ogłoszenia', 'ogłoszeń'])} · wybraliśmy ${r.wybrane ?? 0} · odrzuciliśmy ${r.odrzucone_razem ?? 0}`,
    en: `Today we reviewed ${n} ${n === 1 ? 'notice' : 'notices'} · picked ${r.wybrane ?? 0} · rejected ${r.odrzucone_razem ?? 0}`,
  };
}

export function grupujOdrzucone(wgPrzyczyny) {
  return Object.entries(wgPrzyczyny ?? {})
    .filter(([, n]) => Number(n) > 0)
    .map(([kod, liczba]) => ({ kod, etykieta: etykietaPrzyczyny(kod), liczba: Number(liczba) }))
    .sort((a, b) => b.liczba - a.liczba);
}

export function opisProby(proba) {
  if (!proba?.aktywna) return null;
  const n = proba.dni_zostalo;
  return {
    pl: `Próba Standard: ${odmiana(n, ['został', 'zostały', 'zostało'])} ${n} ${n === 1 ? 'dzień' : 'dni'}`,
    en: `Standard trial: ${n} ${n === 1 ? 'day' : 'days'} left`,
  };
}

/** Znacznik „komunikat o końcu próby już pokazany” — wartość = `proba.do` tej próby. */
export const KLUCZ_KONCA_PROBY = 'przetargai.proba_koniec_pokazany';

/** Jednorazowy komunikat po końcu próby (spec §15) — tylko konto, które wróciło na Free. */
export function opisKoncaProby(proba, plan, pokazanyDla) {
  if (!proba?.do || proba.aktywna || plan !== 'free' || pokazanyDla === proba.do) return null;
  return {
    pl: 'Próba Standard się skończyła — od dziś wybieramy do 5 przetargów dziennie.',
    en: 'Your Standard trial has ended — from today we pick up to 5 tenders a day.',
  };
}

const dwie = (x) => String(x).padStart(2, '0');

export function opisNastepnegoPrzebiegu(iso, teraz = new Date()) {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return null;
  const godz = `${dwie(t.getHours())}:${dwie(t.getMinutes())}`;
  const dzisiaj = new Date(teraz);
  const jutro = new Date(dzisiaj.getFullYear(), dzisiaj.getMonth(), dzisiaj.getDate() + 1);
  const tenSamDzien = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (tenSamDzien(t, dzisiaj)) return { pl: `Następny przegląd: dziś o ${godz}`, en: `Next review: today at ${godz}` };
  if (tenSamDzien(t, jutro)) return { pl: `Następny przegląd: jutro o ${godz}`, en: `Next review: tomorrow at ${godz}` };
  return { pl: `Następny przegląd: ${dwie(t.getDate())}.${dwie(t.getMonth() + 1)} o ${godz}`, en: `Next review: ${dwie(t.getDate())}.${dwie(t.getMonth() + 1)} at ${godz}` };
}

export function zdanieOczekujacych(n, plan) {
  if (!n) return null;
  const baza = {
    pl: `${n} ${odmiana(n, ['przetarg czeka', 'przetargi czekają', 'przetargów czeka'])} na ocenę w kolejnym przeglądzie`,
    en: `${n} ${n === 1 ? 'tender waits' : 'tenders wait'} for review in the next pass`,
  };
  if (plan !== 'free') return baza;
  return { pl: `${baza.pl} — w Standard oceniamy ich więcej każdego dnia.`, en: `${baza.en} — Standard reviews more of them every day.` };
}
