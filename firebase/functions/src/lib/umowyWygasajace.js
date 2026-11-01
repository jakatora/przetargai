import { dzialCpv, normWojewodztwo } from './wynikiAgregacja.js';
import { normNip } from './profilKonkurenta.js';
import { WOJEWODZTWA } from './wojewodztwa.js';
import { poprzedniaEdycja } from './poprzedniaEdycja.js';

/*
 * RADAR WYGASAJĄCYCH UMÓW (2026-10-31, z analizy konkurencji: przetargi.info „umowy wygasające”).
 *
 * Zamawiający, któremu za trzy miesiące kończy się roczna umowa na sprzątanie, ochronę, paliwo
 * albo odbiór odpadów, za chwilę ogłosi ten sam przetarg. Kto wie o tym wcześniej, ma czas na
 * kalkulację, referencje i rozmowę z podwykonawcą. Ogłoszenie o wyniku w BZP podaje datę zawarcia
 * umowy (8.1), wartość (8.2) i okres realizacji (8.3) — `lib/wynikiParser.js` liczy z tego
 * `koniecUmowy` każdej części (98% rozstrzygniętych części w próbce z 28–29.10.2026).
 *
 * Centralny Rejestr Umów (MF) ma tylko umowy od 1.07.2026 i nie ma publicznego API odczytu —
 * dlatego budujemy to z wyników BZP, które już mamy z całego roku.
 *
 * CZYSTA logika: zegar parametrem, bez I/O.
 */

/** Jak daleko w przód patrzymy (dni). 7 miesięcy = typowe przygotowanie do przetargu rocznego. */
export const HORYZONT_DNI = 210;
/** Umowa krótsza niż ~pół roku to zwykle jednorazowy zakup, który się nie powtórzy. */
export const MIN_DLUGOSC_DNI = 180;
/** Ile umów trzymamy w jednym kubełku (najbliżej końca pierwsze). */
export const MAKS_W_KUBELKU = 80;

/*
 * Roboty budowlane zwykle się nie powtarzają (szkoła remontowana raz), chyba że to utrzymanie:
 * bieżące utrzymanie dróg, akcja zima, konserwacja oświetlenia, przeglądy.
 */
const ROBOTY_CYKLICZNE = /utrzymani|konserwacj|bieżąc|zimow|odśnieżan|serwis|przegląd|eksploatacj|całoroczn/i;

const DZIEN_MS = 86_400_000;
const dzienIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const msDnia = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? '')) ? Date.parse(`${iso}T00:00:00.000Z`) : NaN);

/** Najpóźniejszy koniec umowy wśród nieunieważnionych części — albo null. */
export function koniecUmowyWyniku(wynik) {
  const konce = (wynik?.czesci ?? [])
    .filter((c) => c && !c.uniewaznione && Number.isFinite(msDnia(c.koniecUmowy)))
    .map((c) => c.koniecUmowy);
  return konce.length ? konce.sort().at(-1) : null;
}

/**
 * Czy umowa wróci jako przetarg: trwa co najmniej MIN_DLUGOSC_DNI i nie jest jednorazową robotą
 * budowlaną. Bez daty zawarcia długości nie znamy — wtedy decyduje sam rodzaj.
 */
export function czyCykliczna({ rodzaj, tytul, dataUmowy, koniec }) {
  if (rodzaj === 'Works' && !ROBOTY_CYKLICZNE.test(String(tytul ?? ''))) return false;
  const od = msDnia(String(dataUmowy ?? '').slice(0, 10));
  const doDnia = msDnia(koniec);
  if (!Number.isFinite(doDnia)) return false;
  if (!Number.isFinite(od)) return rodzaj !== 'Works';
  return (doDnia - od) / DZIEN_MS >= MIN_DLUGOSC_DNI;
}

/** Klucz kubełka: dział CPV × województwo (TERYT) albo sam dział (cały kraj). */
export const kluczUmow = (dzial, woj = null) => (woj ? `${dzial}|${woj}` : `${dzial}`);

/**
 * Jedna pozycja radaru z rozstrzygnięcia (umowa jako całość: koniec = najpóźniejsza część).
 * @returns {object|null} null, gdy nie ma końca w oknie albo umowa nie jest cykliczna
 */
export function pozycjaUmowy(wynik, { odDnia, doDnia }) {
  const koniec = koniecUmowyWyniku(wynik);
  if (!koniec || koniec < odDnia || koniec > doDnia) return null;
  const czesci = (wynik.czesci ?? []).filter((c) => c && !c.uniewaznione && c.koniecUmowy);
  const ostatnia = czesci.find((c) => c.koniecUmowy === koniec) ?? czesci[0];
  if (!czyCykliczna({ rodzaj: wynik.rodzaj, tytul: wynik.tytul, dataUmowy: ostatnia?.dataUmowy, koniec })) return null;
  const zwyciezcy = [];
  const widziane = new Set();
  for (const c of czesci) {
    const nazwa = c.zwyciezca?.nazwa ?? null;
    const nip = normNip(c.zwyciezca?.nip);
    const klucz = nip ?? nazwa;
    if (!klucz || widziane.has(klucz)) continue;
    widziane.add(klucz);
    if (zwyciezcy.length < 3) zwyciezcy.push({ nazwa, nip });
  }
  const wartosci = czesci.map((c) => c.wartoscUmowy).filter((v) => Number.isFinite(v) && v > 0);
  return {
    id: wynik.externalId ?? null,
    tytul: wynik.tytul ?? null,
    zamawiajacy: wynik.zamawiajacy ?? null,
    zamawiajacy_nip: wynik.zamawiajacyNip ?? wynik.zamawiajacy_nip ?? null,
    miasto: wynik.miasto ?? null,
    wojewodztwo: normWojewodztwo(wynik.wojewodztwo),
    cpv: Array.isArray(wynik.cpv) ? wynik.cpv[0] ?? null : null,
    rodzaj: wynik.rodzaj ?? null,
    koniec,
    data_umowy: ostatnia?.dataUmowy ? String(ostatnia.dataUmowy).slice(0, 10) : null,
    okres: ostatnia?.okresUmowy ?? null,
    wartosc: wartosci.length ? Math.round(wartosci.reduce((s, v) => s + v, 0)) : null,
    zwyciezcy,
    liczba_wykonawcow: widziane.size,
    postepowanie_id: wynik.tenderId ?? wynik.postepowanie_id ?? null,
  };
}

/*
 * NASTĘPCA UMOWY (2026-11-01). Część kończących się umów ma już nowy przetarg w toku — zamawiający
 * ogłosił go przed końcem starej umowy. Wtedy radar nie mówi „przygotuj się”, tylko „składaj ofertę,
 * termin taki i taki” i prowadzi prosto do ogłoszenia, bez szukania go w katalogu.
 *
 * Kierunek dopasowania jest ten, w którym mierzono progi `lib/poprzedniaEdycja.js`: dla KAŻDEGO
 * otwartego przetargu szukamy jego poprzedniej edycji wśród rozstrzygnięć tego samego zamawiającego
 * (po NIP-ie). Ta sama umowa wybrana przez kilka przetargów — wygrywa najpodobniejszy tytuł, potem
 * najbliższy termin składania.
 *
 * Próbka z produkcji (1.11.2026, 797 par z 8479 otwartych przetargów): 30 losowych par — wszystkie
 * to ten sam zakup; błędy tylko przy podobieństwie < 0,45 i u brokerów ubezpieczeniowych, którzy
 * pod JEDNYM NIP-em prowadzą przetargi wielu gmin („Gmina Jawor” → „Gmina Sławatycze”). Brokerowi
 * wierzymy więc tylko przy prawie tym samym tytule, a słabsze dopasowanie to „podobny przetarg”.
 */

/** Pośrednik zamawiający w imieniu wielu jednostek (broker ubezpieczeniowy). */
const POSREDNIK = /broker|\bEIB\b/i;
const MIN_PODOB_POSREDNIKA = 0.8;
/** Od tylu podobieństwa tytułów mówimy „nowa edycja”, poniżej — „podobny przetarg”. */
export const PROG_PEWNEGO_NASTEPCY = 0.6;

/**
 * @param {object[]} wyniki rozstrzygnięcia z końcem umowy w oknie radaru
 * @param {object[]} otwarte otwarte przetargi z NIP-em zamawiającego (id, title, cpv_main, deadline…)
 * @returns {Map<string, object>} externalId rozstrzygnięcia → skrót nowego przetargu
 */
export function nastepcyUmow(wyniki, otwarte, { teraz = Date.now() } = {}) {
  const poNipie = new Map();
  for (const w of Array.isArray(wyniki) ? wyniki : []) {
    const nip = normNip(w?.zamawiajacyNip ?? w?.zamawiajacy_nip);
    if (!nip || !w.externalId) continue;
    if (!poNipie.has(nip)) poNipie.set(nip, []);
    poNipie.get(nip).push(w);
  }
  const terazIso = new Date(teraz).toISOString();
  const nastepcy = new Map();
  for (const t of Array.isArray(otwarte) ? otwarte : []) {
    const grupa = poNipie.get(normNip(t?.zamawiajacy_nip));
    if (!grupa || !t.id || t.anulowany === true || t.zastapiony_przez) continue;
    if (!t.deadline || String(t.deadline) <= terazIso) continue;
    const edycja = poprzedniaEdycja(t, grupa, { teraz });
    if (!edycja?.id) continue;
    const posrednik = POSREDNIK.test(String(t.organization ?? '')) || grupa.some((w) => w.externalId === edycja.id && POSREDNIK.test(String(w.zamawiajacy ?? '')));
    if (posrednik && edycja.podobienstwo < MIN_PODOB_POSREDNIKA) continue;
    const kandydat = {
      tender_id: t.id,
      tytul: t.title ?? null,
      deadline: t.deadline,
      opublikowano: t.published_at ?? null,
      url: t.url ?? null,
      zrodlo: t.source ?? null,
      podobienstwo: edycja.podobienstwo,
      pewny: edycja.podobienstwo >= PROG_PEWNEGO_NASTEPCY,
    };
    const byl = nastepcy.get(edycja.id);
    if (byl && (byl.podobienstwo > kandydat.podobienstwo
      || (byl.podobienstwo === kandydat.podobienstwo && byl.deadline <= kandydat.deadline))) continue;
    nastepcy.set(edycja.id, kandydat);
  }
  return nastepcy;
}

/** Umowy z ogłoszonym następcą pierwsze (najbliższy termin oferty), potem najbliżej końca umowy. */
function kolejnoscUmow(a, b) {
  if (Boolean(a.nastepca) !== Boolean(b.nastepca)) return a.nastepca ? -1 : 1;
  if (a.nastepca && b.nastepca) return String(a.nastepca.deadline).localeCompare(String(b.nastepca.deadline));
  return a.koniec.localeCompare(b.koniec) || (b.wartosc ?? 0) - (a.wartosc ?? 0);
}

/**
 * Kubełki radaru z rozstrzygnięć, których umowa kończy się w [dzisiaj, dzisiaj + HORYZONT_DNI].
 * Każda umowa trafia do kubełków WSZYSTKICH swoich działów CPV (do 3) — w regionie i w kraju.
 * `nastepcy` (z `nastepcyUmow`) dopisuje do pozycji już ogłoszony nowy przetarg.
 * @returns {Record<string, {klucz: string, dzial: string, wojewodztwo: string|null, umowy: object[]}>}
 */
export function zbudujKubelkiUmow(wyniki, { teraz = Date.now(), horyzontDni = HORYZONT_DNI, maks = MAKS_W_KUBELKU, nastepcy = null } = {}) {
  const odDnia = dzienIso(teraz);
  const doDnia = dzienIso(teraz + horyzontDni * DZIEN_MS);
  const kubelki = {};
  const dodaj = (klucz, dzial, woj, poz) => {
    const k = (kubelki[klucz] ??= { klucz, dzial, wojewodztwo: woj, umowy: [] });
    k.umowy.push(poz);
  };
  for (const w of Array.isArray(wyniki) ? wyniki : []) {
    const poz = pozycjaUmowy(w, { odDnia, doDnia });
    if (!poz) continue;
    poz.nastepca = (poz.id && nastepcy?.get(poz.id)) || null;
    const dzialy = [...new Set((Array.isArray(w.cpv) ? w.cpv : [w.cpv]).map((k) => dzialCpv(k)).filter(Boolean))].slice(0, 3);
    for (const d of dzialy) {
      dodaj(kluczUmow(d), d, null, poz);
      if (poz.wojewodztwo) dodaj(kluczUmow(d, poz.wojewodztwo), d, poz.wojewodztwo, poz);
    }
  }
  for (const k of Object.values(kubelki)) {
    k.liczba = k.umowy.length;
    k.umowy = k.umowy.sort(kolejnoscUmow).slice(0, maks);
    k.od = odDnia;
    k.do = doDnia;
  }
  return kubelki;
}

/** Klucze kubełków dla firmy: działy z karty × regiony (bez regionów — cały kraj). */
export function kluczeUmowUzytkownika(user) {
  const dzialy = [...new Set((user?.cpv_codes ?? []).map((k) => dzialCpv(k)).filter(Boolean))].slice(0, 6);
  const regiony = [...new Set((user?.regiony ?? []).map(normWojewodztwo).filter(Boolean))].slice(0, 4);
  const klucze = regiony.length ? dzialy.flatMap((d) => regiony.map((w) => kluczUmow(d, w))) : dzialy.map((d) => kluczUmow(d));
  return { dzialy, regiony, klucze };
}

/**
 * Lista dla firmy: scalone kubełki, bez powtórzeń, bez umów już zakończonych i bez własnych
 * (firma, która tę umowę wykonuje, wie, kiedy się kończy). Najpierw umowy, których nowy przetarg
 * już trwa (termin ofert minął od przeliczenia — link znika), potem najbliżej końca.
 */
export function wybierzUmowy({ kubelki, teraz = Date.now(), wlasnyNip = null, limit = 40, minGodzinDoOferty = 0 }) {
  const dzisiaj = dzienIso(teraz);
  const terazIso = new Date(teraz).toISOString();
  // Przegląd tygodniowy (2026-11-01): umowa, której nowy przetarg zamyka się za kilka godzin, w mailu
  // tylko frustruje — oferty nikt już nie przygotuje. Taką pomijamy (na ekranie zostaje).
  const granicaOferty = new Date(teraz + minGodzinDoOferty * 3_600_000).toISOString();
  const wlasny = normNip(wlasnyNip);
  const poId = new Map();
  let wKubelkach = 0;
  for (const k of Object.values(kubelki ?? {})) {
    if (!k) continue;
    wKubelkach += Number(k.liczba) || 0;
    for (const u of k.umowy ?? []) {
      if (!u?.id || !u.koniec || u.koniec < dzisiaj || poId.has(u.id)) continue;
      if (wlasny && (u.zwyciezcy ?? []).some((z) => normNip(z.nip) === wlasny)) continue;
      const nastepca = u.nastepca?.deadline && String(u.nastepca.deadline) > terazIso ? u.nastepca : null;
      if (nastepca && minGodzinDoOferty > 0 && String(nastepca.deadline) < granicaOferty) continue;
      poId.set(u.id, { ...u, nastepca });
    }
  }
  const wszystkie = [...poId.values()].sort(kolejnoscUmow);
  const juzOgloszone = wszystkie.filter((u) => u.nastepca).length;
  const umowy = wszystkie
    .slice(0, limit)
    .map((u) => ({
      ...u,
      dni_do_konca: Math.round((msDnia(u.koniec) - msDnia(dzisiaj)) / DZIEN_MS),
      region_nazwa: u.wojewodztwo ? WOJEWODZTWA[u.wojewodztwo] ?? null : null,
    }));
  return { umowy, w_kubelkach: wKubelkach, juz_ogloszone: juzOgloszone };
}

/*
 * TWOJE UMOWY (2026-11-01). Radar chowa umowy, które firma sama wykonuje („wie, kiedy się kończą”),
 * ale to właśnie ich następców najłatwiej przegapić: zamawiający ogłasza przetarg 1–2 miesiące przed
 * końcem, a firma dowiaduje się, gdy umowa już przepadła. Tu zbieramy je osobno i ostrzegamy.
 */

const dataPLzIso = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : null; };
/** Termin ofert w dniu kalendarzowym w Polsce (północ PL zapisana w UTC to poprzedni dzień). */
const terminPL = (iso) => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' }) : null;
};

/**
 * Umowy firmy kończące się w horyzoncie radaru, z następcą — ogłoszone pierwsze.
 * @param {object[]} wyniki rozstrzygnięcia, w których firma wygrała (po NIP-ie)
 * @param {object[]} otwarte otwarte przetargi zamawiających tych umów
 */
export function twojeUmowy({ wyniki, otwarte, teraz = Date.now(), horyzontDni = HORYZONT_DNI }) {
  const odDnia = dzienIso(teraz);
  const doDnia = dzienIso(teraz + horyzontDni * DZIEN_MS);
  const nastepcy = nastepcyUmow(wyniki, otwarte, { teraz });
  const poId = new Map();
  for (const w of Array.isArray(wyniki) ? wyniki : []) {
    const poz = pozycjaUmowy(w, { odDnia, doDnia });
    if (!poz?.id || poId.has(poz.id)) continue;
    poId.set(poz.id, {
      ...poz,
      nastepca: nastepcy.get(poz.id) ?? null,
      dni_do_konca: Math.round((msDnia(poz.koniec) - msDnia(odDnia)) / DZIEN_MS),
      region_nazwa: poz.wojewodztwo ? WOJEWODZTWA[poz.wojewodztwo] ?? null : null,
    });
  }
  return [...poId.values()].sort(kolejnoscUmow);
}

/**
 * Alert „Twoja umowa wraca do przetargu” do centrum alertów + push. Tylko pewny następca —
 * przy słabym podobieństwie tytułów fałszywy alarm kosztowałby zaufanie do wszystkich alertów.
 * Klucz = umowa × przetarg: ten sam alert zapisany drugi raz zostaje jednym wpisem.
 * @returns {object|null}
 */
export function alertTwojejUmowy(umowa) {
  const n = umowa?.nastepca;
  if (!n?.tender_id || !n.pewny || !umowa.id) return null;
  const czysc = (s) => String(s).replace(/[/\s]/g, '_');
  const tytul = String(umowa.tytul ?? 'umowa').slice(0, 90);
  const zamawiajacy = umowa.zamawiajacy ?? 'Zamawiający';
  const koniec = dataPLzIso(umowa.koniec);
  const termin = terminPL(n.deadline);
  return {
    klucz: `umowa_${czysc(umowa.id)}_${czysc(n.tender_id)}`,
    typ: 'umowa_nastepca',
    tender_id: n.tender_id,
    ton: 'ostrzezenie',
    tytul: {
      pl: `Twoja umowa wraca do przetargu: ${tytul}`,
      en: `Your contract is up for tender again: ${tytul}`,
    },
    tresc: {
      pl: `${zamawiajacy}: nowy przetarg już ogłoszony${koniec ? `, a Twoja umowa kończy się ${koniec}` : ''}.${termin ? ` Oferty do ${termin}.` : ''} Złóż ofertę, żeby jej nie oddać.`,
      en: `${zamawiajacy}: the new tender is out${koniec ? ` and your contract ends on ${koniec}` : ''}.${termin ? ` Bids due ${termin}.` : ''} Bid to keep it.`,
    },
    pozycje: [{
      tender_id: n.tender_id,
      tytul: n.tytul ?? null,
      organizacja: zamawiajacy,
      deadline: n.deadline ?? null,
      zrodlo: n.zrodlo ?? null,
    }],
  };
}
