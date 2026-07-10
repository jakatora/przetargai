import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Runda 30: gałąź DEGRADACJI wystawiania faktur nie miała testu, bo
 * fakturaPonowienie.test.js ustawia klucz Fakturowni na sztywno.
 * Ten plik biegnie w OSOBNYM procesie z pustą konfiguracją:
 * features.invoicing === false od chwili importu config.js.
 *
 * Kontrakt trybu degradacji (checkout opłacony, Fakturownia niepodpięta):
 *  1. wystawFakture NIE rzuca — 500 kazałoby Stripe'owi ponawiać przez 3 dni,
 *     a każde ponowienie wysyłałoby klientowi kolejny e-mail aktywacyjny.
 *  2. Rezerwacja invoices/{sesja} jest ZWALNIANA — identyfikator sesji nie może
 *     zostać „spalony", bo po podpięciu Fakturowni faktura ma jeszcze powstać.
 */

process.env.ANTHROPIC_API_KEY = '';
process.env.FAKTUROWNIA_API_KEY = '';
process.env.FAKTUROWNIA_DOMAIN = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { faktury } = await import('../src/db/repos.js');
const { wystawFakture } = await import('../src/routes/webhooks.js');
const { features } = await import('../src/config.js');

const UZYTKOWNIK = { id: 'u-deg', email: 'deg@firma.pl', company_name: 'Firma', company_nip: '' };

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

test('warunek wstępny: bez kluczy Fakturownia jest wyłączona', () => {
  assert.equal(features.invoicing, false,
    'gdyby to padło, cały plik testuje niewłaściwy tryb — sprawdź env na górze pliku');
});

test('degradacja NIE rzuca i NIE dotyka sieci', async () => {
  let ruchSieciowy = 0;
  globalThis.fetch = async (...args) => {
    // Emulator Firestore też chodzi po fetch — liczymy tylko wywołania Fakturowni.
    if (String(args[0]).includes('fakturownia')) ruchSieciowy++;
    return oryginalnyFetch(...args);
  };

  await wystawFakture({ id: `cs_deg_${process.pid}`, amount_total: 24477 }, UZYTKOWNIK);
  assert.equal(ruchSieciowy, 0, 'bez konfiguracji nie wolno wołać Fakturowni');
});

test('degradacja ZWALNIA rezerwację — po podpięciu Fakturowni faktura wciąż może powstać', async () => {
  const sesja = `cs_deg2_${process.pid}`;
  await wystawFakture({ id: sesja, amount_total: 24477 }, UZYTKOWNIK);

  assert.equal(await faktury.zarezerwuj(sesja), true,
    'spalona rezerwacja = klient opłacony przed konfiguracją Fakturowni NIGDY nie dostanie faktury');
});
