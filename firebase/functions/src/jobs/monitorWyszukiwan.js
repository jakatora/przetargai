import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import {
  wyszukiwania, alerty, historiaZmian, tenders, users,
} from '../db/repos.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';
import { czyNalezySprawdzic } from '../lib/zapisaneWyszukiwania.js';
import { normalizujFiltry } from '../lib/katalogPrzetargow.js';
import {
  noweTrafienia, zmianyDlaWyszukiwania, zbudujAlertNowych, zbudujAlertZmian,
  trescPush, oknoOdczytuZmian,
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
 * Ile ogłoszeń przeglądamy na JEDNO wyszukiwanie w jednym przebiegu.
 *
 * To sufit kosztu, nie granica prawdy: gdy strona wyjdzie pełna, alert mówi
 * „co najmniej N", a nie zmyśloną dokładną liczbę.
 */
const MAKS_TRAFIEN_NA_PRZEBIEG = 50;

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
async function dostarcz({ user, alert, wyslijPush, wyslijEmail }) {
  const tresc = trescPush(alert);

  if (user?.push_token) {
    await wyslijPush(user.push_token, tresc);
    return 'push';
  }
  if (user?.email) {
    await wyslijEmail({
      to: user.email,
      subject: tresc.title,
      text: tresc.body,
      html: `<p>${tresc.body}</p>`,
    });
    return 'email';
  }
  return 'brak';
}

/**
 * @param {{teraz?: string, wyslijPush?: Function, wyslijEmail?: Function}} opcje
 *   wysyłka wstrzykiwana — testy sprawdzają DECYZJE joba, nie dostępność Expo
 */
export async function runMonitorWyszukiwan({
  teraz = nowIso(),
  wyslijPush = sendPush,
  wyslijEmail = sendEmail,
} = {}) {
  const start = Date.now();

  const wszystkie = await wyszukiwania.zAlertem();
  const wymagalne = wszystkie.filter((w) => czyNalezySprawdzic(w, teraz));

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
    durationMs: Date.now() - start,
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
  };

  for (const w of wymagalne) {
    try {
      /*
       * SORTOWANIE NADPISUJEMY NA „najnowsze" — świadomie, wbrew temu, co zapisał
       * użytkownik.
       *
       * Sortowanie jest preferencją WYŚWIETLANIA, nie częścią obserwowanego zbioru
       * (dlatego odcisk obserwacji je pomija). Wykrywanie nowości opiera się na
       * `fetched_at`, więc zapytanie MUSI iść w tym porządku. Przepuszczenie
       * `sort: 'termin'` dawało stronę ogłoszeń o najbliższym terminie — a świeżo
       * pobranego zwykle wśród nich nie ma, bo jego termin jest odległy. Zmierzone
       * na emulatorze: przy 52 ogłoszeniach z bliskim terminem nowe ogłoszenie
       * z terminem w 2099 NIE pojawiało się na stronie skanu w ogóle.
       *
       * Awaria była CICHA: obserwacja po prostu milczała, nie zgłaszając błędu.
       */
      const filtry = {
        ...normalizujFiltry(w.filtry ?? {}),
        sort: 'najnowsze',
        limit: MAKS_TRAFIEN_NA_PRZEBIEG,
      };
      const katalog = await tenders.katalog({ filtry, teraz, kursor: null });

      const nowe = noweTrafienia({ tenders: katalog.wiersze, kursor: w.kursor, teraz });
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
          // Pełna strona znaczy „jest tego więcej, niż zdążyliśmy policzyć".
          conajmniej: katalog.wiersze.length >= MAKS_TRAFIEN_NA_PRZEBIEG,
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

  wynik.durationMs = Date.now() - start;
  // `ok: false` przy jakimkolwiek błędzie — Cloud Scheduler ponowi, a ponowienie
  // jest bezpieczne (klucz alertu = docId, checkpoint idempotentny).
  wynik.ok = wynik.bledy === 0;

  logger.info(wynik, 'runMonitorWyszukiwan: zakończono');
  return wynik;
}
