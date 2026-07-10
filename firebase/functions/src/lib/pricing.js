/**
 * Cennik modeli Claude (USD za 1 mln tokenów) — podstawa monitoringu kosztów AI.
 *
 * DECYZJA (PrzetargAI): część PrzetargAI używa JEDNEGO modelu — **Claude Haiku 4.5**.
 * Ocena dopasowania 0–100, streszczenie ogłoszenia, ekstrakcja wymaganych
 * dokumentów to klasyfikacja i streszczanie, nie rozumowanie wieloetapowe. Opus
 * i Fable to 5- i 10-krotność ceny za zdolności, których to zadanie nie potrzebuje.
 * Kontekst Haiku (200K) mieści `htmlBody` ogłoszenia (~8K tokenów) z zapasem.
 * Tę politykę egzekwuje walidacja AI_MATCH_MODEL przy starcie (config/env.js).
 *
 * Ten cennik jest jednak WSPÓŁDZIELONY z Fitter Welder Pro (ten sam backend).
 * fitterScan.js świadomie woła Sonnet 4.6 (wizja: gęste rysunki izometryczne,
 * na których Haiku gubi szczegóły). Cennik to tabela CEN, nie tabela polityki —
 * musi zawierać każdy model, który którakolwiek część backendu realnie wywołuje,
 * inaczej księgowanie kosztu tej części skłamie.
 *
 * Ceny zweryfikowane 2026-07-09 na platform.claude.com/docs/en/about-claude/pricing.
 *
 * NIE dopisuj modeli „na zapas". Każdy zbędny wiersz to cena, która zdezaktualizuje
 * się niezauważona — poprzednia wersja miała Opus 4.7 wyceniony na $15/$75 (to była
 * cena Opus 4.1; realnie $5/$25).
 *
 * Nieznany model **rzuca błąd**. Nie wyceniamy go domyślnie: gdyby ktoś ustawił
 * `AI_MATCH_MODEL=claude-opus-4-8` ($5/$25), wycena „jak Haiku" zaniżyłaby koszt
 * pięciokrotnie, a twardy limit $500 odpaliłby dopiero przy ~$2500 realnego wydatku.
 * Bezpiecznik mierzyłby złą liczbę i nikt by się nie zorientował.
 */

export const MODEL_PRICING = {
  // Haiku 4.5 — PrzetargAI (matching) + Fitter (fitterAi.js). Alias + pełne ID.
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  // Sonnet 4.6 — Fitter (fitterScan.js, wizja). $3/$15.
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
};

/** Batch API: 50% zniżki na wejściu i wyjściu. Nasz ranking dnia liczy się w cronie. */
const BATCH_DISCOUNT = 0.5;

/** Czy potrafimy wycenić ten model? Używane do walidacji konfiguracji przy starcie. */
export function isModelPriced(model) {
  return Boolean(model) && Object.hasOwn(MODEL_PRICING, model);
}

/**
 * Koszt pojedynczego wywołania AI w USD.
 * @param {string} model identyfikator modelu (alias lub pełny)
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {{batch?: boolean}} [opts] `batch: true` gdy wywołanie poszło przez Batch API
 * @throws gdy model nie ma zweryfikowanej ceny — lepiej zatrzymać się głośno,
 *         niż po cichu zaniżyć koszt i rozbroić limit budżetu
 */
export function costUsd(model, inputTokens = 0, outputTokens = 0, opts = {}) {
  if (typeof model !== 'string') {
    throw new TypeError(
      `costUsd: model musi być tekstem, otrzymano ${typeof model}. `
      + 'Argumenty są POZYCYJNE: costUsd(model, inputTokens, outputTokens, { batch }).',
    );
  }
  const price = MODEL_PRICING[model];
  if (!price) {
    throw new Error(
      `Nieznany model AI: "${model}". Brak zweryfikowanej ceny — dopisz go do MODEL_PRICING ` +
      'wraz z ceną z platform.claude.com/docs/en/about-claude/pricing. ' +
      'Nie wyceniamy modeli domyślnie, bo to zaniża koszt i rozbraja limit budżetu.',
    );
  }

  const multiplier = opts.batch ? BATCH_DISCOUNT : 1;
  return ((inputTokens / 1_000_000) * price.input
    + (outputTokens / 1_000_000) * price.output) * multiplier;
}
