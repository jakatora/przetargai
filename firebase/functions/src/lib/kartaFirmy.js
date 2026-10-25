import { createHash } from 'node:crypto';
import { z } from 'zod';

/*
 * Karta firmy (spec §3) — to, co wiemy o kliencie, żeby wybierać tylko przetargi,
 * na które realnie może startować. Pola profilu sprzed karty (`keywords`, `cpv_codes`,
 * `regiony`, `wartosc_max`) zostają na dokumencie użytkownika (stara apka je edytuje);
 * nowe pola mieszkają w mapie `karta`.
 */
export const MIN_DNI_DOMYSLNIE = 5;

const kwota = z.number().nonnegative().max(1e12).nullable().optional();

/** Ciało `PUT /pracownik/karta`. Każde pole opcjonalne: brak = „nie zmieniam”. */
export const kartaSchema = z.object({
  company_name: z.string().trim().min(2).max(200).optional(),
  opis: z.string().trim().max(600).nullable().optional(),
  keywords: z.array(z.string().min(1).max(60)).max(30).optional(),
  cpv_codes: z.array(z.string().min(1).max(20)).max(30).optional(),
  wykluczenia: z.array(z.string().trim().min(2).max(60)).max(20).optional(),
  regiony: z.array(z.string().min(1).max(40)).max(16).optional(),
  wartosc_min: kwota,
  wartosc_max: z.number().positive().max(1e12).nullable().optional(),
  min_dni_oferta: z.number().int().min(1).max(60).optional(),
  formalne: z.object({
    obrot_roczny: kwota,
    referencja_kwota: kwota,
    referencja_opis: z.string().trim().max(200).nullable().optional(),
    uprawnienia: z.array(z.string().trim().min(2).max(80)).max(20).optional(),
  }).optional(),
});

const liczbaLubNull = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Karta z wartościami domyślnymi — stare konta nie mają pola `karta`. */
export function kartaZUzytkownika(user) {
  const k = user?.karta ?? {};
  const f = k.formalne ?? {};
  return {
    opis: typeof k.opis === 'string' && k.opis.trim() ? k.opis : null,
    wykluczenia: Array.isArray(k.wykluczenia) ? k.wykluczenia : [],
    wartosc_min: liczbaLubNull(k.wartosc_min),
    min_dni_oferta: Number.isInteger(k.min_dni_oferta) ? k.min_dni_oferta : MIN_DNI_DOMYSLNIE,
    formalne: {
      obrot_roczny: liczbaLubNull(f.obrot_roczny),
      referencja_kwota: liczbaLubNull(f.referencja_kwota),
      referencja_opis: typeof f.referencja_opis === 'string' && f.referencja_opis.trim() ? f.referencja_opis : null,
      uprawnienia: Array.isArray(f.uprawnienia) ? f.uprawnienia : [],
    },
  };
}

const posortowane = (lista) => [...(lista ?? [])].map(String).sort();
const skrot = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 12);

/**
 * Wersja karty — zastępuje dawny `criteriaHash` (słowa + CPV). Zmiana którejkolwiek
 * twardej reguły albo opisu (czyta go AI) unieważnia stare decyzje (spec §3.2).
 */
export function wersjaKarty(user) {
  const k = kartaZUzytkownika(user);
  return skrot({
    keywords: posortowane(user?.keywords),
    cpv: posortowane(user?.cpv_codes),
    opis: k.opis,
    wykluczenia: posortowane(k.wykluczenia),
    regiony: posortowane(user?.regiony),
    od: k.wartosc_min,
    do: liczbaLubNull(user?.wartosc_max),
    dni: k.min_dni_oferta,
  });
}

export function formalnePuste(user) {
  const f = kartaZUzytkownika(user).formalne;
  return f.obrot_roczny === null && f.referencja_kwota === null && !f.referencja_opis && !f.uprawnienia.length;
}

/** Wersja części formalnej — klucz pamięci porównań warunków (spec §6.2). */
export function wersjaFormalnych(user) {
  if (formalnePuste(user)) return null;
  const f = kartaZUzytkownika(user).formalne;
  return skrot({ ...f, uprawnienia: posortowane(f.uprawnienia) });
}

/** Czego brakuje w karcie — od tego, co najbardziej poprawia wybór. */
export function brakiKarty(user) {
  const k = kartaZUzytkownika(user);
  const braki = [];
  if (!user?.keywords?.length && !user?.cpv_codes?.length) braki.push('zakres');
  if (!k.opis) braki.push('opis');
  if (!k.wykluczenia.length) braki.push('wykluczenia');
  if (!user?.regiony?.length) braki.push('teren');
  if (k.wartosc_min === null && liczbaLubNull(user?.wartosc_max) === null) braki.push('skala');
  if (formalnePuste(user)) braki.push('formalne');
  return braki;
}

/** Karta w kształcie API (profil + karta). */
export function publicKarta(user) {
  return {
    company_name: user?.company_name ?? null,
    keywords: user?.keywords ?? [],
    cpv_codes: user?.cpv_codes ?? [],
    regiony: user?.regiony ?? [],
    wartosc_max: liczbaLubNull(user?.wartosc_max),
    ...kartaZUzytkownika(user),
  };
}
