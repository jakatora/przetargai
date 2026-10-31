/*
 * „Wypełnij moimi danymi” (2026-10-31): formularz zamawiającego w Wordzie wypełniony danymi firmy
 * wpisanymi raz w „Dokumentach do oferty”. Logika poza komponentem — testowalna w Node.
 */
const HOST = /^https:\/\/([a-z0-9-]+\.)*(ezamowienia\.gov\.pl|platformazakupowa\.pl)\//i;
const POLA = ['nazwa', 'adres', 'nip', 'regon', 'rejestr', 'reprezentant', 'stanowisko', 'email', 'telefon', 'miejscowosc'];

/** Tylko .docx z e-Zamówień / platformazakupowa.pl (stary .doc i PDF się nie da). */
export function czyMoznaWypelnic(dokument) {
  if (!dokument?.url || !HOST.test(dokument.url)) return false;
  const roz = String(dokument.rozszerzenie ?? '').toLowerCase();
  return roz === 'docx' || /\.docx$/i.test(String(dokument.plik ?? dokument.nazwa ?? ''));
}

/** Zapis z magazynu (JSON) → pola dla serwera; null, gdy nie ma choćby nazwy firmy. */
export function daneDoWypelnienia(surowe) {
  let d;
  try { d = typeof surowe === 'string' ? JSON.parse(surowe) : surowe; } catch { return null; }
  if (!d || typeof d !== 'object') return null;
  const wynik = {};
  for (const k of POLA) {
    const v = String(d[k] ?? '').trim();
    if (v) wynik[k] = v.slice(0, 300);
  }
  return wynik.nazwa && wynik.nazwa.length >= 2 ? wynik : null;
}

/** „1 pole”, „2 pola”, „5 pól”, „22 pola”. */
export function liczbaPol(n) {
  if (n === 1) return '1 pole';
  const j = n % 10;
  const d = n % 100;
  return `${n} ${j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? 'pola' : 'pól'}`;
}

/** Komunikat po wypełnieniu (raport z serwera). */
export function opisWypelnienia(w, t) {
  const ile = w?.wypelnione?.length ?? 0;
  const reszta = (w?.do_uzupelnienia ?? []).slice(0, 4).map((d) => d.etykieta).filter(Boolean);
  const gdzie = w?.do ? t(` Wysłaliśmy na ${w.do}.`, ` Sent to ${w.do}.`) : '';
  if (!ile) return t(`Nie znaleźliśmy w tym pliku pól na dane firmy — wypełnij go ręcznie.${gdzie}`, `We found no company-data fields in this file — fill it in by hand.${gdzie}`);
  return t(`Wpisaliśmy ${liczbaPol(ile)} z danymi firmy.${gdzie}`, `We filled in ${ile} company-data fields.${gdzie}`)
    + (reszta.length ? t(` Uzupełnij sam: ${reszta.join('; ')}.`, ` Fill in yourself: ${reszta.join('; ')}.`) : '');
}
