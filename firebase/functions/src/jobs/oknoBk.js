import { createHash } from 'node:crypto';
import { logger } from '../lib/logger.js';
import { env } from '../config.js';
import {
  pobierzAktywne, pobierzSzczegolBk, normalizujOgloszenieBk, statusOgloszenia,
  STATUS_ANULOWANY, TEMPO_BK, ZRODLO,
} from '../services/bazaKonkurencyjnosci.js';
import { stanTempa } from '../lib/tempoZapytan.js';
import { oknoBk as repoOkna, tenders } from '../db/repos.js';
import { pustyLicznik } from '../lib/licznikZrodla.js';

/*
 * OKNO POBIERANIA BAZY KONKURENCYJNOŚCI z checkpointem (etap 3).
 *
 * Problem: wartość zamówienia i CPV są WYŁĄCZNIE w szczegółach
 * (`GET /announcements/{id}`), a aktywnych ogłoszeń jest 1 135 (pomiar 2026-09-24).
 * Bez pamięci między przebiegami każdy cykl kosztowałby 1 135 zapytań po dane,
 * które się nie ruszyły — i nie zmieściłby się w żadnym budżecie czasu.
 *
 * Z checkpointem przebieg pobiera szczegóły TYLKO dla ogłoszeń nowych i zmienionych.
 * Zmianę widać już z LISTY (odcisk z terminu, tytułu i treści), więc wykrycie
 * przesuniętego terminu — najczęstszej zmiany w BK — nie kosztuje ani jednego
 * dodatkowego zapytania.
 *
 * Idempotencja: docId przetargu = `bk:<id>` ogłoszenia, więc powtórne pobranie
 * niczego nie duplikuje. Wznawianie jest bezpieczne z konstrukcji.
 */

/** Ile wpisów wolno trzymać w checkpoincie (dokument Firestore ma limit 1 MiB). */
export const MAKS_WPISOW_CHECKPOINTU = 5000;

/**
 * Odcisk ogłoszenia liczony z pozycji LISTY — bez ani jednego dodatkowego zapytania.
 *
 * Bierzemy termin składania, tytuł i treść, bo to są pola, które realnie zmienia
 * zamawiający: przesuwa termin (najczęściej), poprawia opis, dokleja odpowiedzi na
 * pytania („=> 24.09.2026 Zamawiający udzielił odpowiedzi…"). Każda z tych zmian ma
 * znaczenie dla wykonawcy, który już widział to ogłoszenie w feedzie.
 */
export function odciskOgloszenia(poz) {
  const material = [poz?.submission_deadline, poz?.title, poz?.content]
    .map((v) => (Array.isArray(v) ? v.join(' ') : String(v ?? '')))
    .join('\u0000');
  return createHash('sha1').update(material).digest('base64url').slice(0, 22);
}

/**
 * Które ogłoszenia wymagają pobrania szczegółu w tym przebiegu i w jakiej kolejności.
 *
 * Okno czasu (`oknoOd`) USTAWIA KOLEJNOŚĆ, a nie odsiewa. Twarde odcięcie po dacie
 * publikacji ukryłoby ogłoszenia otwarte od miesięcy — a to często NAJWIĘKSZE
 * kontrakty (w pomiarze: dostawa lokomotyw opublikowana 3 czerwca z terminem
 * w październiku). Świeże idą pierwsze, zaległe domykają się w kolejnych przebiegach.
 *
 * @returns {{doPobrania: string[], nowe: number, zmienione: number, bezZmian: number,
 *   pozaOknem: number, zaleglosc: number}}
 */
export function wybierzDoPobrania({ aktywne, checkpoint, oknoOd, maks }) {
  const stan = checkpoint?.ogloszenia ?? {};
  const wOknie = [];
  const zalegle = [];
  let nowe = 0;
  let zmienione = 0;
  let bezZmian = 0;

  for (const [id, poz] of aktywne) {
    const znany = stan[id];
    const odcisk = odciskOgloszenia(poz);
    if (znany?.odcisk === odcisk) { bezZmian += 1; continue; }

    if (znany) zmienione += 1; else nowe += 1;
    const dataPublikacji = String(poz?.publication_date ?? '');
    (dataPublikacji >= oknoOd ? wOknie : zalegle).push({ id, dataPublikacji });
  }

  /*
   * W oknie: od najświeższych. Zaległe: też od najświeższych, ale dopiero po oknie.
   * Komparator MUSI zwracać 0 dla równych dat — inaczej `sort` przestawia ogłoszenia
   * z tej samej doby (a w BK jest ich po 171 dziennie) i kolejka jest losowa.
   */
  const malejaco = (a, b) => b.dataPublikacji.localeCompare(a.dataPublikacji);
  const kolejka = [...wOknie.sort(malejaco), ...zalegle.sort(malejaco)].map((x) => x.id);

  return {
    doPobrania: kolejka.slice(0, Math.max(0, maks)),
    nowe,
    zmienione,
    bezZmian,
    pozaOknem: zalegle.length,
    // Ile zostaje na następny przebieg. Bez tej liczby nie da się odpowiedzieć,
    // czy okno w ogóle się kiedykolwiek domknie.
    zaleglosc: Math.max(0, kolejka.length - Math.max(0, maks)),
  };
}

/**
 * Które ogłoszenia zniknęły z listy aktywnych i wymagają sprawdzenia szczegółem.
 *
 * 🚨 DWIE BLOKADY, bez których to byłaby maszynka do fałszywych anulowań:
 *
 *  1. POKRYCIE MUSI BYĆ PEŁNE. BK oddaje wyniki w niestabilnej kolejności —
 *     zmierzony przebieg pokrył 921/1135 (81 %). Bez tej blokady oznaczylibyśmy
 *     co piąte żywe ogłoszenie jako anulowane.
 *  2. OGŁOSZENIE PO TERMINIE znika z listy NATURALNIE. Większość zniknięć to
 *     wygaśnięcia, nie anulowania — weryfikowanie ich to czysta strata zapytań.
 *
 * Sama nieobecność niczego nie przesądza: zwracamy listę DO SPRAWDZENIA, a decyzję
 * podejmuje dopiero status z API (`data.advertisement.advertisement.status`).
 */
export function wykryjZnikniecia({ aktywne, checkpoint, pokrycieKompletne, teraz, maks }) {
  if (!pokrycieKompletne) return [];
  const stan = checkpoint?.ogloszenia ?? {};
  const doSprawdzenia = [];

  for (const [id, wpis] of Object.entries(stan)) {
    if (aktywne.has(id)) continue;
    // Brak zapamiętanego terminu = nie wiemy, czy wygasło — sprawdzamy.
    if (wpis?.termin && wpis.termin <= teraz) continue;
    doSprawdzenia.push(id);
    if (doSprawdzenia.length >= maks) break;
  }
  return doSprawdzenia;
}

/**
 * Nowy stan checkpointu po przebiegu.
 *
 * Odcisk zapisujemy WYŁĄCZNIE dla ogłoszeń, których szczegół realnie pobraliśmy.
 * Wpisanie go „na zapas" udawałoby, że mamy dane, których nie mamy, i ogłoszenie
 * nigdy by nie weszło do bazy.
 *
 * Przycinanie do listy aktywnych robimy TYLKO przy pełnym pokryciu — inaczej
 * kasowalibyśmy wpisy, które w tym przebiegu po prostu nie trafiły się w losowej
 * kolejności, i kazali pobrać ich szczegóły jeszcze raz.
 */
export function zaktualizujCheckpointBk({
  checkpoint, aktywne, przetworzone = [], anulowane = [], pokrycieKompletne, teraz,
  maksWpisow = MAKS_WPISOW_CHECKPOINTU,
}) {
  const poprzedni = checkpoint?.ogloszenia ?? {};
  const stan = {};

  for (const [id, wpis] of Object.entries(poprzedni)) {
    if (pokrycieKompletne && !aktywne.has(id)) continue;
    stan[id] = wpis;
  }

  for (const { id, termin } of przetworzone) {
    const poz = aktywne.get(String(id));
    if (!poz) continue;
    stan[String(id)] = {
      odcisk: odciskOgloszenia(poz),
      publication_date: poz.publication_date ?? null,
      termin: termin ?? null,
      pobrane_o: teraz,
    };
  }

  // Anulowane wypada z checkpointu: nie ma go już na liście, więc bez usunięcia
  // wracałoby do weryfikacji w każdym kolejnym przebiegu.
  for (const id of anulowane) delete stan[String(id)];

  const klucze = Object.keys(stan);
  if (klucze.length <= maksWpisow) return { ogloszenia: stan };

  // Przepełnienie: zostawiamy NAJŚWIEŻSZE publikacje, nie losowe wpisy.
  const przyciete = {};
  for (const id of klucze
    .sort((a, b) => String(stan[b].publication_date ?? '').localeCompare(String(stan[a].publication_date ?? '')))
    .slice(0, maksWpisow)) {
    przyciete[id] = stan[id];
  }
  logger.warn({ bylo: klucze.length, zostalo: maksWpisow },
    'BK: checkpoint przekroczył sufit wpisów — przycięty do najświeższych');
  return { ogloszenia: przyciete };
}

/* ======================= orkiestracja przebiegu ======================= */

function oknoOdDni(dni, teraz) {
  return new Date(teraz - dni * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Pobranie BK z wznawianiem — wejście dla rejestru źródeł w `fetchTenders`.
 *
 * Zwraca ZNORMALIZOWANE ogłoszenia (nowe i zmienione) do zapisu przez wołającego.
 * Dwie rzeczy załatwia sama, bo wymagają decyzji, której rejestr nie zna:
 *  • AKTUALIZACJĘ istniejących dokumentów (upsert jest create-only, a BK wydaje
 *    kolejne wersje tego samego ogłoszenia — najczęściej z nowym terminem),
 *  • ANULOWANIA (wpis zostaje w bazie, ale wypada z puli dopasowań).
 *
 * @param {object} licznik akumulator pomiarów (lib/licznikZrodla.js)
 * @param {{budzetMs?: number, teraz?: () => number}} opts
 */
export async function pobierzBkZWznowieniem(licznik, { budzetMs = Infinity, teraz = () => Date.now() } = {}) {
  const start = teraz();
  const tempo = stanTempa({ ...TEMPO_BK, teraz });
  const pozostalo = () => Math.max(0, budzetMs - (teraz() - start));

  // Listowanie dostaje POŁOWĘ budżetu — reszta musi zostać na szczegóły, inaczej
  // przebieg zna całą listę i nie zapisuje z niej ani jednego ogłoszenia.
  const { aktywne, total, przebiegi, pokrycieKompletne } = await pobierzAktywne({
    licznik, budzetMs: Number.isFinite(budzetMs) ? budzetMs / 2 : Infinity, tempo,
  });

  const checkpoint = await repoOkna.wczytaj().catch((err) => {
    // Brak checkpointu nie może zablokować pobierania — w najgorszym razie
    // przebieg zrobi to, co robił pierwszego dnia: pobierze wszystko od nowa.
    logger.error({ err: err.message }, 'BK: nie udało się wczytać checkpointu okna');
    return null;
  });

  const wybor = wybierzDoPobrania({
    aktywne,
    checkpoint,
    oknoOd: oknoOdDni(env.BK_LOOKBACK_DAYS, teraz()),
    maks: env.BK_MAKS_SZCZEGOLOW,
  });
  logger.info({ ...wybor, doPobrania: wybor.doPobrania.length, aktywne: aktywne.size, total },
    'BK: wybrane ogłoszenia do pobrania szczegółów');

  const ogloszenia = [];
  const przetworzone = [];
  const anulowane = [];
  let zaktualizowane = 0;
  let budzetWyczerpany = false;

  for (const id of wybor.doPobrania) {
    if (pozostalo() <= 0) {
      budzetWyczerpany = true;
      logger.warn({ pobrane: przetworzone.length, zostalo: wybor.doPobrania.length - przetworzone.length },
        'BK: budżet czasu wyczerpany — reszta szczegółów zostaje na następny przebieg');
      break;
    }

    let json;
    try {
      json = await pobierzSzczegolBk(id, { tempo });
    } catch (err) {
      // Awaria jednego szczegółu nie może zabrać całego przebiegu. Ogłoszenie nie
      // dostaje odcisku, więc wróci w następnym — a nie zniknie po cichu.
      logger.warn({ err: err.message, id }, 'BK: szczegół niedostępny — ogłoszenie wróci w następnym przebiegu');
      continue;
    }

    if (statusOgloszenia(json) === STATUS_ANULOWANY) {
      // Wyścig: ogłoszenie było jeszcze na liście PUBLISHED, a szczegół mówi
      // CANCELLED. Wierzymy szczegółowi — to on jest źródłem prawdy o statusie.
      anulowane.push(String(id));
      continue;
    }

    const t = normalizujOgloszenieBk(json);
    if (!t) {
      if (licznik) licznik.odrzucone += 1;
      continue;
    }

    // Aktualizacja idzie PRZED zapisem wołającego: dla ogłoszenia, którego jeszcze
    // nie ma w bazie, jest nieszkodliwym no-op, a dla istniejącego dowozi nowy termin.
    if (checkpoint?.ogloszenia?.[String(id)]) {
      const { zmienione } = await tenders.zaktualizujZeZrodla(t)
        .catch((err) => { logger.error({ err: err.message, id }, 'BK: aktualizacja nie powiodła się'); return { zmienione: false }; });
      if (zmienione) zaktualizowane += 1;
    }

    ogloszenia.push(t);
    przetworzone.push({ id: String(id), termin: t.deadline });
  }

  /*
   * Zniknięcia sprawdzamy DOPIERO tu i tylko przy pełnym pokryciu — patrz
   * `wykryjZnikniecia`. Weryfikacja jest zawsze potwierdzana szczegółem: sama
   * nieobecność na liście nigdy nie wystarcza do oznaczenia anulowania.
   */
  let sprawdzoneZnikniecia = 0;
  if (!budzetWyczerpany) {
    const podejrzane = wykryjZnikniecia({
      aktywne, checkpoint, pokrycieKompletne, teraz: new Date(teraz()).toISOString(), maks: env.BK_MAKS_WERYFIKACJI,
    });
    for (const id of podejrzane) {
      if (pozostalo() <= 0) break;
      sprawdzoneZnikniecia += 1;
      try {
        if (statusOgloszenia(await pobierzSzczegolBk(id, { tempo })) === STATUS_ANULOWANY) anulowane.push(String(id));
      } catch (err) {
        logger.warn({ err: err.message, id }, 'BK: nie udało się zweryfikować zniknięcia — zostaje na następny przebieg');
      }
    }
  }

  for (const id of anulowane) {
    await tenders.oznaczAnulowany(`bk:${id}`, { powod: STATUS_ANULOWANY })
      .catch((err) => logger.error({ err: err.message, id }, 'BK: nie udało się oznaczyć anulowania'));
  }

  const nowyStan = zaktualizujCheckpointBk({
    checkpoint, aktywne, przetworzone, anulowane, pokrycieKompletne, teraz: new Date(teraz()).toISOString(),
  });
  await repoOkna.zapisz(nowyStan).catch((err) =>
    logger.error({ err: err.message }, 'BK: nie udało się zapisać checkpointu okna'));

  if (licznik) {
    licznik.bkAktywne = aktywne.size;
    licznik.bkTotal = total;
    licznik.bkPrzebiegiListy = przebiegi;
    licznik.bkNowe = wybor.nowe;
    licznik.bkZmienione = wybor.zmienione;
    licznik.bkBezZmian = wybor.bezZmian;
    licznik.bkPozaOknem = wybor.pozaOknem;
    licznik.bkZaleglosc = wybor.zaleglosc;
    licznik.bkZaktualizowane = zaktualizowane;
    licznik.bkAnulowane = anulowane.length;
    licznik.bkSprawdzoneZnikniecia = sprawdzoneZnikniecia;
    licznik.bkBudzetWyczerpany = budzetWyczerpany;
  }

  logger.info({
    zrodlo: ZRODLO, aktywne: aktywne.size, total, pokrycieKompletne,
    ogloszenia: ogloszenia.length, zaktualizowane, anulowane: anulowane.length, zaleglosc: wybor.zaleglosc,
  }, 'BK: zakończono przebieg okna');
  return ogloszenia;
}

/**
 * Ile czasu wolno zużyć na JEDEN przebieg domykania okna BK.
 *
 * Pomiar 2026-09-24: listowanie 3 strony × ~0,8 s, szczegół ~0,12 s + odstęp 0,4 s.
 * 150 szczegółów ≈ 80 s. Zapas jest duży, bo BK bywa wolniejsze w godzinach pracy,
 * a przekroczenie limitu funkcji oznacza utratę checkpointu tego przebiegu.
 */
export const BUDZET_OKNA_BK_MS = 600_000;

/**
 * Domyka okno BK: dopobiera szczegóły i zapisuje ogłoszenia.
 *
 * Świadomie NIE liczy dopasowań i NIE woła AI — to zadanie `dailyTenderFetch`.
 * Tu chodzi wyłącznie o kompletność danych źródłowych, więc przebieg jest DARMOWY
 * poza odczytem publicznego API i zapisami do Firestore.
 */
export async function runBkOkno({ budzetMs = BUDZET_OKNA_BK_MS } = {}) {
  const start = Date.now();
  const licznik = pustyLicznik();
  let ogloszenia = [];
  let blad = null;

  try {
    ogloszenia = await pobierzBkZWznowieniem(licznik, { budzetMs });
  } catch (err) {
    blad = err.message;
    logger.error({ err: err.message }, 'bkOkno: pobieranie okna nie powiodło się');
  }

  let nowe = 0;
  let pominiete = 0;
  for (const ogloszenie of ogloszenia) {
    try {
      const { created } = await tenders.upsert(ogloszenie);
      if (created) nowe += 1;
    } catch (err) {
      pominiete += 1;
      logger.error({ err: err.message, externalId: ogloszenie?.externalId },
        'bkOkno: pominięto ogłoszenie, którego nie dało się zapisać');
    }
  }
  if (nowe > 0 || licznik.bkAnulowane) tenders.odswiezPule();

  const wynik = {
    ok: blad === null,
    error: blad,
    fetched: ogloszenia.length,
    newTenders: nowe,
    skipped: pominiete,
    surowe: licznik.surowe,
    odrzucone: licznik.odrzucone,
    zapytania: licznik.zapytania,
    aktywne_w_zrodle: licznik.bkTotal ?? null,
    aktywne_pobrane: licznik.bkAktywne ?? null,
    pokrycie_kompletne: licznik.pokrycieKompletne ?? null,
    przebiegi_listy: licznik.bkPrzebiegiListy ?? null,
    nowe_ogloszenia: licznik.bkNowe ?? null,
    zmienione_ogloszenia: licznik.bkZmienione ?? null,
    zaktualizowane: licznik.bkZaktualizowane ?? 0,
    anulowane: licznik.bkAnulowane ?? 0,
    zaleglosc: licznik.bkZaleglosc ?? null,
    poza_oknem: licznik.bkPozaOknem ?? null,
    durationMs: Date.now() - start,
    zakonczony_o: new Date().toISOString(),
  };

  await repoOkna.zapiszPrzebieg(wynik).catch((err) =>
    logger.error({ err: err.message }, 'bkOkno: nie udało się zapisać śladu przebiegu'));

  logger.info(wynik, 'bkOkno: zakończono');
  return wynik;
}
