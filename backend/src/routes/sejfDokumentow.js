import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest, notFound } from '../lib/errors.js';
import { authRequired } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { postepowaniaSwz, swzWersje } from '../db/repos.js';
import { createSejfDokumentow } from '../services/sejfDokumentow.js';
import { createDopasowanieSejfSWZ } from '../services/dopasowanieSejfSWZ.js';
import { jestZnanymTypem, ID_TYPOW_DOKUMENTOW, TYPY_DOKUMENTOW } from '../config/dokumentyKatalog.js';

/*
 * SEJF DOKUMENTÓW FIRMY — endpointy (ulepszenie „Sejf podmiotowych środków dowodowych
 * z licznikiem świeżości", podzadanie 4/7). Samodzielny router, spójny ze wzorcem
 * scheduler/endpoint z Radaru podprogowego/SWZ (routes/radarPodprogowy.js):
 *
 *   • GET    /katalog                — typy dokumentów + link „gdzie wyrobić online"
 *                                      (źródło dla formularza dodawania na mobile),
 *   • GET    /dokumenty              — lista dokumentów zalogowanego użytkownika,
 *                                      WZBOGACONA o licznik dni ważności, status
 *                                      ('gotowy'|'zamow_nowy'|'przeterminowany') i link online,
 *   • POST   /dokumenty              — dodanie dokumentu (typ + opcjonalna data/okres/notatka),
 *   • PATCH  /dokumenty/:id          — edycja pól dokumentu,
 *   • DELETE /dokumenty/:id          — usunięcie (skopowane do właściciela),
 *   • POST   /dokumenty/:id/plik     — upload ORYGINAŁU (base64): wykrycie formatu i
 *                                      podpisu, zapis bajt-w-bajt, ostrzeżenie przy skanie.
 *
 * USŁUGA to samodzielna fabryka `createSejfDokumentow(db)` na singletonie `db` —
 * świadomie, bo repos.js/schema.sql mają niezacommitowany WIP innych funkcji (pułapka
 * drzewa roboczego z pamięci projektu). Magazyn oryginałów domyślnie na dysku
 * (`SEJF_STORAGE_DIR`). Trasa jest UWIERZYTELNIONA i skopowana do właściciela; bez
 * płatnego AI — same odczyty/zapisy (dopasowanie do SWZ z płatnym AI to podzadanie 5).
 *
 * MAPOWANIE BŁĘDÓW: usługa rzuca zwykłe `Error` (nieznany typ, nieobsługiwany format,
 * nie-właściciel). Handlery przechwytują je i mapują na czytelne 400/404 — inaczej
 * poleciałyby jako 500 przez centralny errorHandler.
 */

const router = Router();
const sejf = createSejfDokumentow(db);
// Dopasowanie sejf ↔ SWZ (podzadanie 5/7) korzysta z tej samej instancji sejfu jako
// źródła dokumentów; świeżość liczona jest na PRZEWIDYWANY dzień złożenia oferty.
const dopasowanie = createDopasowanieSejfSWZ({ sejf });

// ── Walidacja wejścia ────────────────────────────────────────────────────────

// Data wystawienia to 'YYYY-MM-DD'; sprawdzamy REALNOŚĆ (odrzucamy 30 lutego) TU, bo
// czysta logika świeżości (waznoscDokumentow) rzuca na złej dacie — chcemy 400, nie 500.
function poprawnaDataISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [rok, mies, dzien] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(rok, mies - 1, dzien));
  return d.getUTCFullYear() === rok && d.getUTCMonth() === mies - 1 && d.getUTCDate() === dzien;
}

const dodajSchema = z.object({
  typ: z.string().max(60),
  data_wystawienia: z.string().max(40).optional(),
  okres_waznosci_dni: z.number().int().positive().max(100_000).optional(),
  notatka: z.string().max(4000).optional(),
});

// Edycja jest częściowa — wszystkie pola opcjonalne; walidujemy to, co przyszło.
const edytujSchema = z.object({
  typ: z.string().max(60).optional(),
  data_wystawienia: z.string().max(40).nullable().optional(),
  okres_waznosci_dni: z.number().int().positive().max(100_000).nullable().optional(),
  notatka: z.string().max(4000).nullable().optional(),
});

// ── Katalog typów ──────────────────────────────────────────────────────────—

router.get('/katalog', authRequired, ah(async (_req, res) => {
  // Widok pod formularz dodawania: co można trzymać, jak długo jest ważne i gdzie
  // to wyrobić online (bez wewnętrznych szczegółów — tylko to, czego UI potrzebuje).
  const typy = TYPY_DOKUMENTOW.map((t) => ({
    id: t.id,
    nazwa: t.nazwa,
    opis: t.opis,
    okresWaznosciDniDomyslny: t.okresWaznosciDniDomyslny,
    czasOczekiwaniaUrzadDni: t.czasOczekiwaniaUrzadDni,
    wymagaDokumentuElektronicznego: t.wymagaDokumentuElektronicznego,
    online: t.online,
  }));
  res.json({ typy });
}));

// ── Lista / dodawanie ─────────────────────────────────────────────────────────

router.get('/dokumenty', authRequired, ah(async (req, res) => {
  // Wzbogacenie (licznik dni + status) liczy się „na dzisiaj" — dzień odniesienia
  // wstrzykuje usługa. Dokument bezterminowy ma dniDoWaznosci = Infinity → JSON zamienia
  // to na null (brak terminu); status „gotowy" niesie właściwe znaczenie dla UI.
  res.json({ dokumenty: sejf.lista(req.user.id) });
}));

router.post('/dokumenty', authRequired, ah(async (req, res) => {
  const parsed = dodajSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj "typ" (id typu dokumentu) i opcjonalnie "data_wystawienia"/"okres_waznosci_dni"/"notatka".');
  }
  const { typ, data_wystawienia, okres_waznosci_dni, notatka } = parsed.data;
  if (!jestZnanymTypem(typ)) {
    throw badRequest(`Nieznany typ dokumentu. Dozwolone: ${ID_TYPOW_DOKUMENTOW.join(', ')}.`);
  }
  if (data_wystawienia !== undefined && !poprawnaDataISO(data_wystawienia)) {
    throw badRequest('"data_wystawienia" musi być realną datą w formacie YYYY-MM-DD.');
  }

  const dokument = sejf.utworz(req.user.id, {
    typ,
    dataWystawienia: data_wystawienia ?? null,
    okresWaznosciDni: okres_waznosci_dni,
    notatka: notatka ?? null,
  });
  res.status(201).json({ dokument });
}));

router.patch('/dokumenty/:id', authRequired, ah(async (req, res) => {
  const parsed = edytujSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Niepoprawne dane edycji dokumentu.');
  const d = parsed.data;
  if (d.typ !== undefined && !jestZnanymTypem(d.typ)) {
    throw badRequest(`Nieznany typ dokumentu. Dozwolone: ${ID_TYPOW_DOKUMENTOW.join(', ')}.`);
  }
  if (d.data_wystawienia != null && !poprawnaDataISO(d.data_wystawienia)) {
    throw badRequest('"data_wystawienia" musi być realną datą w formacie YYYY-MM-DD.');
  }

  // Przepisujemy tylko klucze, które faktycznie przyszły (klucze API → klucze usługi).
  const zmiany = {};
  if ('typ' in d) zmiany.typ = d.typ;
  if ('data_wystawienia' in d) zmiany.dataWystawienia = d.data_wystawienia;
  if ('okres_waznosci_dni' in d) zmiany.okresWaznosciDni = d.okres_waznosci_dni;
  if ('notatka' in d) zmiany.notatka = d.notatka;

  const dokument = sejf.aktualizuj(req.user.id, req.params.id, zmiany);
  if (!dokument) throw notFound('Nie znaleziono dokumentu o podanym id.');
  res.json({ dokument });
}));

router.delete('/dokumenty/:id', authRequired, ah(async (req, res) => {
  const usunieto = sejf.usun(req.user.id, req.params.id);
  if (!usunieto) throw notFound('Nie znaleziono dokumentu o podanym id.');
  res.status(200).json({ usunieto: true });
}));

// ── Upload oryginału ─────────────────────────────────────────────────────────

const uploadSchema = z.object({
  nazwa_pliku: z.string().max(300).optional(),
  plik_base64: z.string().min(1),
});

router.post('/dokumenty/:id/plik', authRequired, ah(async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Podaj "plik_base64" (oryginał zakodowany w base64) i opcjonalnie "nazwa_pliku".');

  // Właściciela sprawdzamy WPROST (czysty 404), zanim ruszymy detekcję/zapis — usługa
  // rzuciłaby na to zwykłym Error, który poleciałby jako 500.
  if (!sejf.pobierz(req.user.id, req.params.id)) {
    throw notFound('Nie znaleziono dokumentu o podanym id.');
  }

  const bajty = Buffer.from(parsed.data.plik_base64, 'base64');
  if (bajty.length === 0) throw badRequest('Pusty plik — "plik_base64" nie zawiera danych.');

  let wynik;
  try {
    wynik = await sejf.zapiszPlik(req.user.id, req.params.id, {
      nazwaPliku: parsed.data.nazwa_pliku ?? '',
      bajty,
    });
  } catch (e) {
    // Jedyny pozostały tryb błędu po sprawdzeniu właściciela to odrzucony format
    // (surowy obraz spoza XML/PDF) — to błąd wejścia, więc 400 z komunikatem usługi.
    throw badRequest(e.message);
  }

  res.status(200).json({
    dokument: wynik.rekord,
    ostrzezenie: wynik.ostrzezenie,
    detekcja: wynik.detekcja,
  });
}));

// ── Dopasowanie sejfu do konkretnego postępowania (podzadanie 5/7) ───────────
//
// POST /dopasowanie/:postepowanieId — dla postępowania NALEŻĄCEGO do użytkownika
// (skopowane po właścicielu; cudze/nieistniejące => 404) porównuje dokumenty wymagane
// w SWZ z zawartością sejfu WZGLĘDEM PRZEWIDYWANEGO DNIA ZŁOŻENIA i zwraca trzy koszyki:
// świeże / przeterminuje_sie (kluczowe przy przesunięciu terminu) / brakuje + link online.
//
// Wymagane typy: z jawnej listy `wymagane_typy` albo z parsera treści SWZ (deterministyczny,
// BEZ płatnego AI — patrz services/dopasowanieSejfSWZ.js). Treść SWZ z body `swz` albo z
// najnowszej zapisanej wersji SWZ. Dzień złożenia: override `dzien_zlozenia` → termin
// składania z postępowania → dziś. Bez płatnego AI, więc trasa tylko odczytuje/liczy.

const dopasowanieSchema = z.object({
  swz: z.string().max(5_000_000).optional(),
  wymagane_typy: z.array(z.string().max(60)).max(50).optional(),
  dzien_zlozenia: z.string().max(40).optional(),
});

router.post('/dopasowanie/:postepowanieId', authRequired, ah(async (req, res) => {
  // Własność sprawdzamy WPROST (czysty 404) — bez wycieku cudzych postępowań.
  const postepowanie = postepowaniaSwz.findByIdForUser(req.params.postepowanieId, req.user.id);
  if (!postepowanie) throw notFound('Nie znaleziono postępowania o podanym id.');

  const parsed = dopasowanieSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Niepoprawne dane dopasowania (opcjonalne: "swz", "wymagane_typy", "dzien_zlozenia").');
  }
  const d = parsed.data;

  // Przewidywany dzień złożenia (jeśli podany) musi być realną datą — inaczej czysta
  // logika świeżości rzuciłaby, a chcemy czytelne 400 zamiast 500.
  const dzien = d.dzien_zlozenia?.trim();
  if (dzien && !poprawnaDataISO(dzien)) {
    throw badRequest('"dzien_zlozenia" musi być realną datą w formacie YYYY-MM-DD.');
  }
  if (d.wymagane_typy) {
    const nieznane = d.wymagane_typy.filter((t) => !jestZnanymTypem(t));
    if (nieznane.length) {
      throw badRequest(`Nieznane typy dokumentów: ${nieznane.join(', ')}. Dozwolone: ${ID_TYPOW_DOKUMENTOW.join(', ')}.`);
    }
  }

  // Treść SWZ: z body albo z najnowszej zapisanej wersji SWZ postępowania (Radar SWZ).
  const swzTekst = d.swz?.trim()
    ? d.swz
    : (swzWersje.latestForPostepowanie(postepowanie.id)?.tresc ?? '');

  const wynik = dopasowanie.dlaPostepowania({
    userId: req.user.id,
    postepowanie,
    swzTekst,
    wymaganeTypy: d.wymagane_typy,
    dzienZlozenia: dzien || undefined,
  });

  res.status(200).json({ postepowanie_id: postepowanie.id, ...wynik });
}));

export default router;
