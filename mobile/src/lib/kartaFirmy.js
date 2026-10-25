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

/**
 * Kwota z pola tekstowego: spacje (też twarde), „zł”, „mln”/„tys.”. Separator, po którym stoją
 * dokładnie 3 cyfry, grupuje tysiące („2.000.000”); końcowy z 1–2 cyframi to ułamek (ucinany).
 */
export function parsujKwote(tekst) {
  const surowy = String(tekst ?? '').toLocaleLowerCase('pl');
  const mnoznik = surowy.includes('mln') ? 1_000_000 : surowy.includes('tys') ? 1_000 : 1;
  const liczba = surowy.replace(/[^\d.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
  if (!/\d/.test(liczba)) return null;
  const ulamek = liczba.match(/[.,](\d{1,2})$/);
  const calosc = (ulamek ? liczba.slice(0, ulamek.index) : liczba).replace(/[.,]/g, '');
  const setne = ulamek ? Number(ulamek[1].padEnd(2, '0')) : 0;
  // Liczenie w setnych: 4,35 mln = 435 × 10 000, bez błędu zmiennoprzecinkowego.
  return Math.floor(((Number(calosc || '0') * 100 + setne) * mnoznik) / 100);
}

/** Pola-listy i ich limity — te same co w `kartaSchema` na serwerze. */
const LIMITY_LIST = [
  { pole: 'keywords', nazwa: { pl: 'Słowa kluczowe', en: 'Keywords' }, min: 1, max: 60, ile: 30 },
  { pole: 'cpv_codes', nazwa: { pl: 'Kody CPV', en: 'CPV codes' }, min: 1, max: 20, ile: 30 },
  { pole: 'wykluczenia', nazwa: { pl: 'Czego nie bierzesz', en: 'What you do not take on' }, min: 2, max: 60, ile: 20 },
  { pole: 'uprawnienia', nazwa: { pl: 'Uprawnienia i certyfikaty', en: 'Licences and certificates' }, min: 2, max: 80, ile: 20 },
];

const skroc = (x) => (x.length > 24 ? `${x.slice(0, 24)}…` : x);

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
  for (const l of LIMITY_LIST) {
    const zla = parsujListe(form[l.pole], l.ile).find((x) => x.length < l.min || x.length > l.max);
    if (zla) {
      return {
        pl: `${l.nazwa.pl}: „${skroc(zla)}” — każda pozycja ma mieć od ${l.min} do ${l.max} znaków.`,
        en: `${l.nazwa.en}: “${skroc(zla)}” — each item must have ${l.min} to ${l.max} characters.`,
      };
    }
  }
  return null;
}
