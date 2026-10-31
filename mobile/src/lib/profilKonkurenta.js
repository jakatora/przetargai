/* Czyste pomocnicze ekranu „Profil konkurenta” (screens/ProfilKonkurentaScreen.js) — testowalne w Node. */

/** Czy zwycięzcę da się otworzyć jako profil: NIP (BZP) albo nazwa (TED). */
export function czyMoznaOtworzycProfil(zwyciezca) {
  const nip = String(zwyciezca?.nip ?? '').replace(/\D/g, '');
  return nip.length === 10 || String(zwyciezca?.nazwa ?? '').trim().length >= 3;
}

/** Query dla `GET /wygrywalnosc/wykonawca` (bez URLSearchParams — w React Native bywa niepełny). */
export function parametryProfilu({ nip = null, nazwa = null } = {}) {
  const czesci = [];
  const czystyNip = String(nip ?? '').replace(/\D/g, '');
  if (czystyNip.length === 10) czesci.push(`nip=${czystyNip}`);
  const n = String(nazwa ?? '').trim();
  if (n.length >= 3) czesci.push(`nazwa=${encodeURIComponent(n.slice(0, 300))}`);
  return czesci.join('&');
}

const RODZAJE = { Works: ['roboty budowlane', 'works'], Delivery: ['dostawy', 'supplies'], Services: ['usługi', 'services'] };
export function etykietaRodzaju(rodzaj, t) {
  const r = RODZAJE[rodzaj];
  return r ? t(r[0], r[1]) : rodzaj;
}

/** „Wygrywa najniższą ceną w 3 z 5” — tylko gdy znamy pozycję ceny w co najmniej 3 częściach. */
export function opisNajnizszejCeny(najnizsza, t) {
  if (!najnizsza || !(najnizsza.z >= 3)) return null;
  return t(`Najniższą ceną wygrał ${najnizsza.razy} z ${najnizsza.z} razy`, `Won with the lowest price ${najnizsza.razy} of ${najnizsza.z} times`);
}

export function opisWygranych(liczba, t) {
  if (liczba === 1) return t('1 wygrana', '1 win');
  const n = liczba % 10;
  const nn = liczba % 100;
  const pl = n >= 2 && n <= 4 && !(nn >= 12 && nn <= 14) ? 'wygrane' : 'wygranych';
  return t(`${liczba} ${pl}`, `${liczba} wins`);
}
