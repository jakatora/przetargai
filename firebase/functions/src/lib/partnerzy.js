/*
 * KTO MOŻE UŻYCZYĆ DOŚWIADCZENIA — partner do konsorcjum, podwykonawca, podmiot udostępniający zasoby
 * (2026-10-31, z analizy konkurencji: Tender Vision, przetargi.info). Gdy w przetargu brakuje Ci
 * referencji, możesz polegać na doświadczeniu innej firmy (art. 118 Pzp) albo startować w konsorcjum.
 * Kto takie doświadczenie ma? Firmy, które w ostatnim roku wygrywały zamówienia tej samej KLASY CPV
 * (np. 4523 — drogi, rurociągi, linie), najpierw w województwie przetargu, potem w kraju; gdy klasa
 * nie uzbiera próbki — dział CPV w województwie. Dane z kubełków benchmarku (rozstrzygnięcia BZP i TED,
 * jawne), bez kontaktów: nazwa i NIP wystarczą do znalezienia firmy w KRS/CEIDG.
 */
import { dzialCpv, klasaCpv, normWojewodztwo } from './wynikiAgregacja.js';
import { nazwaKodu } from './cpvSlowa.js';
import { normNip } from './profilKonkurenta.js';

/** Poniżej tylu firm (po odjęciu własnej) poziom nie mówi „kto ma takie doświadczenie” — idziemy szerzej. */
export const MIN_PARTNEROW = 3;
export const TOP_PARTNEROW = 8;

/** Klucze kubełków w kolejności od najbardziej dopasowanego. */
export function kluczePartnerow(tender) {
  const cpv = tender?.cpv_main ?? tender?.cpv;
  const klasa = klasaCpv(cpv);
  const dzial = dzialCpv(cpv);
  const woj = normWojewodztwo(tender?.wojewodztwo);
  return [
    klasa && woj ? { klucz: `cpvk:${klasa}|${woj}`, poziom: 'klasa_region', kod: klasa } : null,
    klasa ? { klucz: `cpvk:${klasa}`, poziom: 'klasa_kraj', kod: klasa } : null,
    dzial && woj ? { klucz: `cpv:${dzial}|${woj}`, poziom: 'dzial_region', kod: dzial } : null,
  ].filter(Boolean);
}

/**
 * Pierwszy poziom z co najmniej `MIN_PARTNEROW` firmami (bez własnego NIP-u).
 * @returns {{dostepne: boolean, powod?: string, zakres?: object, partnerzy: object[]}}
 */
export function wybierzPartnerow({ klucze = [], kubelki = {}, wlasnyNip = null } = {}) {
  if (!klucze.length) return { dostepne: false, powod: 'brak_cpv', partnerzy: [] };
  const wlasny = normNip(wlasnyNip);
  for (const { klucz, poziom, kod } of klucze) {
    const k = kubelki[klucz];
    if (!k?.wystarczajacaProbka) continue;
    const firmy = (k.najczestsiZwyciezcy ?? []).filter((z) => z?.nazwa && !(wlasny && normNip(z.nip) === wlasny));
    if (firmy.length < MIN_PARTNEROW) continue;
    return {
      dostepne: true,
      zakres: {
        poziom,
        kod,
        branza: nazwaKodu(kod.padEnd(8, '0')) ?? `CPV ${kod}`,
        region: poziom !== 'klasa_kraj',
        probka: k.probka ?? null,
      },
      partnerzy: firmy.slice(0, TOP_PARTNEROW).map((z) => ({
        nazwa: z.nazwa,
        nip: normNip(z.nip),
        wygrane: z.wygrane ?? 0,
        ogloszen: z.ogloszen ?? null,
        wartosc: Number.isFinite(z.wartosc) ? z.wartosc : null,
        ostatnio: z.ostatnio ?? null,
      })),
    };
  }
  return { dostepne: false, powod: 'za_malo_danych', partnerzy: [] };
}
