import { tr } from './jezyk.js';
import { etykietaDnia } from './grupowanieDni.js';

/**
 * CENTRUM ALERTÓW I ZMIAN (etap 5) — czysta logika ekranu, zero React Native.
 *
 * Po co centrum, skoro jest push: push potrafi zniknąć. Telefon go schowa, system
 * zdejmie powiadomienie, zgody nigdy nie było. Alert istniejący WYŁĄCZNIE jako push
 * to alert, którego można nie zobaczyć — a mowa o klasie informacji („termin skrócony
 * o 6 dni"), której przegapienie kosztuje kontrakt. Ten ekran jest trwałym rejestrem
 * tego samego.
 *
 * Kolory są SEMANTYCZNE (`ton`) — hexy mieszkają w motyw.js.
 */

const TONY = ['danger', 'ostrzezenie', 'sukces', 'neutral'];

/** Nieznany ton z backendu nie może wywrócić ekranu ani udawać alarmu. */
export function tonAlertu(alert) {
  return TONY.includes(alert?.ton) ? alert.ton : 'neutral';
}

/**
 * Plakietka z liczbą nieprzeczytanych. Powyżej 99 pokazujemy „99+": trzycyfrowa
 * liczba nie mieści się w kółku, a różnica między 150 a 200 i tak nic nie zmienia.
 */
export function etykietaPlakietki(ile) {
  const n = Number(ile);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

/** Alert → gotowe teksty w wybranym języku (backend oddaje pary PL/EN). */
export function opisAlertu(alert, jezyk = 'pl') {
  return {
    id: alert?.id ?? null,
    tytul: tr(alert?.tytul, jezyk),
    tresc: tr(alert?.tresc, jezyk),
    ton: tonAlertu(alert),
    przeczytany: alert?.przeczytany === true,
    typ: alert?.typ ?? null,
    wyszukiwanie_id: alert?.wyszukiwanie_id ?? null,
    pozycje: (alert?.pozycje ?? []).map((p) => ({
      tenderId: p.tender_id ?? null,
      tytul: p.tytul ?? null,
      organizacja: p.organizacja ?? null,
      deadline: p.deadline ?? null,
      zrodlo: p.zrodlo ?? null,
      opis: p.zmiana_opis ? tr(p.zmiana_opis, jezyk) : null,
      typZmiany: p.zmiana_typ ?? null,
    })),
  };
}

/**
 * Alerty pogrupowane po DNIU, od najnowszego.
 *
 * Grupowanie po dniu, a nie „nieprzeczytane u góry": alert jest zdarzeniem w czasie
 * i wykonawca szuka go pamięcią („przyszło w środę"), a nie stanem przeczytania.
 * Nieprzeczytane wyróżnia sam wpis, nie osobna sekcja.
 */
export function grupujAlerty(alerty, terazMs = Date.now(), jezyk = 'pl') {
  const lista = (Array.isArray(alerty) ? alerty : [])
    .filter((a) => a && Number.isFinite(Date.parse(a.utworzone_o ?? '')))
    .map((a) => ({ ...opisAlertu(a, jezyk), utworzone_o: a.utworzone_o, czasMs: Date.parse(a.utworzone_o) }))
    .sort((a, b) => b.czasMs - a.czasMs);

  const teraz = new Date(terazMs);
  const grupy = [];
  for (const wpis of lista) {
    const data = new Date(wpis.czasMs);
    const etykieta = etykietaDnia(data, teraz);
    const ostatnia = grupy[grupy.length - 1];
    if (ostatnia && ostatnia.etykieta === etykieta) ostatnia.pozycje.push(wpis);
    else grupy.push({ klucz: etykieta, etykieta, pozycje: [wpis] });
  }

  return {
    grupy,
    nieprzeczytane: lista.filter((a) => !a.przeczytany).length,
    razem: lista.length,
  };
}

/** Pustka ma tłumaczyć, skąd biorą się alerty — inaczej wygląda jak awaria. */
export function opisPustegoCentrum(jezyk = 'pl') {
  return tr({
    pl: 'Nie masz jeszcze żadnych alertów. Zapisz wyszukiwanie w trybie „Wszystkie" i włącz alert — powiadomimy Cię o nowych przetargach i o zmianach terminu, wartości albo o anulowaniu postępowania.',
    en: 'No alerts yet. Save a search in “All” mode and turn the alert on — we will notify you about new tenders and about changes to the deadline, value, or a cancellation.',
  }, jezyk);
}
