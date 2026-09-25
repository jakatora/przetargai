/**
 * „STRAŻNIK WEZWANIA DO UZUPEŁNIENIA (jedna szansa, krótki termin)" — czysta logika bez
 * React Native (testowalna `node:test`). Ekran renderuje to, co tu policzone; kolor dokłada
 * motyw.js na podstawie semantycznego `ton`.
 *
 * PROBLEM: wezwanie z art. 128/274 Pzp jest JEDNOKROTNE i ma krótki (często 3-dniowy) termin.
 * Przegapione albo odpowiedź złym dokumentem/złym podpisem = odrzucenie oferty, a nierzadko i
 * utrata wadium — najdotkliwsza finansowo pomyłka formalna.
 *
 * PODSTAWA PRAWNA:
 *  - art. 128 ust. 1 Pzp (i art. 274 dla trybu podstawowego) — wezwanie do złożenia,
 *    poprawienia lub uzupełnienia podmiotowych środków dowodowych; termin wyznacza zamawiający.
 *  - Aktualność dokumentów: KRK ~6 mies., zaświadczenia ZUS/US ~3 mies. przed złożeniem.
 *  - Podpis: kwalifikowany (≥ progi UE) albo zaufany/osobisty (poniżej) — „podpisany ręcznie
 *    skan" NIE jest podpisem elektronicznym.
 *
 * Czas jest WSTRZYKIWANY (`teraz`) — moduł deterministyczny; odliczanie robimy do CHWILI
 * (godziny), bo w ostatniej dobie liczą się godziny, nie dni.
 */

import { naDzienUTC, koniecDniaPL } from './dataUtc.js';

const MS_GODZINA = 60 * 60 * 1000;
const MS_DZIEN = 24 * MS_GODZINA;

function odmianaDni(n) { return n === 1 ? 'dzień' : 'dni'; }
function odmianaGodzin(n) {
  if (n === 1) return 'godzina';
  const ost = n % 10;
  const przedost = Math.floor(n / 10) % 10;
  if (przedost !== 1 && ost >= 2 && ost <= 4) return 'godziny';
  return 'godzin';
}

/**
 * Ile czasu zostało do terminu wezwania (do chwili, nie do dnia).
 * @param {string|Date} termin data/chwila terminu (ISO; „RRRR-MM-DD" traktujemy jak koniec dnia
 *   — 24:00 czasu polskiego, bo termin upływa z końcem dnia)
 * @param {number} teraz Date.now()-podobny znacznik (wstrzykiwany)
 * @returns {{znany: boolean, poTerminie: boolean, ms: number, dni: number, godziny: number,
 *   ton: string, etykieta: string}}
 */
export function pozostalyCzas(termin, teraz = Date.now()) {
  let cel = null;
  if (termin instanceof Date) {
    cel = Number.isNaN(termin.getTime()) ? null : termin.getTime();
  } else if (typeof termin === 'string') {
    const t = termin.trim();
    // Sama data (bez godziny) → termin upływa z końcem dnia: o 24:00 czasu POLSKIEGO.
    // Poprawka 2026-09-25: wcześniej 23:59:59 UTC, czyli 00:59/01:59 następnego dnia w Polsce.
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      cel = koniecDniaPL(naDzienUTC(t)); // null dla daty nieistniejącej (2026-02-30)
    } else {
      const d = new Date(t);
      cel = Number.isNaN(d.getTime()) ? null : d.getTime();
    }
  }
  if (cel === null) {
    return { znany: false, poTerminie: false, ms: 0, dni: 0, godziny: 0, ton: 'neutral', etykieta: 'Podaj termin z wezwania' };
  }
  const ms = cel - teraz;
  // Równo w chwili upływu (24:00) termin już minął — spójnie z terminKio.pozostaly_czas_do.
  if (ms <= 0) {
    return { znany: true, poTerminie: true, ms, dni: 0, godziny: 0, ton: 'danger', etykieta: 'PO TERMINIE' };
  }
  const dni = Math.floor(ms / MS_DZIEN);
  const godziny = Math.floor((ms % MS_DZIEN) / MS_GODZINA);
  let ton;
  if (ms < MS_DZIEN) ton = 'danger';          // ostatnia doba — czerwony
  else if (ms < 3 * MS_DZIEN) ton = 'ostrzezenie';
  else ton = 'neutral';
  let etykieta;
  if (dni > 0) etykieta = `Zostało ${dni} ${odmianaDni(dni)} ${godziny} ${odmianaGodzin(godziny)}`;
  else etykieta = `Zostało ${godziny} ${odmianaGodzin(godziny)}`;
  return { znany: true, poTerminie: false, ms, dni, godziny, ton, etykieta };
}

/**
 * Status checklisty dokumentów z wezwania.
 * @param {Array<{nazwa: string, gotowy?: boolean}>} dokumenty
 * @returns {{gotowe: number, wszystkie: number, komplet: boolean, brakujace: string[]}}
 */
export function statusChecklisty(dokumenty) {
  const lista = Array.isArray(dokumenty) ? dokumenty : [];
  const gotowe = lista.filter((d) => d && d.gotowy).length;
  const wszystkie = lista.length;
  const brakujace = lista.filter((d) => d && !d.gotowy).map((d) => d.nazwa);
  return { gotowe, wszystkie, komplet: wszystkie > 0 && gotowe === wszystkie, brakujace };
}

/** Podpowiedzi aktualności/formy dla typowych dokumentów (dopasowanie po słowach kluczowych). */
const PODPOWIEDZI = [
  { klucz: /krk|karnej|niekaralnoś/i, tekst: 'KRK: ważne ~6 miesięcy przed złożeniem — sprawdź datę wystawienia.' },
  { klucz: /zus/i, tekst: 'ZUS: zaświadczenie o niezaleganiu ważne ~3 miesiące — po przedłużeniu terminu mogło stracić ważność.' },
  { klucz: /urząd skarbow|urzędu skarbow|\bus\b|podatk/i, tekst: 'US: zaświadczenie o niezaleganiu ważne ~3 miesiące.' },
  { klucz: /podpis|pełnomocnict/i, tekst: 'Podpis kwalifikowany/zaufany/osobisty — „ręcznie podpisany skan" NIE jest podpisem elektronicznym.' },
  { klucz: /wykaz|referenc|robót|dostaw|usług/i, tekst: 'Wykaz: sprawdź, czy doświadczenie mieści się w oknie 5/3 lat i ma podpięte referencje.' },
  { klucz: /polis|ubezpiecz/i, tekst: 'Polisa OC: sprawdź sumę gwarancyjną i okres — musi obejmować termin realizacji.' },
];

/** Zwraca podpowiedź do dokumentu albo '' (brak dopasowania). */
export function podpowiedzDoDokumentu(nazwa) {
  const n = String(nazwa || '');
  return PODPOWIEDZI.find((p) => p.klucz.test(n))?.tekst ?? '';
}
