import { env } from '../config.js';
import { magicLinks } from '../db/repos.js';

/*
 * NIP Z MAILA (2026-11-02). NIP odblokowuje „Czy wygrałeś”, miejsce oferty po otwarciu ofert i „Twoje umowy”,
 * ale 2.11 nie miało go żadne z 32 kont: pole jest w apce dopiero od 1.2.2, a w App Store wciąż jest 1.1.9.
 * Przegląd tygodniowy niesie więc jednorazowy link (14 dni, cel `nip_z_maila`) do formularza z jednym polem —
 * bez logowania i bez względu na wersję apki. Link pozwala TYLKO zapisać NIP.
 */
export const CEL_NIP = 'nip_z_maila';
export const NIP_TTL_MIN = 14 * 24 * 60;

export async function linkNipu(userId, { linki = magicLinks } = {}) {
  const { token } = await linki.create({ userId, purpose: CEL_NIP, ttlMinutes: NIP_TTL_MIN });
  return `${env.APP_URL}/maile/nip?token=${token}`;
}

/**
 * Nazwa firmy z Białej listy VAT (wl-api.mf.gov.pl, publiczne, bez klucza) — do potwierdzenia „to Twoja firma?”
 * i uzupełnienia pustej nazwy. Błąd, limit albo podmiot spoza rejestru VAT = null (NIP i tak zapisujemy).
 */
export async function nazwaZBialejListy(nip, { fetchFn = fetch, teraz = new Date().toISOString(), limitMs = 5000 } = {}) {
  try {
    const res = await fetchFn(`https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${teraz.slice(0, 10)}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(limitMs),
    });
    if (!res.ok) return null;
    const nazwa = (await res.json())?.result?.subject?.name;
    return typeof nazwa === 'string' && nazwa.trim() ? nazwa.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}
