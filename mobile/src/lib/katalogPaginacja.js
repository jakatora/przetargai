import { scalStrone } from './katalogPrzetargow.js';

/**
 * Jedna lista, jeden zestaw parametrów i jeden właściciel kursora.
 * Serwer ogranicza koszt POJEDYNCZEGO skanu, nie liczbę wyników. Pusta porcja
 * z dalszym kursorem wymaga kontynuacji także bez zdarzenia onEndReached.
 */
export function utworzKatalogPaginowany({ pobierzStrone, limit = 20 }) {
  let parametry = {};
  let klucz = null;
  let generacja = 0;
  let zadanie = null;
  let stan = {
    pozycje: [], kursor: null, wyczerpano: false, przeskanowano: 0,
    ladowanie: true, odswiezanie: false, dociaganie: false, blad: null,
  };
  const sluchacze = new Set();
  const publikuj = (zmiany) => {
    stan = { ...stan, ...zmiany };
    sluchacze.forEach((fn) => fn(stan));
  };
  const anuluj = () => { generacja += 1; zadanie = null; };

  async function czytaj({ dopisz = false, odswiez = false } = {}) {
    // Blokada jest synchroniczna. Dwa onEndReached w jednym renderze nie mogą
    // uruchomić dwóch żądań z tym samym kursorem.
    if (dopisz && (zadanie || !stan.kursor || stan.wyczerpano)) return;
    if (!dopisz) anuluj();
    const moje = { generacja, parametry: { ...parametry } };
    zadanie = moje;
    const aktualne = () => zadanie === moje && generacja === moje.generacja;
    let pozycje = dopisz ? stan.pozycje : [];
    let kursor = dopisz ? stan.kursor : null;
    let przeskanowano = dopisz ? stan.przeskanowano : 0;
    const ilePrzed = pozycje.length;
    const kursory = new Set(kursor ? [kursor] : []);
    publikuj({
      blad: null, ladowanie: !dopisz && !odswiez,
      odswiezanie: odswiez, dociaganie: dopisz,
    });
    try {
      do {
        const dane = await pobierzStrone({
          ...moje.parametry, limit: limit - (pozycje.length - ilePrzed),
          ...(kursor ? { kursor } : {}),
        });
        if (!aktualne()) return;
        const wyczerpano = dane.wyczerpano !== false;
        const nastepny = wyczerpano ? null : dane.next_kursor;
        if (!wyczerpano && (!nastepny || kursory.has(nastepny))) {
          throw new Error('Nie udało się przejść do kolejnych ogłoszeń. Spróbuj ponownie.');
        }
        if (nastepny) kursory.add(nastepny);
        pozycje = scalStrone(pozycje, dane.tenders ?? []);
        kursor = nastepny;
        przeskanowano += dane.przeskanowano ?? 0;
        // Postęp i znalezione karty są widoczne jeszcze w trakcie skanu.
        publikuj({ pozycje, kursor, wyczerpano, przeskanowano });
        if (wyczerpano) break;
      } while (pozycje.length - ilePrzed < limit);
    } catch (err) {
      if (aktualne()) publikuj({ blad: err.message });
    } finally {
      // Stare finally nie może zdjąć blokady ani wskaźnika NOWEGO żądania.
      if (aktualne()) {
        zadanie = null;
        publikuj({ ladowanie: false, odswiezanie: false, dociaganie: false });
      }
    }
  }

  return {
    stan: () => stan,
    subskrybuj(fn) { sluchacze.add(fn); fn(stan); return () => sluchacze.delete(fn); },
    ustawParametry(nowe) {
      const nowyKlucz = JSON.stringify(Object.entries(nowe).sort(([a], [b]) => a.localeCompare(b)));
      if (nowyKlucz === klucz) return;
      // Wywoływane w zdarzeniu zmiany filtra, PRZED debounce i następnym renderem.
      anuluj();
      klucz = nowyKlucz;
      parametry = { ...nowe };
      publikuj({
        pozycje: [], kursor: null, wyczerpano: false, przeskanowano: 0,
        ladowanie: true, odswiezanie: false, dociaganie: false, blad: null,
      });
    },
    wczytaj: (tryb) => czytaj({ odswiez: tryb === 'odswiez' }),
    dociagnij: () => czytaj({ dopisz: true }),
    anuluj,
  };
}
