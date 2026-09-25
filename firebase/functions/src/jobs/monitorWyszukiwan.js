import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import {
  wyszukiwania, alerty, historiaZmian, tenders, users,
} from '../db/repos.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';
import { czyNalezySprawdzic } from '../lib/zapisaneWyszukiwania.js';
import { normalizujFiltry, pasujeDoFiltrow } from '../lib/katalogPrzetargow.js';
import {
  noweTrafienia, zmianyDlaWyszukiwania, zbudujAlertNowych, zbudujAlertZmian,
  trescPush, oknoOdczytuZmian, oknoOdczytuNowych, kolejnoscObslugi,
} from '../lib/planMonitoringu.js';

/*
 * HARMONOGRAM MONITORINGU ZAPISANYCH WYSZUKIWAŃ (etap 5).
 *
 * Ten job jest CIENKI z założenia: czyta, woła czyste funkcje z lib/planMonitoringu.js
 * i zapisuje. Wszystkie decyzje („czy powiadamiać", „o czym", „jak nazwać") mieszkają
 * w czystej warstwie i mają testy bez bazy — tutaj zostaje wyłącznie I/O i odporność.
 *
 * TRZY REGUŁY KOSZTU, bez których monitoring się nie opłaca:
 *
 *  1. ZERO PŁATNEGO AI. Przebieg idzie co 2 h przez wszystkie konta; jedno wywołanie
 *     modelu na wyszukiwanie zamieniłoby go w maszynkę do palenia budżetu. Strażnik
 *     w teście czyta ten plik i pilnuje, że nie ma stąd drogi do `services/ai.js`.
 *  2. HISTORIA ZMIAN CZYTANA RAZ NA PARTIĘ, nie raz na wyszukiwanie. Zmiany są wspólne
 *     dla wszystkich obserwacji; czytanie ich osobno mnożyłoby koszt przez liczbę kont.
 *  3. WYŁĄCZONE OBSERWACJE NIE KOSZTUJĄ ODCZYTU — odsiewa je zapytanie, nie kod.
 *
 * ODPORNOŚĆ: awaria jednego konta nie przerywa partii. Job kończy się `ok: false`,
 * gdy cokolwiek padło, żeby Cloud Scheduler ponowił przebieg — a ponowienie jest
 * bezpieczne, bo alert ma deterministyczny klucz (docId), więc nie wyśle się dwa razy.
 */

/**
 * Sufit dokumentów strumienia NOWYCH ogłoszeń na jeden przebieg (2026-09-25).
 *
 * Strumień czytamy RAZ dla wszystkich obserwacji, więc sufit dotyczy przebiegu, nie
 * wyszukiwania. Okno strumienia jest przycięte do `MAKS_DNI_WSTECZ_NOWYCH` (10 dni
 * ≈ 8 tys. ogłoszeń przy ~5,7 tys. tygodniowo) — sufit ma zapas ponad dwukrotny,
 * więc w normalnym ruchu nie przerywa niczego. Gdy jednak przerwie, obserwacje
 * dostają „co najmniej N", a kursor staje na granicy przejrzanego (nic nie ginie).
 * Koszt pełnego sufitu: 20 tys. odczytów z projekcją ≈ 0,01 USD na przebieg.
 */
export const BUDZET_ODCZYTOW_NOWYCH = 20_000;

/**
 * Ile czasu wolno zużyć na czytanie strumienia nowych ogłoszeń.
 *
 * Funkcja `monitorWyszukiwan` ma limit 540 s (index.js) i po tym jobie woła jeszcze
 * monitoring planów, więc czytanie rynku nie może zjeść budżetu wysyłki. 8 tys.
 * dokumentów z projekcją to kilka–kilkanaście sekund; 120 s to bezpiecznik na
 * zdławioną bazę, nie oczekiwany czas.
 */
export const BUDZET_CZASU_STRUMIENIA_MS = 120_000;

/** Ile dokumentów przetargów pobieramy jednym `getAll` (limit Firestore to 500). */
const PORCJA_DOKUMENTOW = 300;

/** Dokumenty przetargów dotkniętych zmianami — jednym odczytem na partię. */
async function wczytajTenderyZmian(zmiany) {
  const idki = [...new Set(zmiany.map((z) => z.tenderId).filter(Boolean))];
  const mapa = new Map();

  for (let i = 0; i < idki.length; i += PORCJA_DOKUMENTOW) {
    const porcja = idki.slice(i, i + PORCJA_DOKUMENTOW);
    const dokumenty = await Promise.all(porcja.map((id) => tenders.findById(id).catch(() => null)));
    for (const t of dokumenty) if (t) mapa.set(t.id, t);
  }
  return mapa;
}

/**
 * Dostarcza alert właścicielowi: push, a gdy nie ma tokenu — e-mail.
 *
 * E-mail NIE jest tu wysyłką masową: idzie do JEDNEGO właściciela obserwacji, którą
 * sam włączył, najwyżej raz na jego częstotliwość. Bez tej gałęzi konto bez zgody na
 * powiadomienia nie dowiedziałoby się o niczym, a właśnie takie konta najczęściej
 * zakłada się „na próbę" i porzuca.
 */
export async function dostarcz({ user, alert, wyslijPush, wyslijEmail }) {
  const tresc = trescPush(alert);

  if (user?.push_token) {
    const wynikPush = await wyslijPush(user.push_token, tresc);
    /*
     * `sent: 0` = Expo NIE przyjęło biletu (martwy token, brak klucza FCM). Dawniej
     * wynik był ignorowany i alert liczył się jako „dostarczony pushem", choć nikt
     * go nie dostał (2026-09-25). Wtedy — jak przy braku tokenu — idzie e-mail.
     * Brak liczby (starszy kontrakt wysyłki) traktujemy jak doręczenie.
     */
    if (wynikPush?.sent !== 0) return 'push';
    logger.warn({ userId: user.id ?? null, bledy: wynikPush?.bledy ?? null },
      'Monitoring: push nie dotarł — wysyłam e-mail awaryjny');
  }
  if (user?.email) {
    const pozycje = (alert?.pozycje ?? []).filter((p) => p?.tytul);
    await wyslijEmail({
      to: user.email,
      subject: tresc.title,
      text: [tresc.body, ...pozycje.map((p) => `• ${p.tytul}${p.organizacja ? ` — ${p.organizacja}` : ''}`)].join('\n'),
      html: htmlAlertu(tresc, pozycje),
    });
    return 'email';
  }
  return 'brak';
}

/**
 * Escape HTML — lokalny, świadomie niezależny od szablonów w services/email.js.
 *
 * Nazwa wyszukiwania pochodzi od użytkownika, a tytuły i nazwy zamawiających
 * z rejestrów publicznych. Wklejone surowo do HTML maila pozwalały wstrzyknąć
 * znaczniki (link, obrazek śledzący) do wiadomości wysyłanej z naszej domeny.
 */
function esc(wartosc) {
  return String(wartosc ?? '').replace(/[&<>"']/g, (z) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[z]);
}

function htmlAlertu(tresc, pozycje) {
  const lista = pozycje.length
    ? `<ul>${pozycje.map((p) => `<li>${esc(p.tytul)}${p.organizacja ? ` — ${esc(p.organizacja)}` : ''}</li>`).join('')}</ul>`
    : '';
  return `<p><b>${esc(tresc.title)}</b></p><p>${esc(tresc.body)}</p>${lista}`;
}

/**
 * Strumień nowych ogłoszeń dla całej partii — JEDEN odczyt rynku na przebieg.
 *
 * Awaria odczytu nie wywraca przebiegu: zwracamy strumień „nieprzeczytany", przy
 * którym żadna obserwacja z kursorem nie jest zamykana (kursor zostaje, obserwacja
 * wraca w następnym przebiegu), a błąd liczy się do `bledy`.
 */
async function wczytajStrumien({ od, budzetOdczytow, czyPrzerwac }) {
  if (!od) return { wiersze: [], wyczerpano: true, przejrzanoDo: null, przeczytano: 0, zapytan: 0, blad: null };
  try {
    return { ...await tenders.noweOd({ od, budzetOdczytow, czyPrzerwac }), blad: null };
  } catch (err) {
    logger.error({ err: err.message, od }, 'Monitoring: nie udało się odczytać strumienia nowych ogłoszeń');
    return { wiersze: [], wyczerpano: false, przejrzanoDo: null, przeczytano: 0, zapytan: 0, blad: err.message };
  }
}

/**
 * Budżet czasu CAŁEGO przebiegu obserwacji (2026-09-25).
 *
 * `monitorWyszukiwan` w index.js ma `timeoutSeconds: 540` i po tym jobie woła jeszcze
 * monitoring planów. Bez budżetu platforma zabijała funkcję w połowie partii — bez
 * śladu, a przy kolejności z bazy zawsze na tych samych kontach. Po 360 s nie
 * zaczynamy kolejnej obserwacji; nieobsłużone zostają wymagalne i dzięki rotacji
 * (`kolejnoscObslugi`) idą na czoło następnego przebiegu. Zostaje 180 s na plany.
 */
export const BUDZET_CZASU_MS = 360_000;

/**
 * @param {{teraz?: string, wyslijPush?: Function, wyslijEmail?: Function,
 *   budzetOdczytow?: number, budzetCzasuStrumieniaMs?: number, budzetCzasuMs?: number,
 *   zegar?: () => number}} opcje
 *   wysyłka wstrzykiwana — testy sprawdzają DECYZJE joba, nie dostępność Expo
 */
export async function runMonitorWyszukiwan({
  teraz = nowIso(),
  wyslijPush = sendPush,
  wyslijEmail = sendEmail,
  budzetOdczytow = BUDZET_ODCZYTOW_NOWYCH,
  budzetCzasuStrumieniaMs = BUDZET_CZASU_STRUMIENIA_MS,
  budzetCzasuMs = BUDZET_CZASU_MS,
  zegar = () => Date.now(),
} = {}) {
  const start = zegar();

  const wszystkie = await wyszukiwania.zAlertem();
  const wymagalne = kolejnoscObslugi(wszystkie.filter((w) => czyNalezySprawdzic(w, teraz)));

  const wynikPusty = {
    ok: true,
    wlaczone: wszystkie.length,
    sprawdzone: 0,
    pominiete: wszystkie.length - wymagalne.length,
    noweTrafienia: 0,
    zmiany: 0,
    alerty: 0,
    push: 0,
    email: 0,
    bledy: 0,
    // Obserwacje, do których przerwany strumień nie doszedł — wracają w następnym przebiegu.
    odlozone: 0,
    // Budżet czasu skończył się przed końcem partii — reszta idzie w następnym przebiegu.
    przerwano: false,
    nieobsluzone: 0,
    strumien: { od: null, przeczytano: 0, zapytan: 0, wyczerpano: true, przejrzano_do: null },
    durationMs: zegar() - start,
  };
  if (!wymagalne.length) return wynikPusty;

  /*
   * Historia zmian: JEDEN odczyt na całą partię. `od` = najstarsze sprawdzenie
   * w partii, przycięte do sufitu dni (patrz `oknoOdczytuZmian`).
   */
  const od = oknoOdczytuZmian(wymagalne, teraz);
  const zmianyPartii = od ? await historiaZmian.odCzasu(od).catch((err) => {
    // Brak historii degraduje przebieg do „tylko nowe trafienia", ale go nie wywraca.
    logger.error({ err: err.message }, 'Monitoring: nie udało się odczytać historii zmian');
    return [];
  }) : [];
  const tenderyZmian = await wczytajTenderyZmian(zmianyPartii);

  /*
   * Nowe ogłoszenia: JEDEN odczyt na partię, od najstarszego kursora, rosnąco
   * (naprawa 2026-09-25). Dawniej każde wyszukiwanie czytało 50 najnowszych pozycji
   * katalogu, więc trafienie przykryte ponad 1200 nowszymi ogłoszeniami nie było
   * zgłaszane nigdy. Dopasowanie do filtrów robi w pamięci ten sam predykat, którego
   * używa katalog (`pasujeDoFiltrow`) — zbiór trafień jest więc identyczny z tym,
   * co użytkownik widzi na liście.
   */
  const odNowych = oknoOdczytuNowych(wymagalne, teraz);
  const strumien = await wczytajStrumien({
    od: odNowych,
    budzetOdczytow,
    czyPrzerwac: () => zegar() - start >= budzetCzasuStrumieniaMs,
  });
  const opisStrumienia = { od: odNowych, przejrzanoDo: strumien.przejrzanoDo, wyczerpano: strumien.wyczerpano };
  /*
   * Punkt „od teraz" dla obserwacji sprawdzanych pierwszy raz: najświeższe ogłoszenie
   * w bazie, a nie najświeższe TRAFIENIE — to drugie bywa stare, a wtedy wszystko
   * nowsze od niego (także niepasujące) byłoby czytane ponownie w każdym przebiegu.
   */
  const kursorStartowy = wymagalne.some((w) => !w.kursor?.fetched_at)
    ? await tenders.najnowszyFetchedAt().catch(() => null)
    : null;

  // Dokument użytkownika pobieramy RAZ na konto, nawet gdy ma kilka obserwacji.
  const uzytkownicy = new Map();
  const uzytkownik = async (id) => {
    if (!uzytkownicy.has(id)) uzytkownicy.set(id, await users.findById(id).catch(() => null));
    return uzytkownicy.get(id);
  };

  const wynik = {
    ...wynikPusty,
    pominiete: wszystkie.length - wymagalne.length,
    sprawdzoneId: [],
    strumien: {
      od: odNowych,
      przeczytano: strumien.przeczytano,
      zapytan: strumien.zapytan,
      wyczerpano: strumien.wyczerpano,
      przejrzano_do: strumien.przejrzanoDo,
    },
  };
  // Nieudany odczyt rynku to błąd przebiegu (Scheduler ponowi), choć obserwacje przeżyją.
  if (strumien.blad) wynik.bledy += 1;

  for (const [i, w] of wymagalne.entries()) {
    // Budżet sprawdzamy PRZED obserwacją: zaczętej nie przerywamy w pół wysyłki.
    if (zegar() - start >= budzetCzasuMs) {
      wynik.przerwano = true;
      wynik.nieobsluzone = wymagalne.length - i;
      logger.warn({ nieobsluzone: wynik.nieobsluzone, budzetCzasuMs },
        'Monitoring: budżet czasu wyczerpany — reszta obserwacji w następnym przebiegu');
      break;
    }
    try {
      /*
       * SORTOWANIE NADPISUJEMY NA „najnowsze" — świadomie, wbrew temu, co zapisał
       * użytkownik.
       *
       * Sortowanie jest preferencją WYŚWIETLANIA, nie częścią obserwowanego zbioru
       * (dlatego odcisk obserwacji je pomija). `pasujeDoFiltrow` przy `sort: 'termin'`
       * odrzuca ogłoszenia BEZ terminu (lista po terminie nie ma gdzie ich postawić),
       * więc obserwacja z takim sortowaniem milczałaby o nowych ogłoszeniach TED i BK
       * bez podanego terminu. Dawniej skutek był jeszcze gorszy: zapytanie katalogu
       * szło po terminie i świeżo pobrane ogłoszenie z odległym terminem w ogóle nie
       * pojawiało się na stronie skanu (zmierzone na emulatorze).
       */
      const filtry = { ...normalizujFiltry(w.filtry ?? {}), sort: 'najnowsze' };
      const odKursora = w.kursor?.fetched_at ?? null;
      const kandydaci = odKursora
        ? strumien.wiersze.filter((t) => t.fetched_at > odKursora && pasujeDoFiltrow(t, filtry, teraz))
        : [];

      const nowe = noweTrafienia({
        tenders: kandydaci, kursor: w.kursor, teraz, strumien: opisStrumienia, kursorStartowy,
      });
      if (nowe.nieobjete) {
        /*
         * Przerwany strumień nie doszedł do kursora tej obserwacji — nie obejrzeliśmy
         * dla niej niczego nowego. Zostawiamy ją NIETKNIĘTĄ (bez checkpointu, bez
         * alertu zmian), więc zostaje wymagalna i następny przebieg ją podejmie.
         */
        wynik.odlozone += 1;
        continue;
      }
      const trafieniaZmian = zmianyDlaWyszukiwania({
        zmiany: zmianyPartii,
        tenderyById: tenderyZmian,
        filtry: w.filtry,
        teraz,
        od: w.ostatnio_sprawdzone_o ?? null,
      });

      const doWyslania = [];
      if (nowe.pozycje.length) {
        doWyslania.push(zbudujAlertNowych({
          wyszukiwanie: w,
          pozycje: nowe.pozycje,
          // Obejrzany odcinek nie pokrył całego okna obserwacji (przerwany strumień
          // albo kursor sprzed sufitu dni) — „jest tego więcej, niż zdążyliśmy policzyć".
          conajmniej: nowe.conajmniej,
        }));
      }
      if (trafieniaZmian.length) {
        doWyslania.push(zbudujAlertZmian({ wyszukiwanie: w, trafienia: trafieniaZmian }));
      }

      wynik.noweTrafienia += nowe.pozycje.length;
      wynik.zmiany += trafieniaZmian.length;

      for (const alert of doWyslania) {
        const { nowy } = await alerty.dodaj(w.userId, alert, teraz);
        wynik.alerty += 1;
        /*
         * Powiadomienie idzie WYŁĄCZNIE przy pierwszym zapisie alertu. Przy ponowieniu
         * przebiegu (awaria między wysyłką a checkpointem) `dodaj` zwraca `nowy: false`
         * i człowiek nie dostaje tego samego dwa razy.
         */
        if (!nowy) continue;
        const kanal = await dostarcz({
          user: await uzytkownik(w.userId), alert, wyslijPush, wyslijEmail,
        });
        if (kanal === 'push') wynik.push += 1;
        if (kanal === 'email') wynik.email += 1;
      }

      /*
       * Checkpoint zapisujemy PO wysyłce. Odwrotna kolejność gubiłaby trafienia bez
       * śladu, gdyby przebieg padł w środku; ta najwyżej powtarza wysyłkę — a powtórkę
       * odsiewa klucz alertu.
       */
      await wyszukiwania.oznaczSprawdzone(w.userId, w.id, {
        teraz,
        kursor: nowe.nowyKursor,
        trafien: nowe.pozycje.length + trafieniaZmian.length,
      });

      wynik.sprawdzone += 1;
      wynik.sprawdzoneId.push(w.id);
    } catch (err) {
      wynik.bledy += 1;
      logger.error({ err: err.message, userId: w.userId, wyszukiwanieId: w.id },
        'Monitoring: obserwacja pominięta z powodu błędu');
    }
  }

  wynik.durationMs = zegar() - start;
  // `ok: false` przy jakimkolwiek błędzie — Cloud Scheduler ponowi, a ponowienie
  // jest bezpieczne (klucz alertu = docId, checkpoint idempotentny).
  wynik.ok = wynik.bledy === 0;

  logger.info(wynik, 'runMonitorWyszukiwan: zakończono');
  return wynik;
}
