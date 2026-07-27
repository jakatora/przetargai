/**
 * ODZYSKIWACZ ZABEZPIECZENIA — czysta logika PREZENTACJI panelu (ulepszenie „pilnuj
 * zwrotu swoich pieniędzy po kontrakcie", strona mobilna). Bez importów z React Native
 * ani sieci — testowalna zwykłym `node:test`.
 *
 * Cała matematyka (harmonogram transz art. 453 Pzp, status wymagalności, odsetki za
 * opóźnienie, porównanie kosztu gotówka vs gwarancja) żyje na BEZSTANOWYM backendzie
 * (`/api/przetarg/zabezpieczenie/*`, bez DB i bez płatnego AI). Tu tylko:
 *   • formatowanie kwot w złotych (z groszami) i odmiana dni po polsku,
 *   • mapowanie statusu transzy na semantyczny `ton` (KLASA koloru, nie hex),
 *   • złożenie odpowiedzi backendu w JEDEN, ZAMROŻONY obiekt gotowy dla ekranu.
 *
 * Świadome decyzje (spójne z lib/symulatorPlynnosci.js):
 *  • RĘCZNE grupowanie tysięcy (NIE Intl) — Hermes w RN nie ma pełnego Intl,
 *  • `ton` mapuje ekran na tokeny motyw.js (neutral→textMuted/neutralneTlo,
 *    ostrzezenie→ostrzezenie*, danger→danger*), więc paleta i kontrast AA zostają
 *    w jednym miejscu, a ta lib jest bez kolorów,
 *  • PESYMISTYCZNIE dla pieniędzy: null/NaN/ujemne kwoty formatujemy jako „0,00 zł",
 *    żeby braki nie udawały gotówki ani nie wywracały ekranu.
 */

/** Skończona liczba albo 0 (null/undefined/NaN/ujemne → 0 — pesymistycznie dla kwot). */
function liczba(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Polski zapis kwoty z groszami i grupowaniem tysięcy: 35000 → „35 000,00 zł",
 * 100.5 → „100,50 zł". null/NaN/ujemne → „0,00 zł" (pesymistycznie).
 */
export function formatujKwota(v) {
  const zaokr = Math.round(Math.max(0, liczba(v)) * 100) / 100;
  const [calosc, ulamek] = zaokr.toFixed(2).split('.');
  const grupy = calosc.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grupy},${ulamek} zł`;
}

/** Polska odmiana „dzień/dni" — 1 → „dzień", reszta → „dni". */
function odmianaDni(n) {
  return n === 1 ? 'dzień' : 'dni';
}

/** Liczba PL do tekstu założeń (kropka dziesiętna → przecinek): 1.5 → „1,5". */
function liczbaPL(v) {
  return String(v).replace('.', ',');
}

// ─────────────────────── status transzy → etykieta + ton ─────────────────────

/*
 * Status transzy z backendu → etykieta + semantyczny `ton`. Ton to KLASA koloru;
 * token (jasny/ciemny, kontrast AA) dokłada ekran z motyw.js.
 *   oczekuje       → neutral      (jeszcze nie czas)
 *   wymagalne      → ostrzezenie  (ALARM: zadziałaj — możesz żądać pieniędzy)
 *   przeterminowane→ danger       (siedzą na Twoich pieniądzach; naliczaj odsetki)
 */
const STATUS_META = Object.freeze({
  oczekuje: Object.freeze({ status: 'oczekuje', etykieta: 'Oczekuje', ton: 'neutral' }),
  wymagalne: Object.freeze({ status: 'wymagalne', etykieta: 'Wymagalne', ton: 'ostrzezenie' }),
  przeterminowane: Object.freeze({ status: 'przeterminowane', etykieta: 'Przeterminowane', ton: 'danger' }),
});
const STATUS_DOMYSLNY = Object.freeze({ status: 'nieznany', etykieta: 'Termin nieustalony', ton: 'neutral' });

/** Etykieta + ton statusu transzy; nieznany/pusty → neutralny domyślny. */
export function opisStatusuTranszy(status) {
  return STATUS_META[status] ?? STATUS_DOMYSLNY;
}

/**
 * Jednozdaniowy opis wymagalności transzy z odmianą dni:
 *   oczekuje → „za X dni", wymagalne → „dziś — możesz żądać zwrotu",
 *   przeterminowane → „X dni po terminie", inny → „termin nieustalony".
 */
export function opisWymagalnosci({ status, dni } = {}) {
  const d = Math.abs(Math.round(liczba(dni)));
  if (status === 'oczekuje') return `za ${d} ${odmianaDni(d)}`;
  if (status === 'wymagalne') return 'dziś — możesz żądać zwrotu';
  if (status === 'przeterminowane') return `${d} ${odmianaDni(d)} po terminie`;
  return 'termin nieustalony';
}

// ─────────────────────── podsumowanie harmonogramu ───────────────────────────

/**
 * Wzbogaca transze harmonogramu o etykiety, ton i tekst wymagalności; składa alarm
 * (jest transza, której można DZIŚ żądać albo jest przeterminowana). Odporny na braki —
 * puste wejście daje bezpieczny obiekt (ekran się nie wywraca). Zwraca ZAMROŻONE dane.
 *
 * @param {{harmonogram?:object, alarm?:boolean}} wejscie odpowiedź backendu /harmonogram
 * @returns {Readonly<{kwotaLabel, procentZatrzymany, zatrzymanieLabel, alarm, alarmTekst,
 *   transze: ReadonlyArray<Readonly<object>>}>}
 */
export function podsumujHarmonogram({ harmonogram, alarm } = {}) {
  const h = harmonogram || {};
  const lista = Array.isArray(h.transze) ? h.transze : [];

  const transze = Object.freeze(lista.map((t) => {
    const meta = opisStatusuTranszy(t?.status);
    const odsetki = liczba(t?.odsetki);
    return Object.freeze({
      etap: t?.etap ?? null,
      tytul: t?.tytul ?? '',
      termin: t?.termin ?? null,
      procent: t?.procent ?? null,
      procentLabel: `${t?.procent ?? 0}%`,
      kwotaLabel: formatujKwota(t?.kwota),
      status: meta.status,
      ton: meta.ton,
      etykietaStatusu: meta.etykieta,
      wymagalnoscTekst: opisWymagalnosci({ status: t?.status, dni: t?.dni }),
      odsetki,
      odsetkiLabel: odsetki > 0 ? formatujKwota(odsetki) : null,
    });
  }));

  const alarmObliczony = typeof alarm === 'boolean'
    ? alarm
    : transze.some((t) => t.status === 'wymagalne' || t.status === 'przeterminowane');

  const procentZatrzymany = liczba(h.procentZatrzymany);
  return Object.freeze({
    kwotaLabel: formatujKwota(h.kwota),
    procentZatrzymany,
    zatrzymanieLabel: `zatrzymane na rękojmię: ${procentZatrzymany}%`,
    alarm: alarmObliczony,
    alarmTekst: alarmObliczony ? 'Możesz już żądać zwrotu — wygeneruj wezwanie do zwrotu.' : '',
    transze,
  });
}

// ─────────────────────── podsumowanie porównania kosztu ──────────────────────

const ETYKIETY_OPCJI = Object.freeze({
  gotowka: 'Gotówka (zamrożona)',
  gwarancja: 'Gwarancja bankowa',
  porownywalne: 'Porównywalne',
});

/**
 * Składa odpowiedź backendu /porownaj w gotowy dla ekranu opis: etykiety kosztów,
 * tańsza opcja, zdanie rekomendacji i jawnie wypisane założenia (nic ukrytego przy
 * decyzji o pieniądzach). Zwraca ZAMROŻONY obiekt.
 */
export function podsumujPorownanie(porownanie) {
  const p = porownanie || {};
  const z = p.zalozenia || {};
  const tanszaOpcja = p.tanszaOpcja ?? 'porownywalne';
  const tanszaEtykieta = ETYKIETY_OPCJI[tanszaOpcja] ?? ETYKIETY_OPCJI.porownywalne;
  const roznicaLabel = formatujKwota(p.roznica);

  const rekomendacja = tanszaOpcja === 'porownywalne'
    ? 'Koszt obu form jest porównywalny — wybór zależy od dostępności gotówki.'
    : `Taniej: ${tanszaEtykieta.toLowerCase()} — oszczędzasz ${roznicaLabel}.`;

  return Object.freeze({
    gotowkaLabel: formatujKwota(p.gotowka?.koszt),
    gwarancjaLabel: formatujKwota(p.gwarancja?.koszt),
    tanszaOpcja,
    tanszaEtykieta,
    roznicaLabel,
    rekomendacja,
    zalozeniaTekst: `Założenia: prowizja gwarancji ${liczbaPL(liczba(z.prowizjaGwarancjiRocznaProc))}%/rok, `
      + `koszt kapitału ${liczbaPL(liczba(z.kosztKapitaluRocznyProc))}%/rok.`,
  });
}
