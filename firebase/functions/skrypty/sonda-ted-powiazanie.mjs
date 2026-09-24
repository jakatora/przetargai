/*
 * Sonda: czy da sie POWIAZAC ogloszenie o wyniku TED z ogloszeniem o zamowieniu?
 *
 * BZP ma do tego `tenderId` (ocds-…, obecny w 200/200 wynikow). Dla TED
 * kandydatem jest `procedure-identifier` (BT-04-notice) i `previous-notice-id-proc`.
 * Sonda pobiera oba typy ogloszen z tego samego okna i mierzy pokrycie pol
 * oraz liczbe trafien w przeciecie.
 *
 * Read-only, publiczne API TED, bez klucza. Uzycie:
 *   node skrypty/sonda-ted-powiazanie.mjs
 */
const POLA = ['publication-number', 'notice-type', 'procedure-identifier', 'previous-notice-id-proc'];

async function szukaj(formType, od, limit = 100) {
  const odpowiedz = await fetch('https://api.ted.europa.eu/v3/notices/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `(place-of-performance IN (POL)) AND (publication-date >= ${od}) AND (form-type = ${formType}) SORT BY publication-date DESC`,
      fields: POLA,
      page: 1,
      limit,
    }),
  });
  const tekst = await odpowiedz.text();
  if (!odpowiedz.ok) {
    console.log(formType, 'HTTP', odpowiedz.status, tekst.slice(0, 400));
    return [];
  }
  const dane = JSON.parse(tekst);
  console.log(formType, '| total', dane.totalNoticeCount, '| pobrano', dane.notices?.length ?? 0);
  return dane.notices ?? [];
}

const pierwsza = (v) => (Array.isArray(v) ? v[0] : v) ?? null;

const wyniki = await szukaj('result', '20260801');
const konkursy = await szukaj('competition', '20260101', 250);

const zProcId = wyniki.filter((n) => pierwsza(n['procedure-identifier'])).length;
const zPoprzednim = wyniki.filter((n) => pierwsza(n['previous-notice-id-proc'])).length;
console.log('wyniki z procedure-identifier:', zProcId, '/', wyniki.length);
console.log('wyniki z previous-notice-id-proc:', zPoprzednim, '/', wyniki.length);
console.log('przyklad procedure-identifier:', pierwsza(wyniki[0]?.['procedure-identifier']));

const idKonkursow = new Set(konkursy.map((n) => pierwsza(n['procedure-identifier'])).filter(Boolean));
console.log('konkursy z procedure-identifier:', idKonkursow.size, '/', konkursy.length);
const trafienia = wyniki.filter((n) => idKonkursow.has(pierwsza(n['procedure-identifier']))).length;
console.log('trafien wynik -> konkurs w probce:', trafienia);
