import { dzialCpv, normWojewodztwo } from './wynikiAgregacja.js';
import { normNip } from './profilKonkurenta.js';

/*
 * PODWYKONAWSTWO Z ROZSTRZYGNIĘĆ (2026-11-01). Mała firma często nie wygra drogi za 4 mln zł, ale może ją robić
 * jako podwykonawca — a kto wygrał, wiadomo z ogłoszenia o wyniku. Przegląd tygodniowy podaje największe
 * kontrakty z tygodnia w działach CPV i województwach z karty firmy: zwycięzca, miasto, zamawiający, kwota.
 * Czysta logika; job (`jobs/weeklyDigest.js`) czyta rozstrzygnięcia z tygodnia raz na przebieg.
 */
export const MIN_KWOTA_KONTRAKTU = 1_000_000;

/** Kontrakty z rozstrzygnięć: jedna pozycja na ogłoszenie i zwycięzcę, kwota ze spójnych części. */
export function duzeKontrakty(wyniki, { minKwota = MIN_KWOTA_KONTRAKTU } = {}) {
  const lista = [];
  for (const w of Array.isArray(wyniki) ? wyniki : []) {
    const dzial = dzialCpv(w?.cpv);
    const woj = normWojewodztwo(w?.wojewodztwo);
    // Podwykonawców szuka się przy robotach (45) i usługach (50+), nie przy dostawach (1.11: na czele były
    // zakup energii i oleju napędowego).
    if (!dzial || !woj || !(dzial === '45' || Number(dzial) >= 50)) continue;
    const poZwyciezcy = new Map();
    for (const c of w.czesci ?? []) {
      if (c?.uniewaznione || !c?.zwyciezca?.nazwa) continue;
      const kwota = c.spojne === false ? null : (Number.isFinite(c.wartoscUmowy) ? c.wartoscUmowy : Number.isFinite(c.cenaWybrana) ? c.cenaWybrana : null);
      if (kwota === null) continue;
      const k = normNip(c.zwyciezca.nip) || c.zwyciezca.nazwa;
      const e = poZwyciezcy.get(k) ?? { nazwa: c.zwyciezca.nazwa, nip: normNip(c.zwyciezca.nip) || null, miasto: c.zwyciezca.miasto ?? null, kwota: 0 };
      e.kwota += kwota;
      poZwyciezcy.set(k, e);
    }
    for (const e of poZwyciezcy.values()) {
      if (e.kwota < minKwota) continue;
      lista.push({ dzial, woj, tytul: w.tytul ?? null, zamawiajacy: w.zamawiajacy ?? null, opublikowano: w.opublikowano ?? null, wykonawca: { nazwa: e.nazwa, nip: e.nip, miasto: e.miasto }, kwota: Math.round(e.kwota) });
    }
  }
  return lista;
}

/**
 * Działy i województwa z DOPASOWAŃ konta — gdy karta ich nie ma (1.11: województwa w karcie miały 3 konta na 31).
 * Bierzemy tylko te, które stanowią co najmniej `minUdzial` dopasowań: profil ma odzwierciedlać, gdzie konto
 * pracuje, a nie pojedyncze przypadki.
 */
export function profilZDopasowan(dopasowania, { minUdzial = 0.2, maksDzialow = 3, maksRegionow = 2 } = {}) {
  const lista = Array.isArray(dopasowania) ? dopasowania : [];
  const top = (klucze, maks) => {
    const n = new Map();
    for (const k of klucze) if (k) n.set(k, (n.get(k) ?? 0) + 1);
    return [...n].filter(([, c]) => c >= Math.max(2, lista.length * minUdzial)).sort((a, b) => b[1] - a[1]).slice(0, maks).map(([k]) => k);
  };
  return {
    dzialy: top(lista.map((d) => dzialCpv(d.cpv)), maksDzialow),
    regiony: top(lista.map((d) => normWojewodztwo(d.wojewodztwo)), maksRegionow),
  };
}

/** Dla konta: działy i województwa z karty, bez własnych wygranych; największe pierwsze. Bez regionów — nic. */
export function kontraktyDlaKonta(kontrakty, { dzialy = [], regiony = [], wlasnyNip = null, limit = 3 } = {}) {
  if (!dzialy.length || !regiony.length) return [];
  const moj = normNip(wlasnyNip);
  return kontrakty
    .filter((k) => dzialy.includes(k.dzial) && regiony.includes(k.woj) && !(moj && k.wykonawca.nip === moj))
    .sort((a, b) => b.kwota - a.kwota)
    .slice(0, limit);
}
