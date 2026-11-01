import { normalizeNip } from './nip.js';

/*
 * INFORMACJA O WYBORZE NAJKORZYSTNIEJSZEJ OFERTY z PDF-a na e-Zamówieniach (2026-11-01). Pismo przychodzi
 * kilka tygodni po terminie ofert i od niego biegnie termin odwołania do KIO, a wykonawca dowiaduje się
 * o nim, dopiero gdy sam zajrzy na platformę. Monitoring dokumentów czyta je raz i mówi w alercie, KOGO
 * wybrano (i czy to Ty — po NIP-ie konta). Zmierzone 1.11.2026 na 19 pismach z tekstem: zdanie „wybrano
 * ofertę Wykonawcy:” i nazwa w kolejnych liniach do adresu, albo w tej samej linii do przecinka z adresem.
 * CZYSTA funkcja na liniach tekstu (`services/tekstPdf.js`).
 */

// Zdanie o wyborze: „…została wybrana oferta Wykonawcy:”, „…jako najkorzystniejszą wybrano Ofertę nr 1 złożoną
// przez Wykonawcę:”, „Nazwa i adres Wykonawcy, którego ofertę wybrano jako najkorzystniejszą:”. Nazwa stoi po
// OSTATNIM „wykonawcy/najkorzystniejszą” w zdaniu (flaga `u`: „ą” to litera).
const WYBOR = /(?<!\p{L})(?:wybran\p{L}*|wybrano|wyboru|uznan\p{L}*|uznano)(?!\p{L})/iu;
const KLUCZ = /(?:wykonawc\p{L}*|najkorzystniejsz\p{L}*)\s*:?/giu;
// „Wybrana oferta spełnia…”, „wybrany Wykonawca spełnia warunki…” — uzasadnienie, nie wskazanie wykonawcy.
const UZASADNIENIE = /uzasadnieni|spe[łl]ni\p{L}*|odpowiada|posiada|uzyska[łl]|nie\s+podlega|art\.\s*\d/iu;
const ADRES = /^(?:ul\.|al\.|os\.|pl\.|\d{2}\s?[-–]\s?\d{3}(?!\d)|nip(?!\p{L})|krs(?!\p{L})|regon(?!\p{L})|adres|siedzib|uzasadnieni|cena(?!\p{L})|informuj|w\s+przedmiotowym|do\s+post|wybran|oferta(?!\p{L})|z\s+siedzib|-\s*siedzib)/iu;
const NIP = /NIP[:\s]*((?:PL)?\s?\d[\d\s-]{8,12}\d)/i;
const SMIECI = /^[-–•]?\s*(?:[a-h]\)\s*)?(?:lider\s+konsorcjum\s*:|nazwa\s+(?:albo\s+imi[ęe]\s+i\s+nazwisko|wykonawcy|firmy)\s*:?|firma\s*:|wykonawca\s*:)\s*/iu;
// „Rzuszcze 33,”, „Gorzyce 277” — miejscowość z numerem domu (adres bez „ul.”).
const MIEJSCOWOSC = /^\p{Lu}\p{Ll}+(?:\s+\p{Lu}?\p{Ll}+)*\s+\d+\p{L}?(?:\/\d+)?\s*,?$/u;
const FORMA = /(?:sp\.\s*z\s*o\.\s*o\.|s\.\s*a\.|sp\.\s*j\.|sp\.\s*k\.|spółka\s+\p{L}+(?:\s+\p{L}+)?)\s*$/iu;

/** PDF rozbija słowa na polskich znakach („GRA Ż YNA”, „SPÓ Ł KA”, „Wykonawc y”, „wpłynęł y”). */
function sklej(linia) {
  return String(linia ?? '')
    // Polskie znaki nie bywają osobnymi słowami, więc „wp ł yn ęł a” = „wpłynęła”.
    .replace(/(\p{L}) ([ĄĆĘŁŃÓŚŹŻąćęłńóśźż]{1,3}) (?=\p{L})/gu, '$1$2')
    .replace(/(\p{L}) ([ĄĆĘŁŃÓŚŹŻąćęłńóśźż]{1,3})(?=[\s,.:]|$)/gu, '$1$2')    .replace(/(Wykonawc|wpłynęł) y(?!\p{L})/gu, '$1y')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nazwa bez adresu: „RR-BUD Sp. z o.o., Markowce 1/26, 38-530 Zarszyn” → „RR-BUD Sp. z o.o.”. */
function nazwaBezAdresu(tekst) {
  const czysty = String(tekst).replace(SMIECI, '').replace(/^[„"]+|[”"]+$/g, '').trim();
  const ciecie = czysty.search(/;\s*(?:ul\.|\d{2}\s?[-–]\s?\d{3})|\s+\p{Lu}\p{Ll}+\s+\d+\p{L}?(?:\/\d+)?\s*,?$|,\s*(?:ul\.|al\.|os\.|\d{2}\s?[-–]\s?\d{3}(?!\d)|NIP|KRS|REGON|\p{Lu}\p{Ll}+\s+\d)|\s\(NIP|,\s*jako\s+ofert/iu);
  const nazwa = (ciecie > 0 ? czysty.slice(0, ciecie) : czysty).replace(/[\s,;:]+$/, '').trim();
  return nazwa.length >= 3 && nazwa.length <= 160 && /\p{L}{2}/u.test(nazwa) ? nazwa : null;
}

/** Część z linii zdania („W Części 2 jako najkorzystniejszą…”, „Pakiet nr 3”). */
const czescZ = (linia) => Number(/cz[ęe][śs]c\p{L}*\s+(?:nr\s*)?(\d{1,2})|pakiet\p{L}*\s+(?:nr\s*)?(\d{1,2})/iu.exec(linia)?.slice(1).find(Boolean)) || null;

/** Nazwa z linii pod zdaniem — do adresu, NIP-u albo formy prawnej, najwyżej trzy linie. */
function nazwaPodZdaniem(l, od) {
  const czlony = [];
  let koniec = od - 1;
  for (let j = od; j < Math.min(l.length, od + 3); j++) {
    const bez = l[j].replace(SMIECI, '');
    if (ADRES.test(bez) || MIEJSCOWOSC.test(bez)) break;
    czlony.push(bez);
    koniec = j;
    if (/,\s*(?:ul\.|\d{2}\s?[-–]\s?\d{3})|NIP/i.test(bez) || FORMA.test(bez)) break;
  }
  return { nazwa: czlony.length ? nazwaBezAdresu(czlony.join(' ')) : null, koniec };
}

/**
 * @param {string[]} linie tekst pisma
 * @returns {{wykonawcy: {czesc: number|null, nazwa: string, nip: string|null}[], oferty: number|null}|null}
 */
export function parsujWyborOferty(linie) {
  const l = (Array.isArray(linie) ? linie : []).map(sklej).filter(Boolean);
  const wykonawcy = [];
  for (let i = 0; i < l.length; i++) {
    if (!WYBOR.test(l[i])) continue;
    // Zdanie złamane na dwie linie: „…została wybrana jako najkorzystniejsza oferta” + „następującego Wykonawcy:”.
    const dalej = /^(?:\p{Ll}+\s+)?wykonawc\p{L}*\s*:\s*$/iu.test(l[i + 1] ?? '');
    const zdanie = dalej && /(?:ofert|z[łl]o[żz]on)\p{L}*\s*$/iu.test(l[i]) ? `${l[i]} ${l[i + 1]}` : l[i];
    const start = zdanie === l[i] ? i : i + 1;
    const ostatni = [...zdanie.matchAll(KLUCZ)].at(-1);
    if (!ostatni) continue;
    // „…dokonał wyboru najkorzystniejszej oferty:” — samo „oferty:” po kluczu, nazwa w liniach niżej.
    const reszta = zdanie.slice(ostatni.index + ostatni[0].length).trim().replace(/^ofert\p{L}*\s*:$/iu, '');
    let nazwa = null;
    let koniec = start;
    if (reszta) {
      if (!/ofert/iu.test(zdanie.slice(0, ostatni.index)) || UZASADNIENIE.test(reszta.slice(0, 40))
        || /^(?:jako|na\s+podstawie|zgodnie|w\s+post|ofert|spe[łl]ni)/iu.test(reszta)) continue;
      nazwa = nazwaBezAdresu(reszta);
    } else {
      if (UZASADNIENIE.test(zdanie)) continue;
      ({ nazwa, koniec } = nazwaPodZdaniem(l, start + 1));
    }
    if (!nazwa) continue;
    const okno = l.slice(start, Math.min(l.length, koniec + 5)).join(' ');
    const nip = NIP.exec(okno.slice(Math.max(0, okno.indexOf(nazwa))))?.[1] ?? null;
    const czesc = czescZ(zdanie);
    i = Math.max(i, koniec);
    if (wykonawcy.some((w) => w.nazwa === nazwa && w.czesc === czesc)) continue;
    wykonawcy.push({ czesc, nazwa, nip: nip ? normalizeNip(nip) : null });
  }
  if (!wykonawcy.length) return null;
  const tekst = l.join(' ');
  const m = /(?:wp[łl]yn[ęe][łl]\p{L}*|z[łl]o[żz]ono|zosta[łl]\p{L}*\s+z[łl]o[żz]on\p{L}*)\s+(\d{1,3}|jedna|dwie|trzy|cztery)\s+ofert/iu.exec(tekst);
  const slowa = { jedna: 1, dwie: 2, trzy: 3, cztery: 4 };
  const oferty = m ? (slowa[m[1].toLowerCase()] ?? Number(m[1])) : null;
  return { wykonawcy: wykonawcy.slice(0, 10), oferty: Number.isFinite(oferty) && oferty > 0 ? oferty : null };
}

/** Czy wśród wybranych jest NIP konta. */
export function wybranoNip(wybor, nipKonta) {
  const nip = normalizeNip(nipKonta);
  return Boolean(nip && wybor?.wykonawcy?.some((w) => w.nip && w.nip === nip));
}

/**
 * Scala odczyt pisma z tym, co już wiemy: najnowsze pismo z wykonawcami wygrywa (korekta wyboru),
 * a nieczytelny skan zostawia sam ślad przeczytania — drugi raz go nie pobieramy.
 */
export function scalWybor(poprzedni, odczyt, dokument) {
  const p = poprzedni && typeof poprzedni === 'object' ? poprzedni : {};
  const ma = Boolean(odczyt?.wykonawcy?.length);
  return {
    wykonawcy: ma ? odczyt.wykonawcy : p.wykonawcy ?? [],
    oferty: ma ? odczyt.oferty ?? null : p.oferty ?? null,
    dokument: ma && dokument ? { id: dokument.id, nazwa: dokument.nazwa ?? null, url: dokument.url ?? null, opublikowano: dokument.opublikowano ?? null } : p.dokument ?? null,
    przeczytane: [...new Set([...(p.przeczytane ?? []), ...(dokument?.id ? [dokument.id] : [])])].slice(-20),
  };
}
