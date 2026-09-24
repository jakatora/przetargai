import { createHash } from 'node:crypto';

/*
 * HISTORIA ZMIAN OGŁOSZENIA (etap 5) — CZYSTA logika wykrywania.
 *
 * Fałszywe założenie, które siedziało w kodzie od początku: „ogłoszenie po
 * publikacji się nie zmienia". Dla BZP jest to prawie prawdą, dla Bazy
 * Konkurencyjności — nieprawdą codziennie (kolejne WERSJE tego samego ogłoszenia,
 * najczęściej z przesuniętym terminem), a dla TED zależy od rodzaju ogłoszenia.
 *
 * Skutek dla wykonawcy jest ten sam niezależnie od rejestru: przygotowuje ofertę
 * na danych, które już nie obowiązują. Ten plik zamienia dwie wersje dokumentu
 * w listę nazwanych zmian i rozstrzyga JEDNO pytanie produktowe: czy to jest
 * powód, żeby kogoś obudzić powiadomieniem.
 *
 * Zero I/O, zero zegara — obie wersje i cała decyzja są argumentami.
 */

/**
 * Katalog typów zmian. `istotna` decyduje o powiadomieniu; wszystko trafia do
 * historii niezależnie od tej flagi, bo historia ma być pełna, a nie wygodna.
 */
export const TYPY_ZMIAN = [
  {
    kod: 'anulowanie',
    istotna: true,
    etykieta: { pl: 'Postępowanie anulowane', en: 'Tender cancelled' },
  },
  {
    kod: 'termin',
    istotna: true,
    etykieta: { pl: 'Zmiana terminu składania ofert', en: 'Submission deadline changed' },
  },
  {
    kod: 'status',
    istotna: true,
    etykieta: { pl: 'Zmiana statusu w rejestrze', en: 'Register status changed' },
  },
  {
    kod: 'wartosc',
    istotna: true,
    etykieta: { pl: 'Zmiana wartości zamówienia', en: 'Contract value changed' },
  },
  {
    kod: 'dokumenty',
    istotna: true,
    etykieta: { pl: 'Nowe dokumenty lub odpowiedzi', en: 'New documents or answers' },
  },
  {
    kod: 'umowa',
    istotna: true,
    etykieta: { pl: 'Zmiana umowy', en: 'Contract modification' },
  },
  {
    kod: 'tresc',
    istotna: false,
    etykieta: { pl: 'Poprawka opisu', en: 'Description edited' },
  },
];

/** Typy, które uprawniają do powiadomienia. Jedno źródło prawdy dla harmonogramu. */
export const TYPY_ISTOTNE = new Set(TYPY_ZMIAN.filter((t) => t.istotna).map((t) => t.kod));

/**
 * Kolejność prezentacji = kolejność ważności. Gdy jedna wersja przynosi kilka
 * zmian, na górze ma być ta, która najbardziej zmienia decyzję wykonawcy.
 */
const KOLEJNOSC = TYPY_ZMIAN.map((t) => t.kod);

const DZIEN_MS = 86_400_000;

function pusty(v) {
  return v === null || v === undefined || v === '';
}

/** `true` tylko dla jawnego `true` — brak pola znaczy „nie wiemy", nie „nie". */
function anulowany(t) {
  return t?.anulowany === true;
}

function zmianaTerminu(przed, po) {
  const a = przed?.deadline ?? null;
  const b = po?.deadline ?? null;
  if (a === b) return null;

  const czasA = Date.parse(a ?? '');
  const czasB = Date.parse(b ?? '');

  let kierunek;
  let dni = null;
  if (!Number.isFinite(czasA) && Number.isFinite(czasB)) kierunek = 'pojawil_sie';
  else if (Number.isFinite(czasA) && !Number.isFinite(czasB)) kierunek = 'zniknal';
  else if (!Number.isFinite(czasA) && !Number.isFinite(czasB)) return null;
  else {
    kierunek = czasB > czasA ? 'pozniej' : 'wczesniej';
    dni = Math.round(Math.abs(czasB - czasA) / DZIEN_MS);
  }

  /*
   * Termin PRZESUNIĘTY DO PRZODU daje więcej czasu — to informacja. Termin
   * SKRÓCONY zabiera czas, który wykonawca już rozplanował, i jest jedyną zmianą
   * terminu, która potrafi wywalić go z postępowania. Dlatego różny ton.
   */
  const ton = kierunek === 'wczesniej' || kierunek === 'zniknal' ? 'danger' : 'ostrzezenie';

  const opisPl = {
    pozniej: `Termin składania ofert przesunięty o ${dni} dni później.`,
    wczesniej: `Termin składania ofert skrócony o ${dni} dni — zostało mniej czasu na ofertę.`,
    pojawil_sie: 'Zamawiający podał termin składania ofert.',
    zniknal: 'Zamawiający usunął termin składania ofert z ogłoszenia.',
  }[kierunek];
  const opisEn = {
    pozniej: `Submission deadline moved ${dni} days later.`,
    wczesniej: `Submission deadline pulled ${dni} days earlier — less time to bid.`,
    pojawil_sie: 'The buyer published a submission deadline.',
    zniknal: 'The buyer removed the submission deadline from the notice.',
  }[kierunek];

  return {
    typ: 'termin', pole: 'deadline', przed: a, po: b, kierunek, dni, ton, koniec: false,
    opis: { pl: opisPl, en: opisEn },
  };
}

function zmianaAnulowania(przed, po) {
  const bylo = anulowany(przed);
  const jest = anulowany(po);
  if (bylo === jest) return null;

  if (jest) {
    const powod = po?.anulowany_powod ? ` Powód podany przez zamawiającego: ${po.anulowany_powod}.` : '';
    const powodEn = po?.anulowany_powod ? ` Reason stated by the buyer: ${po.anulowany_powod}.` : '';
    return {
      typ: 'anulowanie',
      pole: 'anulowany',
      przed: bylo,
      po: jest,
      kierunek: 'anulowane',
      ton: 'danger',
      // Jedyna zmiana, po której nie ma czego przygotowywać. Ekran musi umieć to
      // pokazać inaczej niż resztę, stąd osobna flaga zamiast czytania `typ`.
      koniec: true,
      opis: {
        pl: `Postępowanie zostało anulowane (unieważnione) przez zamawiającego.${powod}`,
        en: `The buyer cancelled (annulled) this procurement.${powodEn}`,
      },
    };
  }

  /*
   * Powrót z anulowania to WZNOWIENIE, a nie anulowanie. Wrzucenie go do typu
   * `anulowanie` wysłałoby alarm „postępowanie anulowane" w chwili, w której
   * postępowanie właśnie wróciło do gry — czyli dokładnie odwrotny komunikat.
   */
  return {
    typ: 'status',
    pole: 'anulowany',
    przed: bylo,
    po: jest,
    kierunek: 'wznowione',
    ton: 'ostrzezenie',
    koniec: false,
    opis: {
      pl: 'Postępowanie wróciło do obiegu — znacznik anulowania został zdjęty.',
      en: 'The procurement is back — the cancellation flag was removed.',
    },
  };
}

function zmianaWartosci(przed, po) {
  const a = typeof przed?.budget === 'number' ? przed.budget : null;
  const b = typeof po?.budget === 'number' ? po.budget : null;
  if (a === b) return null;
  if (a === null || b === null) {
    return {
      typ: 'wartosc', pole: 'budget', przed: a, po: b, kierunek: b === null ? 'zniknela' : 'pojawila_sie',
      delta: null, procent: null, ton: 'ostrzezenie', koniec: false,
      opis: b === null
        ? { pl: 'Zamawiający usunął wartość zamówienia z ogłoszenia.', en: 'The buyer removed the contract value from the notice.' }
        : { pl: `Zamawiający podał wartość zamówienia: ${b}.`, en: `The buyer published the contract value: ${b}.` },
    };
  }

  const delta = b - a;
  // Dzielenie przez zero nie daje procentu, tylko Infinity — a Infinity na ekranie
  // jest gorsze niż uczciwe „nie da się policzyć".
  const procent = a === 0 ? null : Math.round((delta / a) * 100);
  const kierunek = delta > 0 ? 'wzrost' : 'spadek';

  return {
    typ: 'wartosc', pole: 'budget', przed: a, po: b, kierunek, delta, procent,
    ton: 'ostrzezenie', koniec: false,
    opis: {
      pl: `Wartość zamówienia ${kierunek === 'wzrost' ? 'wzrosła' : 'spadła'} z ${a} na ${b}${procent === null ? '' : ` (${procent > 0 ? '+' : ''}${procent}%)`}.`,
      en: `Contract value ${kierunek === 'wzrost' ? 'rose' : 'fell'} from ${a} to ${b}${procent === null ? '' : ` (${procent > 0 ? '+' : ''}${procent}%)`}.`,
    },
  };
}

function zmianaStatusu(przed, po) {
  const a = przed?.status_zrodla ?? null;
  const b = po?.status_zrodla ?? null;
  if (a === b || (pusty(a) && pusty(b))) return null;

  return {
    typ: 'status', pole: 'status_zrodla', przed: a, po: b, kierunek: 'zmieniony',
    ton: 'ostrzezenie', koniec: false,
    opis: {
      pl: `Status ogłoszenia w rejestrze źródłowym zmienił się z „${a ?? 'brak'}" na „${b ?? 'brak'}".`,
      en: `The notice status in the source register changed from “${a ?? 'none'}” to “${b ?? 'none'}”.`,
    },
  };
}

/**
 * Zmiana treści/załączników u ŹRÓDŁA.
 *
 * `zrodlo_odcisk` to odcisk pozycji z listy rejestru (termin + tytuł + treść) —
 * ten sam, którym okno pobierania rozstrzyga, czy w ogóle warto dociągać szczegół.
 * W Bazie Konkurencyjności druga co do częstości zmiana to DOKLEJENIE ODPOWIEDZI
 * NA PYTANIA do treści ogłoszenia, a to dla wykonawcy jest nowy dokument, nawet
 * jeśli formalnie jest akapitem.
 */
function zmianaDokumentow(przed, po) {
  const a = przed?.zrodlo_odcisk ?? null;
  const b = po?.zrodlo_odcisk ?? null;
  if (a === b || pusty(b)) return null;
  if (pusty(a)) return null; // pierwszy zapis odcisku nie jest zmianą treści

  return {
    typ: 'dokumenty', pole: 'zrodlo_odcisk', przed: a, po: b, kierunek: 'zmieniona_tresc',
    ton: 'ostrzezenie', koniec: false,
    opis: {
      pl: 'Zamawiający zmienił treść ogłoszenia — najczęściej to nowe dokumenty albo odpowiedzi na pytania. Sprawdź ogłoszenie w rejestrze.',
      en: 'The buyer edited the notice — usually new documents or answers to questions. Check the notice in the register.',
    },
  };
}

/**
 * Zmiana UMOWY (aneks). Odnotowujemy ją WYŁĄCZNIE wtedy, gdy rejestr sam taką
 * informację podaje — nie wnioskujemy jej z niczego innego. Dziś niesie ją Baza
 * Konkurencyjności (`terms_of_contract_change`); BZP i TED publikują ją jako osobny
 * rodzaj ogłoszenia, więc pole zostaje puste, dopóki nie pobieramy tego rodzaju.
 */
function zmianaUmowy(przed, po) {
  const a = przed?.umowa_zmieniona_o ?? null;
  const b = po?.umowa_zmieniona_o ?? null;
  if (a === b || pusty(b)) return null;

  const szczegol = po?.umowa_zmiana_opis ? ` ${po.umowa_zmiana_opis}` : '';
  return {
    typ: 'umowa', pole: 'umowa_zmieniona_o', przed: a, po: b, kierunek: 'zmieniona',
    ton: 'ostrzezenie', koniec: false,
    opis: {
      pl: `Rejestr odnotował zmianę umowy.${szczegol}`,
      en: `The register recorded a contract modification.${szczegol}`,
    },
  };
}

function zmianaTresci(przed, po) {
  const zmienione = ['title', 'organization'].filter((pole) => (przed?.[pole] ?? null) !== (po?.[pole] ?? null));
  if (!zmienione.length) return null;

  return {
    typ: 'tresc', pole: zmienione.join(','), przed: przed?.title ?? null, po: po?.title ?? null,
    kierunek: 'poprawka', ton: 'neutral', koniec: false,
    opis: {
      pl: 'Zamawiający poprawił opis ogłoszenia (tytuł lub nazwę zamawiającego).',
      en: 'The buyer edited the notice description (title or buyer name).',
    },
  };
}

const DETEKTORY = [
  zmianaAnulowania, zmianaTerminu, zmianaStatusu, zmianaWartosci,
  zmianaDokumentow, zmianaUmowy, zmianaTresci,
];

/**
 * Porównuje dwie wersje dokumentu przetargu.
 *
 * @param {object|null} przed wersja zapisana w bazie (null = ogłoszenie dopiero powstaje)
 * @param {object} po wersja przyniesiona przez rejestr
 * @returns {Array<object>} zmiany w kolejności ważności; pusta lista = nic się nie zmieniło
 */
export function wykryjZmiany(przed, po) {
  // Nowe ogłoszenie nie jest „zmianą wszystkiego" — ma własną ścieżkę (nowe trafienie).
  if (!przed || !po) return [];

  const zmiany = DETEKTORY.map((d) => d(przed, po)).filter(Boolean);

  return zmiany
    .map((z) => ({ ...z, istotna: TYPY_ISTOTNE.has(z.typ) }))
    .sort((a, b) => KOLEJNOSC.indexOf(a.typ) - KOLEJNOSC.indexOf(b.typ));
}

/**
 * Deterministyczny identyfikator zmiany = klucz idempotencji zapisu i powiadomienia.
 *
 * Liczony z PRZEJŚCIA (przed → po), nie z samej nowej wartości: termin przesunięty
 * tam i z powrotem to dwa różne zdarzenia i wykonawca musi zobaczyć oba.
 */
export function kluczZmiany(tenderId, zmiana) {
  const material = [tenderId, zmiana?.typ, zmiana?.pole, String(zmiana?.przed ?? ''), String(zmiana?.po ?? '')]
    .join('\u0000');
  return createHash('sha1').update(material).digest('base64url').slice(0, 22);
}

/** Czy w tej partii jest cokolwiek, co uprawnia do obudzenia człowieka. */
export function czySaIstotne(zmiany) {
  return (zmiany ?? []).some((z) => TYPY_ISTOTNE.has(z?.typ));
}

const ETYKIETY = new Map(TYPY_ZMIAN.map((t) => [t.kod, t.etykieta]));

/** Jedno zdanie podsumowania partii zmian — do nagłówka powiadomienia i karty alertu. */
export function podsumujZmiany(zmiany) {
  const lista = zmiany ?? [];
  if (!lista.length) return { pl: '', en: '' };

  const etykiety = lista.map((z) => ETYKIETY.get(z?.typ)).filter(Boolean);
  if (etykiety.length === 1) return { pl: etykiety[0].pl, en: etykiety[0].en };

  return {
    pl: `${etykiety[0].pl} i ${etykiety.length - 1} inn${etykiety.length - 1 === 1 ? 'a zmiana' : 'e zmiany'}`,
    en: `${etykiety[0].en} and ${etykiety.length - 1} other change${etykiety.length - 1 === 1 ? '' : 's'}`,
  };
}
