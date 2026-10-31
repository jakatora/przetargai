import { inflateRawSync } from 'node:zlib';
import { zbudujZip } from './docx.js';

/*
 * WYPEŁNIANIE ZAŁĄCZNIKA ZAMAWIAJĄCEGO (2026-10-31, z analizy konkurencji: Mimira wypełnia Word/Excel
 * zamawiającego). Zamawiający daje własny „Załącznik nr 1 – formularz ofertowy” w .docx z kropkami do
 * wpisania. Wykonawca wpisuje w nich w kółko te same dane firmy. Tu robimy to za niego, deterministycznie
 * i za darmo (bez AI):
 *  • czytamy DOCX (ZIP: własny odczyt + inflateRawSync — Functions nie mają biblioteki zip),
 *  • w `word/document.xml` szukamy miejsc do wpisania („…………”, „_____”) i ich etykiet — tekst przed
 *    kropkami w tym samym akapicie, opis w nawiasie za kropkami albo akapit obok (komórka tabeli),
 *  • wpisujemy TYLKO pola rozpoznane z pewnością (nazwa, adres, NIP, REGON, KRS/CEIDG, e-mail, telefon,
 *    osoba, stanowisko, miejscowość i data); cena, terminy, gwarancja, podpis i wszystko nierozpoznane
 *    zostaje kropkami i trafia do listy „do uzupełnienia” — lepiej puste pole niż zła treść w ofercie.
 */

export const MAKS_BAJTOW_ZALACZNIKA = 10 * 1024 * 1024;

/** „1 pole”, „2 pola”, „5 pól”, „22 pola” — do tematu e-maila. */
export function liczbaPol(n) {
  if (n === 1) return '1 pole';
  const j = n % 10;
  const d = n % 100;
  return `${n} ${j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? 'pola' : 'pól'}`;
}
const HOST_ZALACZNIKA = /^https:\/\/([a-z0-9-]+\.)*(ezamowienia\.gov\.pl|platformazakupowa\.pl)\//i;
const MAKS_PRZEKIEROWAN = 3;

/**
 * Pobranie załącznika zamawiającego. Adres przychodzi od klienta, więc: tylko e-Zamówienia
 * i platformazakupowa.pl, przekierowania ręcznie (każde znów sprawdzone z listą), ≤ 10 MB.
 * Błąd ma `status` dla trasy (400 adres, 422 format, 502 źródło).
 */
export async function pobierzZalacznik(url, { fetchFn = fetch, limitMs = 20_000 } = {}) {
  const blad = (status, komunikat) => Object.assign(new Error(komunikat), { status });
  let adres = String(url ?? '');
  for (let skok = 0; skok <= MAKS_PRZEKIEROWAN; skok++) {
    if (!HOST_ZALACZNIKA.test(adres)) throw blad(400, 'Wypełniamy tylko załączniki z e-Zamówień i platformazakupowa.pl.');
    let res;
    try {
      res = await fetchFn(adres, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrzetargAI/1.0; +https://przetarg-ai.pl)' },
        signal: AbortSignal.timeout(limitMs),
      });
    } catch {
      throw blad(502, 'Platforma zamawiającego nie odpowiada — spróbuj za chwilę.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      adres = new URL(res.headers.get('location'), adres).toString();
      continue;
    }
    if (!res.ok) throw blad(502, `Platforma zamawiającego zwróciła błąd (HTTP ${res.status}).`);
    const bufor = Buffer.from(await res.arrayBuffer());
    if (bufor.length > MAKS_BAJTOW_ZALACZNIKA) throw blad(422, 'Załącznik jest większy niż 10 MB.');
    if (bufor.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
      throw blad(422, 'To stary format Word (.doc). Otwórz go w Wordzie, zapisz jako .docx i wypełnij ręcznie albo poproś zamawiającego o .docx.');
    }
    if (bufor.subarray(0, 5).toString('latin1') === '%PDF-') throw blad(422, 'To PDF — takiego pliku nie da się wypełnić. Wypełniamy załączniki w formacie Word (.docx).');
    if (bufor.length < 4 || bufor.readUInt32LE(0) !== 0x04034b50) throw blad(422, 'To nie jest plik Word (.docx).');
    return bufor;
  }
  throw blad(502, 'Za dużo przekierowań przy pobieraniu załącznika.');
}

/** Wpisy archiwum ZIP: [{nazwa, dane}]. Rzuca przy uszkodzonym archiwum albo nieznanej kompresji. */
export function czytajZip(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('To nie jest archiwum ZIP');
  const liczba = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const wpisy = [];
  for (let n = 0; n < liczba; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('Uszkodzony katalog ZIP');
    const metoda = b.readUInt16LE(p + 10);
    const rozmiarSkompr = b.readUInt32LE(p + 20);
    const dlNazwy = b.readUInt16LE(p + 28);
    const dlExtra = b.readUInt16LE(p + 30);
    const dlKomentarza = b.readUInt16LE(p + 32);
    const offsetLokalny = b.readUInt32LE(p + 42);
    const nazwa = b.toString('utf8', p + 46, p + 46 + dlNazwy);
    const lokalnyNazwa = b.readUInt16LE(offsetLokalny + 26);
    const lokalnyExtra = b.readUInt16LE(offsetLokalny + 28);
    const start = offsetLokalny + 30 + lokalnyNazwa + lokalnyExtra;
    const surowe = b.subarray(start, start + rozmiarSkompr);
    let dane;
    if (metoda === 0) dane = Buffer.from(surowe);
    else if (metoda === 8) dane = inflateRawSync(surowe);
    else throw new Error(`Nieobsługiwana kompresja ZIP (${metoda})`);
    if (!nazwa.endsWith('/')) wpisy.push({ nazwa, dane });
    p += 46 + dlNazwy + dlExtra + dlKomentarza;
  }
  return wpisy;
}

const ENCJE = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const odXml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENCJE[m]).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const doXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Akapity dokumentu: tekst i węzły <w:t> z pozycjami w XML-u (do podmiany). */
export function akapity(xml) {
  const wynik = [];
  const reAkapit = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = reAkapit.exec(xml))) {
    const wezly = [];
    const reT = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g;
    let t;
    let tekst = '';
    while ((t = reT.exec(m[0]))) {
      const wartosc = t[1] !== undefined ? odXml(t[1]) : '';
      wezly.push({ od: m.index + t.index, do: m.index + t.index + t[0].length, zrodlo: t[0], tekst: wartosc, start: tekst.length });
      tekst += wartosc;
    }
    wynik.push({ od: m.index, do: m.index + m[0].length, tekst, wezly });
  }
  return wynik;
}

/** Miejsca do wpisania w tekście akapitu: ciągi kropek/wielokropków/podkreśleń o „wadze” ≥ 5. */
export function miejscaDoWpisania(tekst) {
  const wynik = [];
  const re = /[._…](?:[._…\s]*[._…])*/g;
  let m;
  while ((m = re.exec(tekst))) {
    const waga = [...m[0]].reduce((s, z) => s + (z === '…' ? 3 : (z === '.' || z === '_' ? 1 : 0)), 0);
    if (waga >= 5) wynik.push({ od: m.index, do: m.index + m[0].length });
  }
  return wynik;
}

const bezOgonkow = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
const norm = (s) => bezOgonkow(s).toLowerCase().replace(/\s+/g, ' ').trim();

/*
 * Reguły etykiet. O polu decyduje słowo kluczowe NAJBLIŻEJ końca etykiety („…Zamawiający NIP 663…
 * i upoważnia Wykonawcę posiadającego nr NIP:” → NIP wykonawcy). `pomin` = celowo puste (podpis),
 * `reczne` = wykonawca musi wpisać sam (cena, terminy, rachunek…). Data tylko wprost („data”, „dnia:”
 * na końcu) — „zawarta w dniu” w umowie to dzień podpisania, nie dzisiejszy.
 */
const REGULY = [
  { pole: 'pomin', re: /\bpodpis(?:y|em|u|ow)?\b|pieczec|parafa/g },
  { pole: 'reczne', re: /cen[aeyi]\b|brutto|netto|\bvat\b|kwot|wartosc|\bzl\b|slownie|stawk|wynagrodz|termin|okres|gwaranc|rekojm|miesiec|\bdni\b|liczb|ilosc|procent|%|stron|rachun|konto|koncesj|polis|podwykonaw|umow[ay] nr|nr umowy|zakresie|podmiot|certyfik/g },
  { pole: 'email', re: /e-?mail|poczty elektronicznej/g },
  { pole: 'telefon', re: /\btel\b|telefon|\bfax\b/g },
  { pole: 'nip', re: /\bnip\b/g },
  { pole: 'regon', re: /regon/g },
  { pole: 'rejestr', re: /\bkrs\b|ceidg|rejestr/g },
  { pole: 'reprezentant', re: /osob\S* (upowaznion|uprawnion|reprezentuj|do kontakt|podpisuj|do reprezentacji)|reprezentowan\S* przez|imie i nazwisko|upowaznion\S* do kontakt/g },
  { pole: 'stanowisko', re: /stanowisk|funkcj/g },
  // „Nazwa” tylko w kontekście firmy — „nazwa towaru/producenta” to nie nasze pole (formularz 31.10).
  { pole: 'nazwa', re: /nazw[ay]? (?:\(?firm[ay]\)?\s*)?(?:wykonawc|firm|przedsiebiorc|oferent)|pelna nazwa|\bfirma\b|^nazwa\s*:?$/g },
  { pole: 'adres', re: /adres|siedzib|ulica|kod pocztowy/g },
  { pole: 'miejscowosc', re: /miejscowosc/g },
  { pole: 'data', re: /(^|\s)data:?\s*$|\bdnia:?\s*$/g },
];

/** Pole dla etykiety (ostatnie trafienie wygrywa) albo null. „Zamawiający” za słowem kluczowym → pomiń. */
export function poleDlaEtykiety(etykieta) {
  const e = norm(etykieta).slice(-90);
  if (!e) return null;
  // Sama etykieta „Wykonawca:” / „Dane Wykonawcy:” = nazwa. Gdy „Wykonawcy” tylko kończy dłuższą
  // etykietę („Adres siedziby Wykonawcy:”, „adres e-mail Wykonawcy”), decyduje wcześniejsze słowo.
  if (/^(dane\s+)?wykonawc\S*(\s*\/\s*wykonawc\S*)?\s*:?$/.test(e)) return 'nazwa';
  let najlepsze = null;
  for (const r of REGULY) {
    r.re.lastIndex = 0;
    let m;
    let ostatni = -1;
    while ((m = r.re.exec(e))) { ostatni = m.index; if (m[0] === '') r.re.lastIndex++; }
    if (ostatni >= 0 && (!najlepsze || ostatni > najlepsze.poz)) najlepsze = { pole: r.pole, poz: ostatni };
  }
  if (!najlepsze) return null;
  // Osoba/NIP ZAMAWIAJĄCEGO („reprezentującą Zamawiającego”) to nie nasze pole; „kontakt z Zamawiającym” — tak.
  if (/zamawiajac(ego|y)\b/.test(e.slice(najlepsze.poz)) && najlepsze.pole !== 'reczne') return 'pomin';
  // „(miejscowość, data)” pod linią kropek → jedno pole z obydwoma.
  if (/miejscowosc/.test(e) && /data/.test(e)) return 'miejscowosc_data';
  // „Nazwa i adres Wykonawcy” → oba w jednym miejscu.
  if ((najlepsze.pole === 'nazwa' || najlepsze.pole === 'adres') && /nazw/.test(e) && /adres|siedzib/.test(e) && !/e-?mail/.test(e)) return 'nazwa_adres';
  return najlepsze.pole;
}

const POLA_DANYCH = ['nazwa', 'adres', 'nip', 'regon', 'rejestr', 'reprezentant', 'stanowisko', 'email', 'telefon', 'miejscowosc'];

function wartoscPola(pole, dane, dzis) {
  const d = (k) => String(dane?.[k] ?? '').trim();
  const [r, mies, dz] = String(dzis).slice(0, 10).split('-');
  const data = r && mies && dz ? `${dz}.${mies}.${r}` : '';
  if (pole === 'data') return data;
  if (pole === 'miejscowosc_data') return d('miejscowosc') ? `${d('miejscowosc')}, ${data}` : '';
  if (pole === 'nazwa_adres') return d('nazwa') && d('adres') ? `${d('nazwa')}, ${d('adres')}` : '';
  if (POLA_DANYCH.includes(pole)) return d(pole);
  return '';
}

const ETYKIETY_POL = {
  nazwa: 'nazwa wykonawcy', adres: 'adres', nip: 'NIP', regon: 'REGON', rejestr: 'KRS/CEIDG', reprezentant: 'osoba',
  stanowisko: 'stanowisko', email: 'e-mail', telefon: 'telefon', miejscowosc: 'miejscowość', data: 'data', miejscowosc_data: 'miejscowość i data',
  nazwa_adres: 'nazwa i adres',
};
const krotko = (s) => String(s ?? '').replace(/[._…]{3,}/g, '…').replace(/\s+/g, ' ').trim().slice(-70);

/**
 * Wypełnia DOCX zamawiającego danymi firmy.
 * @param {Buffer} buf plik .docx
 * @param {object} dane dane wykonawcy (nazwa, adres, nip, regon, rejestr, reprezentant, stanowisko, email, telefon, miejscowosc)
 * @param {{dzis?: string, teraz?: Date}} [opcje] `dzis` RRRR-MM-DD do pól „data”
 * @returns {{plik: Buffer, wypelnione: {pole: string, etykieta: string, wartosc: string}[], do_uzupelnienia: {etykieta: string, powod: string}[]}}
 */
export function wypelnijDocx(buf, dane, { dzis = new Date().toISOString().slice(0, 10), teraz = new Date(0) } = {}) {
  const wpisy = czytajZip(buf);
  const dokument = wpisy.find((w) => w.nazwa === 'word/document.xml');
  if (!dokument) throw new Error('To nie jest dokument Word (.docx)');
  const xml = dokument.dane.toString('utf8');
  const ak = akapity(xml);
  const wypelnione = [];
  const doUzupelnienia = [];
  const podmiany = [];

  ak.forEach((a, i) => {
    const miejsca = miejscaDoWpisania(a.tekst);
    if (!miejsca.length) return;
    const nowe = a.wezly.map((w) => w.tekst);
    const decyzje = miejsca.map((mj, k) => {
      // Opis w nawiasie zaraz za POPRZEDNIM miejscem („…… (nazwa i adres Wykonawcy) zrealizuje: ……”)
      // należy do tamtego miejsca — tu liczy się dopiero tekst za nawiasem.
      let przed = a.tekst.slice(k ? miejsca[k - 1].do : 0, mj.od);
      if (k && przed.trim().startsWith('(') && przed.includes(')')) przed = przed.slice(przed.indexOf(')') + 1);
      const po = a.tekst.slice(mj.do, miejsca[k + 1]?.od ?? a.tekst.length).trim();
      // Blok podpisu „…………, dnia ……” — miejsce przed „, dnia” bez etykiety to miejscowość.
      if (!norm(przed) && /^,?\s*(dnia|dn\.|data)\b/i.test(po)) return { pole: 'miejscowosc', etykieta: 'miejscowość' };
      // Opis w nawiasie za kropkami jest dokładniejszy niż tekst przed nimi.
      const kandydaci = po.startsWith('(') ? [po.slice(1, po.indexOf(')') > 0 ? po.indexOf(')') : undefined), przed] : [przed];
      const samaLinia = !norm(a.tekst.slice(0, mj.od)) && !norm(a.tekst.slice(mj.do).replace(/^\s*\(.*\)\s*$/, ''));
      if (samaLinia) {
        const poprzedni = ak.slice(0, i).reverse().find((x) => x.tekst.trim());
        // Linia kropek tuż pod inną linią do wypełnienia to jej ciąg dalszy — nie nowe pole.
        if (poprzedni && i > 0 && ak[i - 1] === poprzedni && miejscaDoWpisania(poprzedni.tekst).length && !po.startsWith('(')) {
          return { pole: 'ciag_dalszy', etykieta: '' };
        }
        // Akapit POD linią liczy się tylko jako opis w nawiasie „(nazwa wykonawcy)” — inaczej to etykieta następnego pola.
        const nastepny = (ak[i + 1]?.tekst ?? '').trim();
        if (nastepny.startsWith('(') && nastepny.length <= 100) kandydaci.push(nastepny.replace(/^\(|\)$/g, ''));
        if (poprzedni && !miejscaDoWpisania(poprzedni.tekst).length) kandydaci.push(poprzedni.tekst);
      }
      for (const kand of kandydaci) {
        const pole = poleDlaEtykiety(kand);
        if (pole) return { pole, etykieta: krotko(kand) };
      }
      return { pole: null, etykieta: krotko(kandydaci.find((x) => norm(x)) ?? '') };
    });

    // Od końca akapitu: wcześniejsze pozycje w węzłach się nie przesuwają. Raport akapitu zbieramy
    // osobno, żeby całość szła w kolejności dokumentu.
    const wypelnioneAkapitu = [];
    const doUzupelnieniaAkapitu = [];
    for (let k = miejsca.length - 1; k >= 0; k--) {
      const { pole, etykieta } = decyzje[k];
      if (pole === 'ciag_dalszy' || pole === 'pomin') continue;
      if (!pole || pole === 'reczne') {
        if (etykieta) doUzupelnieniaAkapitu.unshift({ etykieta, powod: pole === 'reczne' ? 'wpisz sam (cena, termin, liczby)' : 'nie rozpoznaliśmy pola' });
        continue;
      }
      const wartosc = wartoscPola(pole, dane, dzis);
      if (!wartosc) {
        doUzupelnieniaAkapitu.unshift({ etykieta: etykieta || ETYKIETY_POL[pole], powod: `brak „${ETYKIETY_POL[pole]}” w danych firmy` });
        continue;
      }
      const { od, do: koniec } = miejsca[k];
      const przedZnak = a.tekst[od - 1];
      const poZnak = a.tekst[koniec];
      const wstaw = `${przedZnak && !/\s/.test(przedZnak) ? ' ' : ''}${wartosc}${poZnak && !/[\s,.;:)]/.test(poZnak) ? ' ' : ''}`;
      let wstawiono = false;
      a.wezly.forEach((w, n) => {
        const wOd = w.start;
        const wDo = w.start + w.tekst.length;
        if (wDo <= od || wOd >= koniec) return;
        const lokOd = Math.max(od, wOd) - wOd;
        const lokDo = Math.min(koniec, wDo) - wOd;
        nowe[n] = nowe[n].slice(0, lokOd) + (wstawiono ? '' : wstaw) + nowe[n].slice(lokDo);
        wstawiono = true;
      });
      wypelnioneAkapitu.unshift({ pole, etykieta: etykieta || ETYKIETY_POL[pole], wartosc });
    }
    wypelnione.push(...wypelnioneAkapitu);
    doUzupelnienia.push(...doUzupelnieniaAkapitu);
    a.wezly.forEach((w, n) => {
      if (nowe[n] !== w.tekst) podmiany.push({ od: w.od, do: w.do, xml: `<w:t xml:space="preserve">${doXml(nowe[n])}</w:t>` });
    });
  });

  let wynikXml = xml;
  for (const p of podmiany.sort((x, y) => y.od - x.od)) wynikXml = wynikXml.slice(0, p.od) + p.xml + wynikXml.slice(p.do);
  const pliki = wpisy.map((w) => (w.nazwa === 'word/document.xml' ? { nazwa: w.nazwa, dane: Buffer.from(wynikXml, 'utf8') } : w));
  return { plik: zbudujZip(pliki, teraz), wypelnione, do_uzupelnienia: doUzupelnienia };
}
