import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Audyt 2026-07-10 (HIGH): `config.js` czytał FAKTUROWNIA_DOMAIN, ale nikt nie
 * dostarczał tej zmiennej do środowiska funkcji — `defineSecret` w index.js jej
 * nie wymieniał. Efekt: `features.invoicing` = false, faktury VAT po cichu
 * pomijane mimo wgranego klucza API. Nikt by tego nie zauważył do pierwszej
 * reklamacji od klienta, który zapłacił i nie dostał faktury.
 *
 * Ten test porównuje zmienne, od których zależą FLAGI FUNKCJI, z listą sekretów
 * faktycznie wstrzykiwanych do funkcji `api`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = fs.readFileSync(path.resolve(__dirname, '../src/config.js'), 'utf8');
const INDEX = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');

/** Zmienne, których brak CICHO wyłącza funkcjonalność (features.*). */
function zmienneFlag() {
  const blok = CONFIG.match(/export const features = \{([\s\S]*?)\};/);
  assert.ok(blok, 'nie znaleziono bloku features w config.js');
  return [...blok[1].matchAll(/env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
}

/** Sekrety zadeklarowane przez defineSecret i wstrzykiwane do funkcji `api`. */
function sekretyFunkcjiApi() {
  const zadeklarowane = new Map(
    [...INDEX.matchAll(/const\s+(\w+)\s*=\s*defineSecret\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g)]
      .map((m) => [m[1], m[2]]),
  );
  const lista = INDEX.match(/const SEKRETY_API = \[([\s\S]*?)\];/);
  assert.ok(lista, 'nie znaleziono listy SEKRETY_API w index.js');
  return new Set(
    lista[1].split(',').map((s) => s.trim()).filter(Boolean)
      .map((nazwaStalej) => zadeklarowane.get(nazwaStalej) ?? nazwaStalej),
  );
}

/*
 * Przełączniki NIE-sekretne z domyślną wartością WŁĄCZAJĄCĄ funkcję.
 * Ryzyko, przed którym broni ten test, to ciche WYŁĄCZENIE — a brak dostarczenia
 * takiej zmiennej zostawia funkcję włączoną. Każdy wpis tutaj musi mieć
 * w config.js jawny default włączający — pilnuje tego asercja niżej, więc
 * zmiana domyślnej wartości na wyłączającą natychmiast cofa wyjątek.
 */
const PRZELACZNIKI_Z_WLACZAJACYM_DOMYSLNYM = {
  TED_ENABLED: /TED_ENABLED:\s*z\.enum\(\['true',\s*'false'\]\)\.default\('true'\)/,
  // Fakturowanie: default WYŁĄCZAJĄCY jest tu ŚWIADOMYM stanem produktu
  // (decyzja usera 2026-07-10, D-048) — brak dostarczenia zmiennej realizuje
  // decyzję, niczego nie psuje po cichu. Wzorzec pilnuje, by wyjątek wygasł,
  // gdy default wróci na 'true' (wtedy zmienna musi być dostarczana jawnie).
  FAKTUROWANIE_ENABLED: /FAKTUROWANIE_ENABLED:\s*z\.enum\(\['true',\s*'false'\]\)\.default\('false'\)/,
};

test('KRYTYCZNE: każda zmienna sterująca features.* dociera do funkcji api', () => {
  const potrzebne = zmienneFlag();
  const dostarczane = sekretyFunkcjiApi();

  for (const [zmienna, wzorzec] of Object.entries(PRZELACZNIKI_Z_WLACZAJACYM_DOMYSLNYM)) {
    assert.match(CONFIG, wzorzec,
      `${zmienna} jest na liście wyjątków, ale config.js nie ma już włączającego defaulta — wyjątek nieaktualny`);
  }

  const brakujace = potrzebne
    .filter((z) => !dostarczane.has(z))
    .filter((z) => !(z in PRZELACZNIKI_Z_WLACZAJACYM_DOMYSLNYM));
  assert.deepEqual(brakujace, [],
    `te zmienne cicho wyłączą funkcjonalność w produkcji: ${brakujace.join(', ')}`);
});

test('features w config.js opisują dokładnie te usługi, które mamy', () => {
  const potrzebne = zmienneFlag();
  // Zabezpieczenie przed sytuacją, w której ktoś usunie flagę i test przestanie cokolwiek badać.
  assert.ok(potrzebne.length >= 4, `spodziewam się co najmniej 4 zmiennych flag, jest ${potrzebne.length}`);
  for (const oczekiwana of ['ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY', 'RESEND_API_KEY', 'FAKTUROWNIA_API_KEY', 'FAKTUROWNIA_DOMAIN']) {
    assert.ok(potrzebne.includes(oczekiwana), `brak ${oczekiwana} wśród zmiennych flag`);
  }
});

test('funkcja cron ma sekrety, których faktycznie używa', () => {
  // dailyTenderFetch woła BZP (bez sekretu), AI (ANTHROPIC) i push; e-maile idą
  // przez Resend przy powiadomieniach. JWT_SECRET jest wymagany przez config.js.
  const blok = INDEX.match(/export const dailyTenderFetch[\s\S]*?secrets:\s*\[([^\]]*)\]/);
  assert.ok(blok, 'nie znaleziono deklaracji sekretów w dailyTenderFetch');
  for (const wymagany of ['JWT_SECRET', 'ANTHROPIC_API_KEY']) {
    assert.ok(blok[1].includes(wymagany), `dailyTenderFetch bez ${wymagany} — zimny start padnie`);
  }
});
