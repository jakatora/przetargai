/**
 * Kreator „Karta firmy” (spec §3.3) — czyste reguły formularza ⇄ API `PUT /pracownik/karta`.
 * Limity zgodne z `kartaSchema` w firebase/functions/src/lib/kartaFirmy.js.
 */
export const KROKI_KREATORA = [
  { nr: 1, klucz: 'zakres', tytul: { pl: 'Czym się zajmujesz?', en: 'What does your company do?' },
    opis: { pl: 'Opisz własnymi słowami, jakie roboty, usługi albo dostawy wykonujesz. Podpowiemy słowa kluczowe i kody CPV.', en: 'Describe in your own words the works, services or supplies you deliver. We will suggest keywords and CPV codes.' } },
  { nr: 2, klucz: 'wykluczenia', tytul: { pl: 'Czego nie bierzesz?', en: 'What do you not take on?' },
    opis: { pl: 'Słowa, przy których od razu odrzucamy przetarg, np. „drogi”, „odśnieżanie”.', en: 'Words that make us reject a tender right away, e.g. “roads”, “snow removal”.' } },
  { nr: 3, klucz: 'teren', tytul: { pl: 'Gdzie pracujesz?', en: 'Where do you work?' },
    opis: { pl: 'Zaznacz województwa. Bez zaznaczenia szukamy w całej Polsce.', en: 'Pick the voivodeships. With none selected we search all of Poland.' } },
  { nr: 4, klucz: 'skala', tytul: { pl: 'Jakie kwoty i ile czasu na ofertę?', en: 'Contract size and time to bid' },
    opis: { pl: 'Najmniejsza i największa wartość zamówienia oraz liczba dni, której potrzebujesz na przygotowanie oferty.', en: 'Smallest and largest contract value and how many days you need to prepare a bid.' } },
  { nr: 5, klucz: 'formalne', tytul: { pl: 'Obrót, referencje, uprawnienia', en: 'Turnover, references, licences' },
    opis: { pl: 'Opcjonalnie. W planie Standard porównamy to z warunkami udziału z ogłoszenia.', en: 'Optional. On the Standard plan we compare this with the participation conditions in the notice.' } },
];

export const OPISY_BRAKOW = {
  zakres: { tytul: { pl: 'Dodaj słowa kluczowe albo kody CPV', en: 'Add keywords or CPV codes' }, krok: 1 },
  opis: { tytul: { pl: 'Opisz, czym się zajmujesz — lepiej rozumiemy zakres', en: 'Describe what you do — we understand your scope better' }, krok: 1 },
  wykluczenia: { tytul: { pl: 'Dopisz, czego nie bierzesz — odsiejemy więcej', en: 'Add what you do not take on — we will filter out more' }, krok: 2 },
  teren: { tytul: { pl: 'Zaznacz województwa, w których pracujesz', en: 'Pick the voivodeships you work in' }, krok: 3 },
  skala: { tytul: { pl: 'Podaj kwoty zamówień, które bierzesz', en: 'Enter the contract sizes you take on' }, krok: 4 },
  formalne: { tytul: { pl: 'Podaj obrót i referencje — sprawdzimy warunki udziału', en: 'Enter turnover and references — we will check participation conditions' }, krok: 5 },
};

export function parsujListe(tekst, maks = 30) {
  const widziane = new Set();
  return String(tekst ?? '').split(/[,\n]/).map((x) => x.trim()).filter((x) => {
    const klucz = x.toLocaleLowerCase('pl');
    if (!klucz || widziane.has(klucz)) return false;
    widziane.add(klucz);
    return true;
  }).slice(0, maks);
}

export function parsujKwote(tekst) {
  const czesc = String(tekst ?? '').split(/[.,]/)[0].replace(/[^\d]/g, '');
  return czesc ? Number(czesc) : null;
}

const naTekst = (x) => (x === null || x === undefined ? '' : String(x));

export function kartaDoFormularza(karta) {
  const k = karta ?? {};
  const f = k.formalne ?? {};
  return {
    company_name: naTekst(k.company_name),
    opis: naTekst(k.opis),
    keywords: (k.keywords ?? []).join(', '),
    cpv_codes: (k.cpv_codes ?? []).join(', '),
    wykluczenia: (k.wykluczenia ?? []).join(', '),
    regiony: [...(k.regiony ?? [])],
    wartosc_min: naTekst(k.wartosc_min),
    wartosc_max: naTekst(k.wartosc_max),
    min_dni_oferta: naTekst(k.min_dni_oferta ?? 5),
    obrot_roczny: naTekst(f.obrot_roczny),
    referencja_kwota: naTekst(f.referencja_kwota),
    referencja_opis: naTekst(f.referencja_opis),
    uprawnienia: (f.uprawnienia ?? []).join(', '),
  };
}

export function formularzDoKarty(form) {
  const nazwa = String(form.company_name ?? '').trim();
  return {
    ...(nazwa.length >= 2 ? { company_name: nazwa } : {}),
    opis: String(form.opis ?? '').trim() || null,
    keywords: parsujListe(form.keywords),
    cpv_codes: parsujListe(form.cpv_codes),
    wykluczenia: parsujListe(form.wykluczenia, 20),
    regiony: [...(form.regiony ?? [])],
    wartosc_min: parsujKwote(form.wartosc_min),
    wartosc_max: parsujKwote(form.wartosc_max) || null,
    min_dni_oferta: Number.parseInt(form.min_dni_oferta, 10) || 5,
    formalne: {
      obrot_roczny: parsujKwote(form.obrot_roczny),
      referencja_kwota: parsujKwote(form.referencja_kwota),
      referencja_opis: String(form.referencja_opis ?? '').trim() || null,
      uprawnienia: parsujListe(form.uprawnienia, 20),
    },
  };
}

export function walidujFormularz(form) {
  const od = parsujKwote(form.wartosc_min);
  const doK = parsujKwote(form.wartosc_max);
  if (od !== null && doK !== null && od > doK) {
    return { pl: 'Wartość „od” nie może być większa niż „do”.', en: 'The “from” value cannot exceed the “to” value.' };
  }
  const dni = Number.parseInt(form.min_dni_oferta, 10);
  if (String(form.min_dni_oferta ?? '').trim() && !(dni >= 1 && dni <= 60)) {
    return { pl: 'Liczba dni na ofertę musi być od 1 do 60.', en: 'Days to bid must be between 1 and 60.' };
  }
  if (String(form.opis ?? '').length > 600) {
    return { pl: 'Opis może mieć najwyżej 600 znaków.', en: 'The description can have at most 600 characters.' };
  }
  return null;
}
