import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * HARMONOGRAM MONITORINGU (etap 5) — test integracyjny na emulatorze.
 *
 * Wysyłka jest WSTRZYKIWANA, bo test ma sprawdzić DECYZJE joba (kogo obudzić, ile
 * razy, czym), a nie to, czy Expo odpowiada. Ta sama konstrukcja co w `runTenderFetch`,
 * gdzie wstrzykuje się rejestr źródeł.
 *
 * Najważniejsza właściwość, której pilnujemy: żadna ścieżka tego joba nie dotyka
 * płatnego AI. Monitoring chodzi co 2 h dla wszystkich kont — jedno wywołanie modelu
 * na wyszukiwanie zamieniłoby go w maszynkę do palenia budżetu.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { runMonitorWyszukiwan } = await import('../src/jobs/monitorWyszukiwan.js');
const { wyszukiwania, alerty, tenders, users } = await import('../src/db/repos.js');

let seq = 0;
const nast = () => ++seq;

/**
 * Unikalny kod CPV o DOKŁADNIE 8 cyfrach.
 *
 * Normalizator katalogu przycina CPV do 8 znaków, więc kod dziewięciocyfrowy
 * zapisywał się na ogłoszeniu w całości, a w filtrze lądował obcięty — i filtr
 * przestawał trafiać. Pułapka jest cicha: wcześniejsze przebiegi licznika (do 9)
 * dawały poprawną długość i testy przechodziły.
 */
const unikalneCpv = () => `45${String(nast()).padStart(6, '0')}`;

/*
 * Znaczniki czasu dla testów ZMIAN muszą leżeć na tej samej osi co zegar.
 *
 * `zaktualizujZeZrodla` stempluje wykrytą zmianę REALNYM czasem (to on trafia do
 * historii na produkcji). Sztywna data „teraz" z przyszłości sprawiała, że zmiana
 * wypadała PRZED ostatnim sprawdzeniem i harmonogram słusznie ją pomijał — test
 * mierzyłby wtedy własną scenografię, a nie zachowanie joba.
 */
const zaChwile = () => new Date(Date.now() + 60_000).toISOString();
/*
 * Dwie doby, nie godzina: domyślna częstotliwość to „raz dziennie", więc obserwacja
 * sprawdzona godzinę temu jest zatrzymywana przez hamulec i job w ogóle jej nie
 * dotyka. Test zmian musi ustawić punkt odniesienia POZA odstępem, inaczej mierzy
 * hamulec zamiast wykrywania zmian.
 */
const dwaDniTemu = () => new Date(Date.now() - 2 * 86_400_000).toISOString();

async function konto({ push = 'ExponentPushToken[xxx]' } = {}) {
  const u = await users.create({
    email: `mon-${process.pid}-${nast()}-${Date.now()}@t.pl`,
    passwordHash: 'x',
    keywords: [],
    cpvCodes: [],
  });
  if (push) await users.setPushToken(u.id, push);
  return u.id;
}

/** Przetarg z UNIKALNYM znacznikiem CPV, żeby filtr wyszukiwania trafiał tylko w niego. */
async function przetarg(cpv, over = {}) {
  const { tender } = await tenders.upsert({
    externalId: `mon-${process.pid}-${nast()}`,
    title: 'Przebudowa drogi gminnej',
    organization: 'Gmina Testowa',
    source: 'bzp',
    cpvMain: cpv,
    deadline: '2099-01-01T00:00:00.000Z',
    ...over,
  });
  return tender;
}

function zbierak() {
  const pushe = [];
  const maile = [];
  return {
    pushe,
    maile,
    wyslijPush: async (token, tresc) => { pushe.push({ token, tresc }); return { sent: 1, failed: 0 }; },
    wyslijEmail: async (wiadomosc) => { maile.push(wiadomosc); return { sent: true }; },
  };
}

test('PIERWSZY przebieg nowego wyszukiwania nie budzi nikogo, ale zapisuje punkt odniesienia', async () => {
  const cpv = unikalneCpv();
  await przetarg(cpv);
  const u = await konto();
  const w = await wyszukiwania.create(u, { nazwa: 'Drogi', filtry: { cpv }, odcisk: `o-${nast()}` });

  const z = zbierak();
  const wynik = await runMonitorWyszukiwan({ teraz: '2026-09-24T12:00:00.000Z', ...z });

  assert.equal(wynik.ok, true);
  assert.equal(z.pushe.length, 0, 'zastany rynek to nie nowość');
  assert.deepEqual(await alerty.lista(u), []);

  const po = await wyszukiwania.get(u, w.id);
  assert.equal(po.ostatnio_sprawdzone_o, '2026-09-24T12:00:00.000Z');
  assert.ok(po.kursor?.fetched_at, 'bez punktu odniesienia następny przebieg zgłosiłby cały rynek');
});

test('nowe ogłoszenie po punkcie odniesienia daje JEDEN alert i JEDEN push', async () => {
  const cpv = unikalneCpv();
  const u = await konto();
  const w = await wyszukiwania.create(u, { nazwa: 'Drogi', filtry: { cpv }, odcisk: `o-${nast()}` });
  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: '2026-09-23T12:00:00.000Z',
    kursor: { fetched_at: '2026-09-23T12:00:00.000Z' },
  });

  await przetarg(cpv); // fetched_at = teraz rzeczywiste, czyli po punkcie odniesienia

  const z = zbierak();
  const wynik = await runMonitorWyszukiwan({ teraz: '2026-09-25T12:00:00.000Z', ...z });

  assert.equal(wynik.noweTrafienia >= 1, true);
  assert.equal(z.pushe.length, 1);
  assert.equal(z.pushe[0].tresc.data.type, 'nowe_trafienia');

  const lista = await alerty.lista(u);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].typ, 'nowe_trafienia');
  assert.equal(lista[0].przeczytany, false);
});

test('powtórzony przebieg NIE wysyła tego samego alertu drugi raz', async () => {
  const cpv = unikalneCpv();
  const u = await konto();
  const w = await wyszukiwania.create(u, { nazwa: 'Drogi', filtry: { cpv }, odcisk: `o-${nast()}` });
  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: '2026-09-23T12:00:00.000Z', kursor: { fetched_at: '2026-09-23T12:00:00.000Z' },
  });
  await przetarg(cpv);

  const pierwszy = zbierak();
  await runMonitorWyszukiwan({ teraz: '2026-09-25T12:00:00.000Z', ...pierwszy });

  // Symulujemy ponowienie po awarii MIĘDZY wysyłką a zapisem checkpointu.
  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: '2026-09-23T12:00:00.000Z', kursor: { fetched_at: '2026-09-23T12:00:00.000Z' },
  });

  const drugi = zbierak();
  await runMonitorWyszukiwan({ teraz: '2026-09-25T13:00:00.000Z', ...drugi });

  assert.equal((await alerty.lista(u)).length, 1, 'idempotencja po kluczu alertu');
  assert.equal(drugi.pushe.length, 0, 'znany alert nie idzie pushem po raz drugi');
});

test('hamulec częstotliwości: sprawdzone godzinę temu wyszukiwanie dzienne jest pomijane', async () => {
  const u = await konto();
  const w = await wyszukiwania.create(u, {
    nazwa: 'Dzienne', filtry: { cpv: unikalneCpv() }, czestotliwosc: 'dzienna', odcisk: `o-${nast()}`,
  });
  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: '2026-09-25T11:00:00.000Z', kursor: { fetched_at: '2026-09-25T11:00:00.000Z' },
  });

  const wynik = await runMonitorWyszukiwan({ teraz: '2026-09-25T12:00:00.000Z', ...zbierak() });

  const po = await wyszukiwania.get(u, w.id);
  assert.equal(po.ostatnio_sprawdzone_o, '2026-09-25T11:00:00.000Z', 'pominięte = nietknięte');
  assert.ok(wynik.pominiete >= 1);
});

test('wyłączony alert nie jest nawet czytany przez harmonogram', async () => {
  const u = await konto();
  const w = await wyszukiwania.create(u, {
    nazwa: 'Wyłączone', filtry: { cpv: unikalneCpv() }, alert_wlaczony: false, odcisk: `o-${nast()}`,
  });

  const wynik = await runMonitorWyszukiwan({ teraz: '2026-09-25T12:00:00.000Z', ...zbierak() });

  assert.equal((wynik.sprawdzoneId ?? []).includes(w.id), false, 'wyłączona obserwacja nie weszła do partii');
  assert.deepEqual(await alerty.lista(u), []);
});

test('ISTOTNA zmiana obserwowanego ogłoszenia (skrócony termin) budzi alarm', async () => {
  const cpv = unikalneCpv();
  const t = await przetarg(cpv, { deadline: '2099-06-01T10:00:00.000Z' });
  const u = await konto();
  const w = await wyszukiwania.create(u, { nazwa: 'Drogi', filtry: { cpv }, odcisk: `o-${nast()}` });

  // Punkt odniesienia PO utworzeniu przetargu — nie jest już „nowy".
  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: dwaDniTemu(), kursor: { fetched_at: '2099-01-01T00:00:00.000Z' },
  });

  await tenders.zaktualizujZeZrodla({ externalId: t.bzp_external_id, deadline: '2099-05-01T10:00:00.000Z' });

  const z = zbierak();
  const wynik = await runMonitorWyszukiwan({ teraz: zaChwile(), ...z });

  assert.ok(wynik.zmiany >= 1);
  const lista = await alerty.lista(u);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].typ, 'zmiany');
  assert.equal(lista[0].ton, 'danger', 'skrócony termin to alarm, nie informacja');
  assert.equal(z.pushe.length, 1);
});

test('NIEISTOTNA zmiana (poprawka tytułu) nie generuje ani alertu, ani pusha', async () => {
  const cpv = unikalneCpv();
  const t = await przetarg(cpv);
  const u = await konto();
  const w = await wyszukiwania.create(u, { nazwa: 'Drogi', filtry: { cpv }, odcisk: `o-${nast()}` });
  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: dwaDniTemu(), kursor: { fetched_at: '2099-01-01T00:00:00.000Z' },
  });

  await tenders.zaktualizujZeZrodla({ externalId: t.bzp_external_id, title: 'Przebudowa drogi gminnej nr 4' });

  const z = zbierak();
  await runMonitorWyszukiwan({ teraz: zaChwile(), ...z });

  assert.deepEqual(await alerty.lista(u), []);
  assert.equal(z.pushe.length, 0);
});

test('konto bez tokenu push dostaje e-mail zamiast niczego', async () => {
  const cpv = unikalneCpv();
  const u = await konto({ push: null });
  const w = await wyszukiwania.create(u, { nazwa: 'Bez pusha', filtry: { cpv }, odcisk: `o-${nast()}` });
  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: '2026-09-23T12:00:00.000Z', kursor: { fetched_at: '2026-09-23T12:00:00.000Z' },
  });
  await przetarg(cpv);

  const z = zbierak();
  await runMonitorWyszukiwan({ teraz: '2026-09-25T12:00:00.000Z', ...z });

  /*
   * Asercja celuje w KONKRETNE konto, a nie w globalne liczniki: emulator jest
   * wspólny dla całego pliku, więc w tym samym przebiegu mogą być wymagalne także
   * obserwacje z wcześniejszych testów.
   */
  const mojMail = z.maile.filter((m) => /Bez pusha/.test(m.subject));
  assert.equal(mojMail.length, 1, 'konto bez tokenu MUSI dostać e-mail');
  assert.equal(z.pushe.some((p) => /Bez pusha/.test(p.tresc.title)), false,
    'i na pewno nie push — nie ma na co go wysłać');
});

test('awaria wysyłki dla jednego konta nie przerywa partii i jest policzona', async () => {
  const cpvA = unikalneCpv();
  const cpvB = unikalneCpv();
  const a = await konto();
  const b = await konto();

  for (const [u, cpv, nazwa] of [[a, cpvA, 'A'], [b, cpvB, 'B']]) {
    const w = await wyszukiwania.create(u, { nazwa, filtry: { cpv }, odcisk: `o-${nast()}` });
    await wyszukiwania.oznaczSprawdzone(u, w.id, {
      teraz: '2026-09-23T12:00:00.000Z', kursor: { fetched_at: '2026-09-23T12:00:00.000Z' },
    });
    await przetarg(cpv);
  }

  let wywolania = 0;
  const wynik = await runMonitorWyszukiwan({
    teraz: '2026-09-25T12:00:00.000Z',
    wyslijPush: async () => {
      wywolania += 1;
      if (wywolania === 1) throw new Error('Expo padło');
      return { sent: 1, failed: 0 };
    },
    wyslijEmail: async () => ({ sent: true }),
  });

  assert.equal(wywolania, 2, 'druga obserwacja MUSI zostać obsłużona mimo awarii pierwszej');
  assert.ok(wynik.bledy >= 1);
  // Job zgłasza niepowodzenie, żeby Cloud Scheduler ponowił przebieg.
  assert.equal(wynik.ok, false);
});

test('przebieg bez wymagalnych wyszukiwań kończy się czystym, tanim wynikiem', async () => {
  const wynik = await runMonitorWyszukiwan({ teraz: '2020-01-01T00:00:00.000Z', ...zbierak() });
  assert.equal(wynik.ok, true);
  assert.equal(typeof wynik.durationMs, 'number');
  assert.equal(typeof wynik.sprawdzone, 'number');
});

test('KRYTYCZNE: harmonogram monitoringu nie ma żadnej drogi do płatnego AI', () => {
  /*
   * Monitoring chodzi co 2 h dla WSZYSTKICH kont. Jedno wywołanie modelu na
   * wyszukiwanie zamieniłoby go w maszynkę do palenia budżetu, a skutek byłby
   * widoczny dopiero na fakturze. Strażnik czyta źródło zamiast ufać deklaracji.
   */
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const surowe = fs.readFileSync(path.resolve(__dirname, '../src/jobs/monitorWyszukiwan.js'), 'utf8');
  // Komentarze wycinamy PRZED sprawdzeniem: bez tego strażnik łapie własne
  // uzasadnienie w nagłówku pliku zamiast realnego importu.
  const kod = surowe.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.equal(/services\/ai\.js/.test(kod), false, 'job importuje usługę AI');
  assert.equal(/anthropic/i.test(kod), false);
  assert.equal(/summarizeTender|scoreMatch/i.test(kod), false);
});

test('OBIETNICA 6 GODZIN jest poparta kadencją harmonogramów, nie deklaracją', () => {
  /*
   * Produkt obiecuje: zmiana terminu dociera do wykonawcy w ciągu 6 godzin. Ta
   * obietnica składa się SZEREGOWO z dwóch opóźnień i żadne z nich nie jest widoczne
   * w kodzie joba:
   *   wykrycie      — okna źródeł (bzpOknoFetch, bkOknoFetch) chodzą co 3 h,
   *   powiadomienie — monitorWyszukiwan.
   * Ten strażnik czyta crony z index.js i liczy najgorszy przypadek. Bez niego
   * rozluźnienie kadency „bo taniej" po cichu unieważniłoby obietnicę.
   */
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const index = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');

  const coIleGodzin = (nazwaFunkcji) => {
    const blok = index.slice(index.indexOf(`export const ${nazwaFunkcji}`));
    const cron = blok.match(/schedule: '([^']+)'/)?.[1];
    assert.ok(cron, `brak harmonogramu dla ${nazwaFunkcji}`);
    const godziny = cron.split(' ')[1];
    const co = godziny.match(/^\*\/(\d+)$/);
    return co ? Number(co[1]) : 24;
  };

  const wykrycie = Math.max(coIleGodzin('bzpOknoFetch'), coIleGodzin('bkOknoFetch'));
  const powiadomienie = coIleGodzin('monitorWyszukiwan');

  assert.ok(wykrycie + powiadomienie <= 6,
    `najgorszy przypadek to ${wykrycie} h wykrycia + ${powiadomienie} h powiadomienia = `
    + `${wykrycie + powiadomienie} h, a obiecujemy 6 h`);
});

test('obserwacja z sortowaniem po TERMINIE nadal wykrywa nowe ogloszenia', async () => {
  /*
   * Sortowanie jest preferencja WYSWIETLANIA, nie czescia obserwowanego zbioru —
   * dlatego odcisk wyszukiwania je pomija. Harmonogram musi to uszanowac: wykrywanie
   * nowosci opiera sie na `fetched_at`, wiec zapytanie do katalogu MUSI isc
   * posortowane po dacie pobrania. Przepuszczenie `sort: 'termin'` dawaloby 50
   * ogloszen o najblizszym terminie — wsrod ktorych swiezo pobranego zwykle nie ma,
   * bo jego termin jest odlegly. Obserwacja milczalaby, nie zglaszajac bledu.
   */
  const cpv = unikalneCpv();
  const u = await konto();
  const w = await wyszukiwania.create(u, {
    nazwa: 'Po terminie', filtry: { cpv, sort: 'termin' }, odcisk: `o-${nast()}`,
  });
  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: dwaDniTemu(), kursor: { fetched_at: dwaDniTemu() },
  });

  /*
   * Wypelniacz: 52 ogloszenia z BLISKIMI terminami. Przy sortowaniu po terminie
   * zajmuja cala pierwsza strone skanu (sufit to 50 pozycji na przebieg), wiec
   * ogloszenie z odleglym terminem wypada POZA nia. Bez tego tla test przechodzilby
   * niezaleznie od sortowania i nie mierzylby niczego.
   */
  for (let i = 0; i < 52; i += 1) {
    await przetarg(cpv, { deadline: `2027-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z` });
  }

  /*
   * Punkt odniesienia USTAWIAMY PO wypelniaczu i BEZ cofania zegara. Wczesniejsza
   * wersja tego testu brala `Date.now() - 1000`, a zapis 52 ogloszen trwa dluzej niz
   * sekunde — czesc wypelniacza wpadala wiec do okna nowosci i test przechodzil
   * z zupelnie innego powodu, niz mierzyl.
   */
  const granica = new Date().toISOString();
  await wyszukiwania.oznaczSprawdzone(u, w.id, { teraz: dwaDniTemu(), kursor: { fetched_at: granica } });

  // Ogloszenie z BARDZO odleglym terminem: przy sortowaniu po terminie wypada
  // daleko poza pierwsza strone, przy sortowaniu po dacie pobrania jest pierwsze.
  await przetarg(cpv, { deadline: '2099-12-31T10:00:00.000Z' });

  const z = zbierak();
  const wynik = await runMonitorWyszukiwan({ teraz: zaChwile(), ...z });

  assert.ok(wynik.noweTrafienia >= 1, 'nowe ogloszenie nie zostalo wykryte');
  assert.equal((await alerty.lista(u)).length, 1);
});

/*
 * UTRATA TRAFIEŃ PRZYKRYTYCH NOWSZYMI OGŁOSZENIAMI (naprawa 2026-09-25).
 *
 * Dawniej każde wyszukiwanie czytało stronę 50 najnowszych pozycji katalogu, a skan
 * katalogu kończył się po 1200 dokumentach. Tydzień rynku to ~5700 ogłoszeń, doba
 * ~950 — trafienie przykryte ponad 1200 nowszymi nie było zgłaszane NIGDY, a kursor
 * przeskakiwał ponad nie na najnowsze trafienie.
 */

/**
 * Wyłącza obserwacje z WCZEŚNIEJSZYCH testów (emulator jest wspólny dla pliku).
 * Strumień nowych ogłoszeń czyta się od NAJSTARSZEGO kursora w partii, więc test
 * budżetu odczytów mierzyłby cudze kursory zamiast własnego scenariusza.
 */
async function wylaczInneObserwacje() {
  const { getFirestore } = await import('firebase-admin/firestore');
  const snap = await getFirestore().collectionGroup('wyszukiwania').where('alert_wlaczony', '==', true).get();
  await Promise.all(snap.docs.map((d) => d.ref.update({ alert_wlaczony: false })));
}

test('REGRESJA: trafienie przykryte 1250 nowszymi ogłoszeniami MUSI trafić do alertu', async () => {
  await wylaczInneObserwacje();
  const cpv = unikalneCpv();
  const u = await konto();
  const w = await wyszukiwania.create(u, {
    nazwa: 'Tygodniowe', filtry: { cpv }, czestotliwosc: 'tygodniowa', odcisk: `o-${nast()}`,
  });
  const osiemDniTemu = new Date(Date.now() - 8 * 86_400_000).toISOString();
  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: osiemDniTemu, kursor: { fetched_at: new Date(Date.now() - 1000).toISOString() },
  });

  const t1 = await przetarg(cpv); // NOWE trafienie — to ono ma przyjść w alercie

  // Więcej niż dawny sufit skanu katalogu (1200) — na produkcji to niecałe półtorej doby.
  for (let i = 0; i < 1250; i += 50) {
    await Promise.all(Array.from({ length: 50 }, () => przetarg('33000000')));
  }

  const z = zbierak();
  const wynik = await runMonitorWyszukiwan({ teraz: zaChwile(), ...z });
  assert.equal(wynik.ok, true);

  const zgloszone = (await alerty.lista(u)).flatMap((a) => a.pozycje.map((p) => p.tender_id));
  assert.ok(zgloszone.includes(t1.id), 'T1 nie zostało zgłoszone — trafienie przepadło pod nowszymi');

  const po = await wyszukiwania.get(u, w.id);
  assert.ok(po.kursor.fetched_at >= t1.fetched_at, 'kursor przeszedł za T1 dopiero po jego zgłoszeniu');

  // Kolejny przebieg nie zgłasza T1 drugi raz.
  const t2 = await przetarg(cpv);
  await wyszukiwania.oznaczSprawdzone(u, w.id, { teraz: osiemDniTemu, kursor: po.kursor });
  await runMonitorWyszukiwan({ teraz: zaChwile(), ...zbierak() });
  const alertyPo = await alerty.lista(u);
  const zDrugiego = alertyPo.filter((a) => a.pozycje.some((p) => p.tender_id === t2.id));
  assert.equal(zDrugiego.length, 1, 'T2 zgłoszone w kolejnym przebiegu');
  assert.equal(zDrugiego[0].pozycje.some((p) => p.tender_id === t1.id), false, 'T1 nie wraca drugi raz');
});

test('budżet odczytów przerywa strumień: „co najmniej N", kursor na granicy, reszta w następnym przebiegu', async () => {
  await wylaczInneObserwacje();
  const cpv = unikalneCpv();
  const u = await konto();
  const w = await wyszukiwania.create(u, { nazwa: 'Budżet', filtry: { cpv }, odcisk: `o-${nast()}` });
  // Kursor = TERAZ, nie „sekundę temu": ogłoszenia poprzedniego testu z tej samej
  // sekundy zajęłyby budżet 20 odczytów i test mierzyłby cudzy wypełniacz.
  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: dwaDniTemu(), kursor: { fetched_at: new Date().toISOString() },
  });
  await new Promise((r) => { setTimeout(r, 5); });

  const t1 = await przetarg(cpv);
  // Wypełniacz zapisywany PO KOLEI, żeby znaczniki `fetched_at` się różniły.
  for (let i = 0; i < 30; i += 1) await przetarg('33000000');
  const t2 = await przetarg(cpv);

  const z = zbierak();
  const pierwszy = await runMonitorWyszukiwan({ teraz: zaChwile(), budzetOdczytow: 20, ...z });
  assert.equal(pierwszy.strumien.wyczerpano, false, 'budżet 20 dokumentów nie obejmuje 32 nowych');

  const [alertA] = await alerty.lista(u);
  assert.deepEqual(alertA.pozycje.map((p) => p.tender_id), [t1.id]);
  assert.match(alertA.tytul.pl, /co najmniej/, 'przerwany strumień nie udaje dokładnej liczby');

  const po = await wyszukiwania.get(u, w.id);
  assert.ok(po.kursor.fetched_at >= t1.fetched_at);
  assert.ok(po.kursor.fetched_at < t2.fetched_at, 'kursor NIE przeskoczył nieobejrzanego T2');

  await wyszukiwania.oznaczSprawdzone(u, w.id, { teraz: dwaDniTemu(), kursor: po.kursor });
  await runMonitorWyszukiwan({ teraz: zaChwile(), ...zbierak() });

  const lista = await alerty.lista(u);
  const zgloszone = lista.flatMap((a) => a.pozycje.map((p) => p.tender_id));
  assert.ok(zgloszone.includes(t2.id), 'T2 dotarło w następnym przebiegu');
  assert.equal(zgloszone.filter((id) => id === t1.id).length, 1, 'T1 zgłoszone dokładnie raz');
});
