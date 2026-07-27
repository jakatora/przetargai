/**
 * CZARNA SKRZYNKA SKŁADANIA OFERTY — czysta logika panelu (ulepszenie „Czarna skrzynka
 * składania oferty — dowody na awarię platformy", podzadanie 7/7). Bez importów z React
 * Native, więc testowalna zwykłym `node:test`.
 *
 * Ekran „Rejestrator oferty" (RejestratorOfertyScreen) tylko RENDERUJE to, co tu policzone:
 *   • KROKI_REJESTRATORA — stała kolejność kroków przewodnika krok-po-kroku,
 *   • odliczanieBezpieczenstwa(termin, teraz) — ile „czasu bezpieczeństwa" zostało do
 *     rekomendowanego złożenia (24 h przed terminem) + status/ton do pokolorowania,
 *   • opisAwarii / opisDowodu — etykiety + semantyczny `ton` statusu awarii i utrwalonych
 *     dowodów (taśma zdarzeń),
 *   • formatZnacznik — czytelny znacznik czasu dowodu.
 *
 * Świadome decyzje (spójnie z lib/sejf.js i backendem czasBezpieczenstwa.js):
 *  • `ton` to KLASA koloru, nie hex: ekran mapuje ją na tokeny motyw.js
 *    ('sukces'→sukcesAkcent/sukcesTlo, 'ostrzezenie'→ostrzezenie*, 'danger'→danger/dangerTlo,
 *    'neutral'→textMuted/neutralneTlo) — paleta (jasny/ciemny, kontrast AA) zostaje w
 *    jednym miejscu, a lib jest bez kolorów.
 *  • Progi 24 h / 3 h są TAKIE SAME jak w backendzie (services/czasBezpieczenstwa.js) —
 *    to ta sama obietnica „ile czasu bezpieczeństwa zostało".
 *  • `teraz` jest WSTRZYKIWANE — funkcje deterministyczne; domyślnie czyta zegar systemowy.
 *  • Wynik odliczania jest ZAMROŻONY — migawka na moment odczytu.
 */

const MIN = 60 * 1000;
const H = 60 * MIN;
const DZIEN = 24 * H;

/** Rekomendacja: złóż ofertę tyle godzin PRZED terminem składania (spójne z backendem). */
export const REKOMENDACJA_GODZIN = 24;

/** Poniżej tylu godzin do terminu sytuacja jest KRYTYCZNA („kilka godzin"). */
export const PROG_KRYTYCZNY_GODZIN = 3;

// ── Kolejność kroków rejestratora lotu ────────────────────────────────────────

/*
 * Przewodnik prowadzi JEDNĄ próbę złożenia oferty i utrwala dowody, które muszą obronić
 * się przed KIO. Kolejność ma znaczenie prawne: najpierw zabezpieczamy plik oferty
 * (suma kontrolna), potem dokumentujemy wysyłkę, na końcu potwierdzenie odbioru (EPO) —
 * bo po upływie terminu składania czynności nie da się powtórzyć. `typZdarzenie` to typ
 * wpisu dopisywanego do append-only taśmy przez api.czarnaSkrzynkaZdarzenie.
 */
export const KROKI_REJESTRATORA = Object.freeze([
  Object.freeze({
    id: 'oferta',
    tytul: 'Zabezpiecz plik oferty',
    opis:
      'Wgraj gotowy plik oferty — policzymy sumę kontrolną (SHA-256) i zapiszemy oryginał ' +
      'bez żadnych zmian. To dowód, że plik istniał i był gotowy przed terminem.',
    typZdarzenie: 'oferta',
  }),
  Object.freeze({
    id: 'zrzut',
    tytul: 'Zrzut ekranu z widocznym zegarem',
    opis:
      'Zrób zrzut ekranu platformy z widoczną datą i godziną (np. zegar systemowy). ' +
      'Utrwalimy go ze znacznikiem czasu z serwera.',
    typZdarzenie: 'zrzut',
  }),
  Object.freeze({
    id: 'wysylka',
    tytul: 'Wyślij ofertę na platformie',
    opis:
      'Wyślij ofertę przez e-Zamówienia lub platformę zakupową i zapisz ten moment. ' +
      'Jeśli wysyłka się nie powiedzie — od razu zgłoś awarię.',
    typZdarzenie: 'wyslano',
  }),
  Object.freeze({
    id: 'epo',
    tytul: 'Zapisz potwierdzenie odbioru (EPO)',
    opis:
      'Pobierz i utrwal Elektroniczne Potwierdzenie Odbioru. Brak EPO to podstawa do ' +
      'żądania przedłużenia terminu — utrwal fakt jego braku, jeśli nie dotarło.',
    typZdarzenie: 'epo',
  }),
]);

// ── Odliczanie czasu bezpieczeństwa ───────────────────────────────────────────

/** Odmiana „dzień/dni": w polskim to zawsze „dni" poza dokładnie jednym. */
function odmianaDni(n) {
  return n === 1 ? 'dzień' : 'dni';
}

/**
 * Zamienia wejście na absolutny moment (ms epoch) albo null, gdy nie da się jednoznacznie
 * sparsować. Akceptuje `Date`, epoch ms oraz string parsowalny przez Date. W panelu wolimy
 * bezpieczny fallback (status 'brak') niż wyjątek — ekran po prostu nie pokaże odliczania.
 */
function naMoment(v) {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * Ludzki opis odcinka czasu: dwie największe niezerowe jednostki (dni/godz/min).
 * < 1 min → „mniej niż minuta".
 */
function formatCzas(absMs) {
  const dni = Math.floor(absMs / DZIEN);
  const godz = Math.floor((absMs % DZIEN) / H);
  const min = Math.floor((absMs % H) / MIN);
  const czesci = [];
  if (dni > 0) czesci.push(`${dni} ${odmianaDni(dni)}`);
  if (godz > 0) czesci.push(`${godz} godz`);
  if (min > 0) czesci.push(`${min} min`);
  if (czesci.length === 0) return 'mniej niż minuta';
  return czesci.slice(0, 2).join(' ');
}

/** Status marginesu na podstawie ms do terminu i progów (spójne z backendem). */
function statusZMs(ms) {
  if (ms <= 0) return 'po_terminie';
  if (ms < PROG_KRYTYCZNY_GODZIN * H) return 'krytycznie';
  if (ms < REKOMENDACJA_GODZIN * H) return 'ostrzezenie';
  return 'bezpiecznie';
}

/** Status → etykieta + semantyczny ton koloru (ekran mapuje ton na tokeny motyw.js). */
const STATUS_META = Object.freeze({
  bezpiecznie: { etykieta: 'Bezpiecznie', ton: 'sukces' },
  ostrzezenie: { etykieta: 'Ostrzeżenie', ton: 'ostrzezenie' },
  krytycznie: { etykieta: 'Krytycznie', ton: 'danger' },
  po_terminie: { etykieta: 'Po terminie', ton: 'danger' },
  brak: { etykieta: 'Podaj termin', ton: 'neutral' },
});

function komunikatStatusu(status, czasStr) {
  switch (status) {
    case 'po_terminie':
      return `Termin składania minął (${czasStr} temu) — czynności nie da się już powtórzyć.`;
    case 'krytycznie':
      return `Zostało tylko ${czasStr} do terminu. Złóż ofertę TERAZ i utrwalaj każdy krok.`;
    case 'ostrzezenie':
      return `Rekomendowany moment (24 h przed terminem) już minął. Zostało ${czasStr} — złóż ofertę bez zwłoki.`;
    default:
      return `Masz bezpieczny zapas czasu (${czasStr} do terminu). Zaplanuj złożenie najpóźniej 24 h przed.`;
  }
}

/**
 * Ile „czasu bezpieczeństwa" zostało do terminu składania. Zwraca ZAMROŻONY obiekt:
 *   { status, ton, etykietaStatusu, odliczanie, komunikat, poTerminie, rekomendacja }.
 * Gdy termin jest pusty/niepoprawny → status 'brak' (ekran nie pokazuje licznika).
 * @param {string|number|Date|null} termin termin składania (ISO ze strefą / epoch ms / Date).
 * @param {string|number|Date} [teraz] moment odniesienia; domyślnie zegar systemowy.
 */
export function odliczanieBezpieczenstwa(termin, teraz = Date.now()) {
  const terminMs = naMoment(termin);
  const terazMs = naMoment(teraz) ?? Date.now();
  if (terminMs === null) {
    return Object.freeze({
      status: 'brak',
      ton: STATUS_META.brak.ton,
      etykietaStatusu: STATUS_META.brak.etykieta,
      odliczanie: null,
      komunikat: 'Podaj termin składania ofert, aby zobaczyć czas bezpieczeństwa.',
      poTerminie: false,
      rekomendacja: `Rekomendujemy złożenie oferty ${REKOMENDACJA_GODZIN} h przed terminem.`,
    });
  }

  const ms = terminMs - terazMs;
  const status = statusZMs(ms);
  const meta = STATUS_META[status];
  const czasStr = formatCzas(Math.abs(ms));
  const odliczanie = ms <= 0 ? `po terminie od ${czasStr}` : `${czasStr} do terminu`;

  return Object.freeze({
    status,
    ton: meta.ton,
    etykietaStatusu: meta.etykieta,
    odliczanie,
    komunikat: komunikatStatusu(status, czasStr),
    poTerminie: ms <= 0,
    rekomendacja: `Rekomendowane złożenie: najpóźniej ${REKOMENDACJA_GODZIN} h przed terminem.`,
  });
}

// ── Etykiety statusu awarii ────────────────────────────────────────────────────

/*
 * Typy awarii zgodne z backendem (services/pakietDowodowy.wykryjAwarie): błąd wysyłki,
 * brak potwierdzenia EPO, niedostępność platformy. Wszystkie są krytyczne → ton 'danger'.
 */
export const TYPY_AWARII = Object.freeze({
  blad_wysylki: Object.freeze({ etykieta: 'Błąd wysyłki oferty', ton: 'danger' }),
  brak_epo: Object.freeze({ etykieta: 'Brak potwierdzenia (EPO)', ton: 'danger' }),
  niedostepnosc: Object.freeze({ etykieta: 'Platforma niedostępna', ton: 'danger' }),
});

const AWARIA_DOMYSLNA = Object.freeze({ etykieta: 'Awaria platformy', ton: 'danger' });

/**
 * Etykieta + ton typu awarii. Nieznany typ → bezpieczny opis domyślny (nadal 'danger'),
 * żeby nowy typ z backendu nie zniknął po cichu z ekranu.
 * @param {string} typ
 */
export function opisAwarii(typ) {
  return TYPY_AWARII[typ] ?? AWARIA_DOMYSLNA;
}

// ── Etykiety utrwalonych dowodów (taśma zdarzeń) ───────────────────────────────

/*
 * Typy wpisów taśmy rejestratora → czytelna etykieta + ton. Pozytywne dowody (oferta/EPO)
 * dostają ton 'sukces', zgłoszenie awarii — 'danger', reszta neutralnie. Ton to tylko
 * KLASA koloru; token dokłada ekran.
 */
const TYPY_DOWODU = Object.freeze({
  start: Object.freeze({ etykieta: 'Rozpoczęcie sesji', ton: 'neutral' }),
  // Upload oferty backend zapisuje na taśmie jako typ 'hash_oferty'; 'oferta' to alias
  // spójny z KROKI_REJESTRATORA (id kroku) — oba pokazujemy jako sumę kontrolną oferty.
  hash_oferty: Object.freeze({ etykieta: 'Suma kontrolna oferty', ton: 'sukces' }),
  oferta: Object.freeze({ etykieta: 'Suma kontrolna oferty', ton: 'sukces' }),
  zrzut: Object.freeze({ etykieta: 'Zrzut ekranu', ton: 'neutral' }),
  wyslano: Object.freeze({ etykieta: 'Wysyłka oferty', ton: 'neutral' }),
  epo: Object.freeze({ etykieta: 'Potwierdzenie odbioru (EPO)', ton: 'sukces' }),
  ping: Object.freeze({ etykieta: 'Sprawdzenie dostępności', ton: 'neutral' }),
  awaria: Object.freeze({ etykieta: 'Zgłoszenie awarii', ton: 'danger' }),
});

const DOWOD_DOMYSLNY = Object.freeze({ etykieta: 'Zdarzenie', ton: 'neutral' });

/**
 * Etykieta + ton wpisu taśmy. Nieznany typ → neutralny wpis „Zdarzenie", żeby lista
 * dowodów nigdy nie miała pustej etykiety.
 * @param {string} typ typ zdarzenia z backendu
 */
export function opisDowodu(typ) {
  return TYPY_DOWODU[typ] ?? DOWOD_DOMYSLNY;
}

// ── Znacznik czasu dowodu ──────────────────────────────────────────────────────

/**
 * Czytelny znacznik czasu utrwalonego dowodu: „DD.MM.RRRR HH:MM:SS". Czyta czas WPROST z
 * napisu ISO (wall-clock zapisany przez serwer razem ze strefą), bez konwersji do strefy
 * urządzenia — dla dowodu liczy się moment utrwalony na taśmie, nie lokalny zegar telefonu.
 * @param {string} iso znacznik ISO 8601 z taśmy (np. 2026-07-27T14:32:05+02:00)
 * @returns {string} sformatowany znacznik albo „brak czasu".
 */
export function formatZnacznik(iso) {
  if (typeof iso !== 'string') return 'brak czasu';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 'brak czasu';
  const [, rok, mies, dzien, godz, min, sek] = m;
  return `${dzien}.${mies}.${rok} ${godz}:${min}:${sek ?? '00'}`;
}
