import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest, notFound } from '../lib/errors.js';
import { authRequired } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { createCzarnaSkrzynka } from '../services/czarnaSkrzynka.js';
import { createPakietDowodowy } from '../services/pakietDowodowy.js';
import { generujPismoOPrzedluzenie } from '../services/pismoOPrzedluzenie.js';

/*
 * CZARNA SKRZYNKA SKŁADANIA OFERTY — endpointy (ulepszenie „Czarna skrzynka składania
 * oferty — dowody na awarię platformy", podzadanie 5/7). Samodzielny router spójny ze
 * wzorcem Sejfu/Radaru SWZ (routes/sejfDokumentow.js): fabryka na singletonie `db`,
 * trasa UWIERZYTELNIONA i skopowana do właściciela SESJI. Rejestrator lotu prowadzi
 * jedną próbę złożenia oferty i utrwala dowody, które muszą obronić się przed KIO.
 *
 *   • POST /sesje                     — rozpoczyna sesję rejestratora lotu,
 *   • GET  /sesje/:id                 — sesja właściciela + append-only taśma zdarzeń,
 *   • POST /sesje/:id/zdarzenia       — dopisuje zdarzenie do append-only logu (krok/awaria),
 *   • POST /sesje/:id/zrzut           — zapisuje ORYGINAŁ zrzutu ekranu (base64) + wpis 'zrzut',
 *   • POST /sesje/:id/oferta          — hash pliku oferty (SHA-256) + oryginał (upload base64),
 *   • GET  /sesje/:id/pakiet          — buduje i zwraca tamper-evident pakiet dowodowy,
 *   • POST /sesje/:id/pismo           — składa pismo o przedłużenie z pakietu + meta postępowania,
 *   • POST /sesje/:id/awaria          — DETEKCJA → PAKIET → PISMO w jednym kroku (panic button).
 *
 * USŁUGI to samodzielne fabryki na singletonie `db` (`createCzarnaSkrzynka`,
 * `createPakietDowodowy` na tej samej instancji skrzynki) — świadomie, bo repos.js/
 * schema.sql mają niezacommitowany WIP innych funkcji (pułapka drzewa roboczego z pamięci
 * projektu). Magazyn oryginałów na dysku (`CZARNA_SKRZYNKA_STORAGE_DIR`). Bez płatnego AI —
 * generator pisma to czysta funkcja model→tekst (services/pismoOPrzedluzenie.js).
 *
 * IZOLACJA PO WŁAŚCICIELU: własność sesji sprawdzamy WPROST (czysty 404), zanim ruszymy
 * zapis/detekcję — usługa rzuciłaby na cudzą sesję zwykłym Error, który poleciałby jako 500.
 * Pozostałe błędy wejścia usługi (np. pusty typ zdarzenia) mapujemy na 400.
 */

const router = Router();
const skrzynka = createCzarnaSkrzynka(db);
// Pakiet dowodowy dzieli TĘ SAMĄ instancję skrzynki jako źródło sesji i taśmy zdarzeń.
const pakiety = createPakietDowodowy(db, { skrzynka });

// ── Walidacja wejścia ────────────────────────────────────────────────────────

const startSchema = z.object({
  postepowanie_id: z.string().max(200).optional(),
});

const zdarzenieSchema = z.object({
  typ: z.string().min(1).max(60),
  opis: z.string().max(4000).optional(),
});

const zrzutSchema = z.object({
  plik_base64: z.string().min(1),
  opis: z.string().max(400).optional(),
});

const ofertaSchema = z.object({
  plik_base64: z.string().min(1),
  nazwa_pliku: z.string().max(300).optional(),
});

// Meta pisma to kontekst spoza pakietu; wszystkie pola opcjonalne NA POZIOMIE TRASY —
// generator sam oznacza braki wymaganych pól markerem `[UZUPEŁNIJ]` i `kompletne=false`
// (braki NIE giną po cichu). Walidujemy tylko kształt/rozmiar.
const metaSchema = z.object({
  zamawiajacy: z.string().max(2000).optional(),
  numer_postepowania: z.string().max(300).optional(),
  przedmiot_zamowienia: z.string().max(2000).optional(),
  wykonawca: z.string().max(2000).optional(),
  termin_skladania: z.string().max(200).optional(),
  miejscowosc: z.string().max(200).optional(),
  data_pisma: z.string().max(60).optional(),
}).passthrough();

const pismoSchema = z.object({
  meta: metaSchema.optional(),
});

// ── Wspólne: sesja właściciela albo czysty 404 ───────────────────────────────

// Własność sprawdzamy WPROST, zanim ruszymy zapis/detekcję — usługa rzuciłaby na cudzą
// sesję zwykłym Error (→ 500 przez centralny handler); tu chcemy czytelne 404.
function wymagajSesji(req) {
  const sesja = skrzynka.sesja(req.user.id, req.params.id);
  if (!sesja) throw notFound('Nie znaleziono sesji o podanym id.');
  return sesja;
}

// ── Start / podgląd sesji ─────────────────────────────────────────────────────

router.post('/sesje', authRequired, ah(async (req, res) => {
  const parsed = startSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Niepoprawne dane sesji (opcjonalne: "postepowanie_id").');
  const sesja = skrzynka.rozpocznijSesje(req.user.id, { postepowanieId: parsed.data.postepowanie_id ?? null });
  res.status(201).json({ sesja });
}));

router.get('/sesje/:id', authRequired, ah(async (req, res) => {
  const sesja = wymagajSesji(req);
  res.json({ sesja, zdarzenia: skrzynka.zdarzenia(req.user.id, req.params.id) ?? [] });
}));

// ── Dopisanie zdarzenia / zrzutu (append-only) ────────────────────────────────

router.post('/sesje/:id/zdarzenia', authRequired, ah(async (req, res) => {
  wymagajSesji(req);
  const parsed = zdarzenieSchema.safeParse(req.body ?? {});
  // Pusty/nieokreślony typ to błąd wejścia (usługa też go odrzuca) — 400, nie 500.
  if (!parsed.success || !parsed.data.typ.trim()) {
    throw badRequest('Zdarzenie wymaga niepustego "typ" (opcjonalnie "opis").');
  }
  const zdarzenie = skrzynka.dopiszZdarzenie(req.user.id, req.params.id, {
    typ: parsed.data.typ.trim(),
    opis: parsed.data.opis ?? null,
  });
  res.status(201).json({ zdarzenie });
}));

router.post('/sesje/:id/zrzut', authRequired, ah(async (req, res) => {
  wymagajSesji(req);
  const parsed = zrzutSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Podaj "plik_base64" (zrzut zakodowany w base64) i opcjonalnie "opis".');
  const zdarzenie = await skrzynka.zapiszZrzut(req.user.id, req.params.id, parsed.data.plik_base64, {
    ...(parsed.data.opis !== undefined ? { opis: parsed.data.opis } : {}),
  });
  res.status(201).json({ zdarzenie });
}));

// ── Hash pliku oferty (upload base64) ─────────────────────────────────────────

router.post('/sesje/:id/oferta', authRequired, ah(async (req, res) => {
  wymagajSesji(req);
  const parsed = ofertaSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Podaj "plik_base64" (oryginał oferty w base64) i opcjonalnie "nazwa_pliku".');
  const wynik = await skrzynka.zapiszOferte(req.user.id, req.params.id, parsed.data.plik_base64, {
    nazwaPliku: parsed.data.nazwa_pliku ?? '',
  });
  res.status(200).json({ hash: wynik.hash, plik_url: wynik.plikUrl, sesja: wynik.sesja });
}));

// ── Pakiet dowodowy / pismo / awaria ──────────────────────────────────────────

router.get('/sesje/:id/pakiet', authRequired, ah(async (req, res) => {
  wymagajSesji(req);
  res.json({ pakiet: pakiety.zbudujPakiet(req.user.id, req.params.id) });
}));

router.post('/sesje/:id/pismo', authRequired, ah(async (req, res) => {
  wymagajSesji(req);
  const parsed = pismoSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Niepoprawne dane pisma (opcjonalny obiekt "meta").');
  const pakiet = pakiety.zbudujPakiet(req.user.id, req.params.id);
  const pismo = generujPismoOPrzedluzenie(pakiet, parsed.data.meta ?? {});
  res.json({ pismo });
}));

// POST /awaria — panic button: DETEKCJA awarii → budowa PAKIETU → gotowe PISMO w jednym
// kroku (sytuacja krytyczna czasowo — pismo trzeba wysłać PRZED upływem terminu składania).
router.post('/sesje/:id/awaria', authRequired, ah(async (req, res) => {
  wymagajSesji(req);
  const parsed = pismoSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Niepoprawne dane zgłoszenia awarii (opcjonalny obiekt "meta").');
  const pakiet = pakiety.zbudujPakiet(req.user.id, req.params.id);
  const pismo = generujPismoOPrzedluzenie(pakiet, parsed.data.meta ?? {});
  res.json({ awaria: pakiet.awaria, pakiet, pismo });
}));

export default router;
