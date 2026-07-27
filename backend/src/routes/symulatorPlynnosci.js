import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/errors.js';
import { authRequired } from '../middleware/auth.js';
import { wyciagnijParametryFinansowe } from '../services/parametryFinansowe.js';
import { symulujPlynnosc } from '../services/symulacjaPlynnosci.js';
import { rekomendujFinansowanie } from '../services/rekomendacjePlynnosci.js';

/*
 * SYMULATOR PŁYNNOŚCI „CZY UDŹWIGNIESZ KONTRAKT" — endpointy (ulepszenie „Symulator
 * płynności: czy udźwigniesz ten kontrakt", podzadanie 4/6). Samodzielny router spójny
 * ze wzorcem Sejfu/Czarnej skrzynki (routes/czarnaSkrzynka.js): `Router`, walidacja `zod`,
 * `ah` + `badRequest`, trasy UWIERZYTELNIONE.
 *
 *   • POST /parametry     — SWZ + wzór umowy → znormalizowany model finansowy (krok 1/6),
 *   • POST /symulacja     — model + koszty miesięczne → miesięczne przepływy + luka (krok 2/6),
 *   • POST /rekomendacje  — luka + poduszka gotówki → status + konkretne ruchy (krok 3/6),
 *   • POST /analiza       — CAŁA ŚCIEŻKA w jednym kroku (parametry → symulacja → rekomendacje).
 *
 * Świadoma różnica względem Sejfu/Czarnej skrzynki: router jest BEZSTANOWY — spina trzy
 * CZYSTE usługi z kroków 1–3/6 (services/parametryFinansowe.js, symulacjaPlynnosci.js,
 * rekomendacjePlynnosci.js). NIE dotyka DB (nic nie utrwalamy — to kalkulator decyzji
 * „startować czy nie") ani płatnego AI (parser deterministyczny), więc świadomie NIE
 * importuje singletona `db`. Uwierzytelnienie zostaje — to funkcja subskrypcyjna, nie
 * chcemy anonimowego ruchu na trasach liczących.
 *
 * WALIDACJA egzekwuje tylko KSZTAŁT wejścia (typy, obecność treści) — semantykę i wartości
 * brzegowe usługi obsługują same, defensywnie i pesymistycznie dla płynności (braki →
 * bezpieczne domyślne, nie zaniżają luki). Dlatego pola enumeratywne modelu przyjmujemy
 * jako string (usługa mapuje nieznane wartości), a liczby waliduje zod.
 */

const router = Router();

// ── Walidacja wejścia ────────────────────────────────────────────────────────

// SWZ + wzór umowy (oba opcjonalne w schemacie); regułę „co najmniej jeden dokument
// niesie treść" egzekwujemy niżej (maTresc) dla czytelnego 400 — spójnie z /swz i /umowa.
const trescSchema = z.object({
  swz: z.string().optional(),
  umowa: z.string().optional(),
});

/** Czy żądanie w ogóle niesie coś do analizy (SWZ lub wzór umowy). */
function maTresc(d) {
  return Boolean(d.swz?.trim()) || Boolean(d.umowa?.trim());
}

// Model finansowy (wyjście /parametry, wejście /symulacja i /rekomendacje). Waliduje
// tylko KSZTAŁT — liczby jako liczby, pola enumeratywne jako string (usługa sama mapuje),
// passthrough dla zgodności w przód. Usługa jest defensywna wobec braków i złych wartości.
const parametrySchema = z
  .object({
    harmonogramPlatnosci: z.string().optional(),
    terminZaplatyDni: z.number().optional(),
    zabezpieczenieProcent: z.number().optional(),
    zabezpieczenieForma: z.string().optional(),
    zaliczkaProcent: z.number().optional(),
    wadiumKwota: z.number().nullable().optional(),
    cenaBrutto: z.number().nullable().optional(),
  })
  .passthrough();

// Koszty miesięczne (ludzie + materiały) i czas trwania kontraktu w miesiącach — oba
// opcjonalne (usługa domyśla 0 kosztów / 1 mies.), ale gdy podane, muszą być sensowne.
const symulacjaSchema = z.object({
  parametry: parametrySchema,
  kosztyMiesieczne: z.number().nonnegative().optional(),
  czasTrwaniaMies: z.number().positive().optional(),
});

const rekomendacjeSchema = z.object({
  lukaFinansowania: z.number().nonnegative(),
  miesiecyPomostowych: z.number().nonnegative().optional(),
  poduszkaGotowki: z.number().nonnegative().optional(),
  parametry: parametrySchema.optional(),
});

const analizaSchema = z.object({
  swz: z.string().optional(),
  umowa: z.string().optional(),
  kosztyMiesieczne: z.number().nonnegative().optional(),
  czasTrwaniaMies: z.number().positive().optional(),
  poduszkaGotowki: z.number().nonnegative().optional(),
});

// ── Endpointy ─────────────────────────────────────────────────────────────────

// Krok 1/6: SWZ + wzór umowy → znormalizowany, ZAMROŻONY model finansowy kontraktu.
router.post('/parametry', authRequired, ah(async (req, res) => {
  const parsed = trescSchema.safeParse(req.body ?? {});
  if (!parsed.success || !maTresc(parsed.data)) {
    throw badRequest('Podaj treść do analizy: "swz" lub "umowa" (co najmniej jedno).');
  }
  const parametry = wyciagnijParametryFinansowe(parsed.data.swz ?? '', parsed.data.umowa ?? '');
  res.json({ parametry });
}));

// Krok 2/6: model + koszty miesięczne → miesięczne przepływy, luka i miesiące pomostowe.
router.post('/symulacja', authRequired, ah(async (req, res) => {
  const parsed = symulacjaSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj model "parametry" oraz opcjonalnie "kosztyMiesieczne" (≥ 0) i "czasTrwaniaMies" (> 0).');
  }
  const { parametry, kosztyMiesieczne, czasTrwaniaMies } = parsed.data;
  const symulacja = symulujPlynnosc(parametry, { kosztyMiesieczne, czasTrwaniaMies });
  res.json({ symulacja });
}));

// Krok 3/6: luka + poduszka gotówki (+ model) → status decyzji i konkretne ruchy.
router.post('/rekomendacje', authRequired, ah(async (req, res) => {
  const parsed = rekomendacjeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj "lukaFinansowania" (liczba ≥ 0) oraz opcjonalnie "miesiecyPomostowych", "poduszkaGotowki" i "parametry".');
  }
  const rekomendacje = rekomendujFinansowanie(parsed.data);
  res.json({ rekomendacje });
}));

// Skrót: cała ścieżka decyzji „startować czy nie" w jednym żądaniu (SWZ/umowa + koszty
// + poduszka). Wynik = ręczne złożenie /parametry → /symulacja → /rekomendacje.
router.post('/analiza', authRequired, ah(async (req, res) => {
  const parsed = analizaSchema.safeParse(req.body ?? {});
  if (!parsed.success || !maTresc(parsed.data)) {
    throw badRequest('Podaj treść ("swz" lub "umowa") oraz opcjonalnie "kosztyMiesieczne", "czasTrwaniaMies" i "poduszkaGotowki".');
  }
  const { swz, umowa, kosztyMiesieczne, czasTrwaniaMies, poduszkaGotowki } = parsed.data;

  const parametry = wyciagnijParametryFinansowe(swz ?? '', umowa ?? '');
  const symulacja = symulujPlynnosc(parametry, { kosztyMiesieczne, czasTrwaniaMies });
  const rekomendacje = rekomendujFinansowanie({
    lukaFinansowania: symulacja.lukaFinansowania,
    miesiecyPomostowych: symulacja.miesiecyPomostowych,
    poduszkaGotowki,
    parametry,
  });

  res.json({ parametry, symulacja, rekomendacje });
}));

export default router;
