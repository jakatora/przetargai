import { ipKeyGenerator } from 'express-rate-limit';

/**
 * Wyznacza adres klienta, po którym limitujemy żądania.
 *
 * DLACZEGO NIE „pierwszy" ani nie „przedostatni" wpis X-Forwarded-For:
 * dokumentacja Google jest w tej sprawie niespójna. Strona Cloud Functions pisze,
 * że „pierwszy adres to zwykle IP klienta" — ale ten wpis pochodzi WPROST od klienta
 * i da się go dowolnie wstrzyknąć. Dokumentacja load balancera mówi z kolei, że
 * warstwa pośrednia DOPISUJE swoje wartości na końcu, nie weryfikując tego, co było
 * przed nimi. Liczba dopisanych wpisów zależy od topologii (sam GFE / GFE + LB),
 * więc każda pozycja liczona od końca jest zgadywaniem.
 *
 * Zamiast pozycji ufamy WŁAŚCIWOŚCI: infrastruktura Google dopisuje adresy z własnych,
 * publicznie udokumentowanych zakresów. Odcinamy je z końca listy razem z adresami
 * prywatnymi, a bierzemy ostatni adres, który został. To ten, który dopisała warstwa
 * pośrednia tuż przed sobą — czyli realny nadawca połączenia TCP.
 *
 * Atakujący może wstrzyknąć dowolny prefiks (także udający adresy Google) — ale jego
 * wpisy zawsze poprzedzają adres dopisany przez infrastrukturę, więc nie wpłyną
 * na wynik. (Audyt 2026-07-10: poprzednie wersje brały pierwszy, potem przedostatni
 * wpis — obie dawały się obejść przy odpowiedniej topologii.)
 */

/** Zakresy, z których adresy dopisuje infrastruktura Google (load balancer / GFE). */
const ZAKRESY_GOOGLE = [
  { baza: '130.211.0.0', maska: 22 },
  { baza: '35.191.0.0', maska: 16 },
];

function ipv4NaLiczbe(ip) {
  const oktety = ip.split('.');
  if (oktety.length !== 4) return null;
  let n = 0;
  for (const o of oktety) {
    const v = Number(o);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n * 256) + v;
  }
  return n;
}

function wZakresie(ip, { baza, maska }) {
  const a = ipv4NaLiczbe(ip);
  const b = ipv4NaLiczbe(baza);
  if (a === null || b === null) return false;
  const bity = 2 ** (32 - maska);
  return Math.floor(a / bity) === Math.floor(b / bity);
}

/** Adres należy do infrastruktury (Google, sieć prywatna, localhost) — nie jest klientem. */
function adresInfrastruktury(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  return ZAKRESY_GOOGLE.some((z) => wZakresie(ip, z));
}

/**
 * @param {{headers?: object, ip?: string, socket?: {remoteAddress?: string}}} req
 * @returns {string} klucz kubełka limitera (IPv6 znormalizowane do prefiksu /56)
 */
export function kluczKlienta(req) {
  const naglowek = req.headers?.['x-forwarded-for'];
  const wpisy = typeof naglowek === 'string'
    ? naglowek.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  // Odcinamy z KOŃCA wszystko, co dopisała infrastruktura; bierzemy ostatni realny adres.
  let i = wpisy.length - 1;
  while (i >= 0 && adresInfrastruktury(wpisy[i])) i--;

  const adres = (i >= 0 ? wpisy[i] : '') || req.ip || req.socket?.remoteAddress || '';
  if (!adres) return 'nieznany-klient';

  try {
    // ipKeyGenerator normalizuje IPv6 do /56 — inaczej jeden klient z pulą adresów
    // omijałby limit, zmieniając adres przy każdym żądaniu.
    return ipKeyGenerator(adres);
  } catch {
    // Śmieciowa wartość w nagłówku nie może wywrócić limitera; wpada do wspólnego kubełka.
    return `surowy:${adres.slice(0, 60)}`;
  }
}
