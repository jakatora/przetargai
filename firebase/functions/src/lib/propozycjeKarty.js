import { createHash } from 'node:crypto';
import { normalize, stem } from './textNorm.js';
import { kodWojewodztwa, WOJEWODZTWA } from './wojewodztwa.js';
import { kartaZUzytkownika, formalnePuste } from './kartaFirmy.js';

/*
 * Propozycje zmian karty z odrzuceń klienta (spec §5.3) — bez AI. Twardych reguł nie
 * zmieniamy sami: proponujemy, klient przyjmuje albo odkłada („nie teraz” = 30 dni).
 */
export const PROG_POWTORZEN = 3;
export const OKNO_DNI = 30;
export const ODLOZENIE_DNI = 30;
const DOBA_MS = 86_400_000;
const MAKS_WYKLUCZEN = 20;

/** Rdzenie słów ogólnych w tytułach zamówień — nigdy nie proponujemy ich jako wykluczenia. */
const OGOLNE = ['dostaw', 'uslug', 'wykona', 'realiza', 'zamowi', 'swiadcz', 'zakup', 'postepow', 'robot',
  'przetarg', 'gmin', 'powiat', 'miast', 'zadani', 'czesc', 'ramach', 'obiekt', 'budynk', 'teren', 'remont',
  'budow', 'przebudow', 'moderniz', 'naprawa', 'napraw'];

const rdzenie = (tekst) => normalize(tekst).split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map(stem);
const ogolny = (r) => OGOLNE.some((o) => r.startsWith(o));
const zl = (k) => `${Math.round(k).toLocaleString('pl-PL')} zł`;
const pln = (k) => `PLN ${Math.round(k).toLocaleString('en-GB')}`;

function kluczPropozycji(pole, wartosc) {
  return createHash('sha256').update(`${pole}:${JSON.stringify(wartosc)}`).digest('hex').slice(0, 12);
}

/** Do 2 cyfr znaczących: 1 534 000 → 1 500 000 (w dół) / 48 300 → 49 000 (w górę). */
function zaokraglij(kwota, kierunek) {
  const rzad = 10 ** Math.max(0, Math.floor(Math.log10(kwota)) - 1);
  return (kierunek === 'dol' ? Math.floor(kwota / rzad) : Math.ceil(kwota / rzad)) * rzad;
}

/** Pierwsze słowo tytułu (w oryginalnej pisowni, małymi literami) o danym rdzeniu. */
function slowoZTytulu(tytul, rdzen) {
  for (const surowe of String(tytul).split(/[\s,.;:()"„”'/-]+/)) {
    if (surowe && stem(normalize(surowe)) === rdzen) return surowe.toLocaleLowerCase('pl');
  }
  return rdzen;
}

export function propozycjeKarty(user, teraz) {
  const od = Date.parse(teraz) - OKNO_DNI * DOBA_MS;
  const sygnaly = (user?.pracownik_sygnaly ?? []).filter((s) => Date.parse(s.o) >= od);
  const odrzucenia = (przyczyna) => sygnaly.filter((s) => s.typ === 'odrzucenie' && s.przyczyna === przyczyna);
  const zapisane = sygnaly.filter((s) => s.typ === 'zapis' || s.typ === 'przywrocenie');
  const karta = kartaZUzytkownika(user);
  const wynik = [];
  const dodaj = (p) => wynik.push({ ...p, klucz: kluczPropozycji(p.pole, p.nowa_wartosc) });

  const branza = odrzucenia('branza');
  if (branza.length >= PROG_POWTORZEN && karta.wykluczenia.length < MAKS_WYKLUCZEN) {
    const zakazane = new Set([
      ...zapisane.flatMap((s) => rdzenie(s.tytul)),
      ...(user?.keywords ?? []).flatMap(rdzenie),
      ...karta.wykluczenia.flatMap(rdzenie),
    ]);
    const ile = new Map();
    for (const s of branza) {
      for (const r of new Set(rdzenie(s.tytul))) {
        if (!zakazane.has(r) && !ogolny(r)) ile.set(r, (ile.get(r) ?? 0) + 1);
      }
    }
    const [najczestszy] = [...ile.entries()]
      .filter(([, n]) => n >= PROG_POWTORZEN)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (najczestszy) {
      const [rdzen] = najczestszy;
      const dowody = branza.filter((s) => rdzenie(s.tytul).includes(rdzen)).map((s) => s.tytul);
      const slowo = slowoZTytulu(dowody[0], rdzen);
      dodaj({ pole: 'wykluczenia', nowa_wartosc: slowo, akcja: 'zmien', dowody: dowody.slice(0, 3), opis: {
        pl: `Odrzuciłeś ${dowody.length} przetargi ze słowem „${slowo}” jako nie Twoja branża. Dopisać je do listy „nie bierzemy”?`,
        en: `You rejected ${dowody.length} tenders with “${slowo}” as not your trade. Add it to your “we don’t do” list?`,
      } });
    }
  }

  const teren = odrzucenia('teren');
  if (teren.length >= PROG_POWTORZEN) {
    const dowody = teren.map((s) => s.tytul).slice(0, 3);
    const zapisaneWoj = [...new Set(zapisane.map((s) => kodWojewodztwa(s.wojewodztwo)).filter(Boolean))].sort();
    const obecne = [...new Set((user?.regiony ?? []).map(kodWojewodztwa).filter(Boolean))].sort();
    if (zapisaneWoj.length >= 2 && JSON.stringify(zapisaneWoj) !== JSON.stringify(obecne)) {
      const nazwy = zapisaneWoj.map((k) => WOJEWODZTWA[k]).join(', ');
      dodaj({ pole: 'regiony', nowa_wartosc: zapisaneWoj, akcja: 'zmien', dowody, opis: {
        pl: `Odrzuciłeś ${teren.length} przetargi spoza terenu. Ograniczyć teren do województw, z których zapisujesz przetargi: ${nazwy}?`,
        en: `You rejected ${teren.length} tenders as outside your area. Limit your area to the voivodeships you save tenders from: ${nazwy}?`,
      } });
    } else if (!obecne.length) {
      dodaj({ pole: 'regiony', nowa_wartosc: null, akcja: 'otworz_kreator', krok: 3, dowody, opis: {
        pl: `Odrzuciłeś ${teren.length} przetargi spoza terenu. Zaznacz województwa, w których pracujesz — odsiejemy resztę za Ciebie.`,
        en: `You rejected ${teren.length} tenders as outside your area. Pick the voivodeships you work in and we will filter the rest.`,
      } });
    }
  }

  const duze = odrzucenia('za_duze').filter((s) => typeof s.wartosc === 'number' && s.wartosc > 0);
  if (duze.length >= PROG_POWTORZEN) {
    const najmniejsza = Math.min(...duze.map((s) => s.wartosc));
    const nowa = zaokraglij(najmniejsza, 'dol');
    const obecna = typeof user?.wartosc_max === 'number' ? user.wartosc_max : null;
    if (obecna === null || nowa < obecna) {
      dodaj({ pole: 'wartosc_max', nowa_wartosc: nowa, akcja: 'zmien', dowody: duze.map((s) => s.tytul).slice(0, 3), opis: {
        pl: `Odrzuciłeś ${duze.length} przetargi jako za duże (od ${zl(najmniejsza)}). Ustawić największą wartość na ${zl(nowa)}?`,
        en: `You rejected ${duze.length} tenders as too large (from ${pln(najmniejsza)}). Set your maximum to ${pln(nowa)}?`,
      } });
    }
  }

  const male = odrzucenia('za_male').filter((s) => typeof s.wartosc === 'number' && s.wartosc > 0);
  if (male.length >= PROG_POWTORZEN) {
    const najwieksza = Math.max(...male.map((s) => s.wartosc));
    const nowa = zaokraglij(najwieksza, 'gora');
    if (karta.wartosc_min === null || nowa > karta.wartosc_min) {
      dodaj({ pole: 'wartosc_min', nowa_wartosc: nowa, akcja: 'zmien', dowody: male.map((s) => s.tytul).slice(0, 3), opis: {
        pl: `Odrzuciłeś ${male.length} przetargi jako za małe (do ${zl(najwieksza)}). Ustawić najmniejszą wartość na ${zl(nowa)}?`,
        en: `You rejected ${male.length} tenders as too small (up to ${pln(najwieksza)}). Set your minimum to ${pln(nowa)}?`,
      } });
    }
  }

  const terminy = odrzucenia('termin').filter((s) => Number.isInteger(s.dni_do_terminu));
  if (terminy.length >= PROG_POWTORZEN) {
    const nowa = Math.min(60, Math.max(...terminy.map((s) => s.dni_do_terminu)) + 1);
    if (nowa > karta.min_dni_oferta) {
      dodaj({ pole: 'min_dni_oferta', nowa_wartosc: nowa, akcja: 'zmien', dowody: terminy.map((s) => s.tytul).slice(0, 3), opis: {
        pl: `Odrzuciłeś ${terminy.length} przetargi, bo było za mało czasu. Pomijać przetargi, do których terminu zostało mniej niż ${nowa} dni?`,
        en: `You rejected ${terminy.length} tenders for lack of time. Skip tenders with fewer than ${nowa} days left?`,
      } });
    }
  }

  if (odrzucenia('warunki').length >= PROG_POWTORZEN && formalnePuste(user)) {
    dodaj({ pole: 'formalne', nowa_wartosc: null, akcja: 'otworz_kreator', krok: 5,
      dowody: odrzucenia('warunki').map((s) => s.tytul).slice(0, 3), opis: {
        pl: 'Kilka razy odrzuciłeś przetargi przez warunki udziału. Podaj obrót, największą referencję i uprawnienia — sprawdzimy je za Ciebie.',
        en: 'You rejected several tenders over participation conditions. Enter your turnover, largest reference and licences — we will check them for you.',
      } });
  }

  const odlozone = new Map((user?.pracownik_odlozone ?? []).map((o) => [o.klucz, o.do]));
  return wynik.filter((p) => !(odlozone.has(p.klucz) && odlozone.get(p.klucz) > teraz));
}

/** Argumenty `users.zapiszKarte` po przyjęciu propozycji. */
export function zastosujPropozycje(user, propozycja) {
  const k = kartaZUzytkownika(user);
  const zapis = {
    companyName: user?.company_name ?? null,
    keywords: user?.keywords ?? [],
    cpvCodes: user?.cpv_codes ?? [],
    regiony: user?.regiony ?? [],
    wartoscMax: typeof user?.wartosc_max === 'number' ? user.wartosc_max : null,
    karta: { opis: k.opis, wykluczenia: [...k.wykluczenia], wartosc_min: k.wartosc_min, min_dni_oferta: k.min_dni_oferta, formalne: k.formalne },
  };
  switch (propozycja.pole) {
    case 'wykluczenia': zapis.karta.wykluczenia = [...k.wykluczenia, propozycja.nowa_wartosc].slice(0, MAKS_WYKLUCZEN); break;
    case 'regiony': zapis.regiony = propozycja.nowa_wartosc; break;
    case 'wartosc_max': zapis.wartoscMax = propozycja.nowa_wartosc; break;
    case 'wartosc_min': zapis.karta.wartosc_min = propozycja.nowa_wartosc; break;
    case 'min_dni_oferta': zapis.karta.min_dni_oferta = propozycja.nowa_wartosc; break;
    default: throw new Error(`Propozycji „${propozycja.pole}” nie stosuje się automatycznie`);
  }
  return zapis;
}
