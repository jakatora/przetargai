/**
 * „Kontrola oferty przed wysłaniem" — lista kontrolna wyłapująca POWTARZALNE błędy formalne,
 * przez które oferty odpadają najczęściej (badania/branża: to nie brak konkurencyjności, tylko
 * możliwe do uniknięcia potknięcia — zły podpis, brak załącznika, niespójność, wadium, platforma).
 * Lekarstwo powtarzane przez ekspertów: checklista + podwójne sprawdzenie + „świeże oko".
 *
 * Czysta logika (postęp) + zapis per przetarg (storage wstrzykiwany, klucz czyszczony pod SecureStore).
 */

export const KONTROLE = [
  { klucz: 'podpis', tytul: 'Podpis elektroniczny',
    opis: 'Właściwy typ (kwalifikowany / zaufany / osobisty wg SWZ), ważny i złożony na WŁAŚCIWYM pliku (całej ofercie, nie tylko formularzu). Zły lub brakujący podpis = odrzucenie — to najczęstszy błąd elektronizacji.' },
  { klucz: 'wadium', tytul: 'Wadium',
    opis: 'Wniesione w terminie i właściwej formie (gwarancja bezwarunkowa, płatna na żądanie, na CAŁY okres związania). Brak, spóźnienie lub zła treść = odrzucenie.' },
  { klucz: 'pelnomocnictwo', tytul: 'Pełnomocnictwo',
    opis: 'Dołączone, dla właściwej osoby, w wymaganej formie i poprawnie podpisane. Brak lub wadliwe pełnomocnictwo to częsta podstawa odrzucenia.' },
  { klucz: 'oswiadczenia', tytul: 'Oświadczenia (JEDZ / oświadczenie własne)',
    opis: 'Aktualne oświadczenie o niepodleganiu wykluczeniu i spełnianiu warunków (JEDZ powyżej progów UE). Brak = wezwanie albo odrzucenie.' },
  { klucz: 'zalaczniki', tytul: 'Komplet załączników z SWZ',
    opis: 'Wszystkie wymagane dokumenty: formularz oferty, przedmiotowe środki dowodowe, wykazy, karty katalogowe. Brak wymaganego załącznika = odrzucenie (a przedmiotowych zwykle NIE da się uzupełnić).' },
  { klucz: 'spojnosc', tytul: 'Spójność formularz ↔ załączniki',
    opis: 'Te same wartości wszędzie (cena, termin, parametry). Sprzeczności między dokumentami to gotowa podstawa do odrzucenia lub wyjaśnień.' },
  { klucz: 'formularz_cenowy', tytul: 'Formularz cenowy bez błędów',
    opis: 'Wszystkie pozycje wypełnione, brak błędów rachunkowych, właściwa stawka VAT. Błąd rachunkowy lub zła stawka VAT potrafi przesądzić o odrzuceniu.' },
  { klucz: 'zgodnosc', tytul: 'Przedmiot zgodny z opisem (lub równoważność udowodniona)',
    opis: 'Oferowany przedmiot spełnia WSZYSTKIE wymagania z opisu; przy zamiennikach — dołączony dowód równoważności. Niezgodność z SWZ = odrzucenie.' },
  { klucz: 'platforma', tytul: 'Właściwa platforma, format i termin',
    opis: 'Oferta złożona na WŁAŚCIWEJ platformie/skrzynce, w wymaganym formacie plików i PRZED terminem (z zapasem). Zła platforma, format lub spóźnienie = odrzucenie bez ratunku.' },
  { klucz: 'swieze_oko', tytul: 'Sprawdzenie „świeżym okiem"',
    opis: 'Komplet przejrzany przez osobę, która NIE tworzyła oferty. Druga para oczu wyłapuje to, czego autor już nie widzi — najtańsze ubezpieczenie od formalnej wpadki.' },
];

/**
 * @param {Set<string>|string[]} wykonane
 * @returns {{pozycje: object[], zrobione: number, wszystkich: number, procent: number, gotowe: boolean}}
 */
export function podsumujKontrole(wykonane) {
  const zbior = wykonane instanceof Set ? wykonane : new Set(Array.isArray(wykonane) ? wykonane : []);
  const pozycje = KONTROLE.map((k) => ({ ...k, wykonany: zbior.has(k.klucz) }));
  const zrobione = pozycje.filter((p) => p.wykonany).length;
  return {
    pozycje,
    zrobione,
    wszystkich: KONTROLE.length,
    procent: KONTROLE.length ? Math.round((100 * zrobione) / KONTROLE.length) : 0,
    gotowe: zrobione === KONTROLE.length,
  };
}

/** Klucz storage per przetarg. SecureStore dopuszcza tylko [A-Za-z0-9._-]. */
export function kluczKontroli(tenderId) {
  return `przetargai.kontrola-oferty.${String(tenderId).replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function wczytajKontroleOferty(storage, tenderId) {
  try {
    const raw = await storage.getItem(kluczKontroli(tenderId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export async function zapiszKontroleOferty(storage, tenderId, wykonane) {
  const arr = [...(wykonane instanceof Set ? wykonane : new Set(Array.isArray(wykonane) ? wykonane : []))];
  await storage.setItem(kluczKontroli(tenderId), JSON.stringify(arr));
}
