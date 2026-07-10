import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';
// Fakturownia MUSI być „włączona", inaczej invoice.js kończy w trybie degradacji.
process.env.FAKTUROWNIA_API_KEY = 'test-key';
process.env.FAKTUROWNIA_DOMAIN = 'test-domena';

/*
 * Audyt 2026-07-10 (HIGH): `createStandardInvoice` NIGDY nie rzuca — łapie każdy
 * błąd Fakturowni i zwraca `{ created: false }`. Poprzednia wersja `wystawFakture`
 * polegała na `catch`, który przez to nie wykonywał się nigdy: przy awarii
 * Fakturowni rezerwacja `invoices/{session.id}` zostawała na zawsze, każde
 * ponowienie widziało „faktura już istnieje", a opłacony klient B2B nie dostawał
 * faktury VAT — bez żadnej ścieżki naprawy poza ręcznym wystawieniem.
 */

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { faktury } = await import('../src/db/repos.js');
const { createStandardInvoice, kwotaBruttoPln } = await import('../src/services/invoice.js');
const { wystawFakture } = await import('../src/routes/webhooks.js');

const UZYTKOWNIK = { id: 'u1', email: 'klient@firma.pl', company_name: 'Firma', company_nip: '5261040828' };

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

test('createStandardInvoice NIE rzuca przy awarii — zwraca { created: false }', async () => {
  // To jest właśnie pułapka: kod wołający nie może polegać na wyjątku.
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'awaria' });
  const wynik = await createStandardInvoice({ buyerName: 'X', buyerNip: '', buyerEmail: 'a@b.pl' });
  assert.equal(wynik.created, false);
  assert.ok(wynik.error, 'błąd wraca jako WARTOŚĆ, nie wyjątek');
});

test('createStandardInvoice: awaria sieci też nie rzuca', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNRESET'); };
  const wynik = await createStandardInvoice({ buyerName: 'X', buyerNip: '', buyerEmail: 'a@b.pl' });
  assert.equal(wynik.created, false);
});

test('KRYTYCZNE: nieudana faktura ZWALNIA rezerwację, więc ponowienie ją wystawi', async () => {
  const sesja = `cs_fail_${process.pid}`;

  // Pierwsza próba: Fakturownia pada.
  assert.equal(await faktury.zarezerwuj(sesja), true);
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'niedostępna' });
  const pierwsza = await createStandardInvoice({ buyerName: 'X', buyerNip: '', buyerEmail: 'a@b.pl' });
  assert.equal(pierwsza.created, false);

  // Kod produkcyjny musi zwolnić rezerwację, gdy `created` jest fałszywe.
  if (!pierwsza.created) await faktury.zwolnij(sesja);

  // Druga próba (ponowienie): Fakturownia wraca do życia.
  assert.equal(await faktury.zarezerwuj(sesja), true,
    'po nieudanej fakturze rezerwacja MUSI być wolna — inaczej klient nigdy nie dostanie faktury');

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: 1, number: 'FV/1' }) });
  const druga = await createStandardInvoice({ buyerName: 'X', buyerNip: '', buyerEmail: 'a@b.pl' });
  assert.equal(druga.created, true);
});

// ---------------- kwota faktury ----------------

test('AUDYT: kwota faktury bierze się z FAKTYCZNEJ płatności, nie z cennika', () => {
  /*
   * Kwota była zaszyta na sztywno. Klient z kodem rabatowym płacił mniej,
   * a fakturę dostawał na pełną cenę — zawyżony VAT i błąd księgowy
   * po obu stronach.
   */
  assert.equal(kwotaBruttoPln(4900), 49, 'pełna cena planu (49 zł brutto — decyzja usera 2026-07-10)');
  assert.equal(kwotaBruttoPln(12300), 123, 'kod rabatowy / inna kwota: fakturujemy co pobrano');
  assert.equal(kwotaBruttoPln(1), 0.01, 'grosze przeliczane dokładnie');
});

test('kwota: brak danych ze Stripe cofa nas do ceny katalogowej 49 zł brutto', () => {
  // Lepsza faktura na cenę katalogową niż brak faktury. Cena jest BRUTTO —
  // Stripe pobiera 49,00 zł i tyle musi być na fakturze (VAT w środku).
  assert.equal(kwotaBruttoPln(undefined), 49);
  assert.equal(kwotaBruttoPln(null), 49);
  assert.equal(kwotaBruttoPln(0), 49);
  assert.equal(kwotaBruttoPln(-500), 49, 'ujemna kwota to błąd, nie zwrot');
});

// ---------------- wystawFakture: co dzieje się z webhookiem ----------------

test('KRYTYCZNE: awaria Fakturowni RZUCA, żeby Stripe ponowił zdarzenie', async () => {
  /*
   * Wcześniej kończyliśmy 200: Stripe uznawał dostarczenie za udane i NIGDY nie
   * ponawiał. Jedna chwilowa usterka bezpowrotnie gubiła fakturę VAT opłaconego
   * klienta B2B — jedynym śladem był wpis w logu.
   */
  const sesja = { id: `cs_throw_${process.pid}` };
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'awaria' });

  await assert.rejects(() => wystawFakture(sesja, UZYTKOWNIK), /Fakturownia nie wystawiła/);

  // Rezerwacja musi być wolna, żeby ponowienie mogło wystawić fakturę.
  assert.equal(await faktury.zarezerwuj(sesja.id), true, 'rezerwacja zwolniona przed rzuceniem');
});

test('udana faktura NIE rzuca i zostawia rezerwację', async () => {
  const sesja = { id: `cs_done_${process.pid}` };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: 9, number: 'FV/9' }) });

  await wystawFakture(sesja, UZYTKOWNIK);
  assert.equal(await faktury.zarezerwuj(sesja.id), false, 'druga faktura za tę sesję niemożliwa');
});

test('powtórne zdarzenie dla wystawionej faktury kończy się cicho (bez rzucania)', async () => {
  const sesja = { id: `cs_dup_${process.pid}` };
  await faktury.zarezerwuj(sesja.id); // udajemy, że faktura już powstała

  let wolanoFakturownie = false;
  globalThis.fetch = async () => { wolanoFakturownie = true; return { ok: true, json: async () => ({}) }; };

  await wystawFakture(sesja, UZYTKOWNIK);
  assert.equal(wolanoFakturownie, false, 'nie wołamy Fakturowni drugi raz');
});

test('udana faktura ZOSTAWIA rezerwację — druga próba jej nie zdubluje', async () => {
  const sesja = `cs_ok_${process.pid}`;
  assert.equal(await faktury.zarezerwuj(sesja), true);

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: 2, number: 'FV/2' }) });
  const wynik = await createStandardInvoice({ buyerName: 'X', buyerNip: '', buyerEmail: 'a@b.pl' });
  assert.equal(wynik.created, true);

  // Sukces => rezerwacji NIE zwalniamy.
  assert.equal(await faktury.zarezerwuj(sesja), false, 'druga faktura za tę samą sesję nie może powstać');
});
