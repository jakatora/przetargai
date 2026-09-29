import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Job przypomnień o terminie pytań do SWZ (funkcja A, 2026-09-29).
 *
 * Wysyłka idzie przez WSTRZYKNIĘTEGO dostawcę (`wyslij`) — zero realnych pushy.
 * „Teraz" też jest wstrzykiwane (rok 2098), więc test nie zależy od zegara i nie
 * miesza się z wpisami innych plików testów w tym samym emulatorze.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, tenders, saved } = await import('../src/db/repos.js');
const { runPrzypomnieniaPytanSwz, MAKS_PROB_WYSYLKI_PYTAN } = await import('../src/jobs/przypomnieniaPytanSwz.js');

// Termin składania 10.03.2098 09:00Z → termin pytań (BZP, −4 dni) 6.03.2098 09:00Z.
const TERMIN_SKLADANIA = '2098-03-10T09:00:00.000Z';
const TERMIN_PYTAN = '2098-03-06T09:00:00.000Z';
const W_OKNIE = '2098-03-05T21:00:00.000Z'; // 12 h przed terminem pytań
const PRZED_OKNEM = '2098-03-04T21:00:00.000Z'; // 36 h przed

let seq = 0;
async function uzytkownik({ token = 'ExponentPushToken[pytania]' } = {}) {
  seq += 1;
  const u = await users.create({ email: `pytania-${process.pid}-${seq}@test.invalid`, passwordHash: 'h', keywords: ['x'] });
  if (token) await users.setPushToken(u.id, token);
  return u.id;
}

async function zapisanyPrzetarg(userId, { source = 'bzp', deadline = TERMIN_SKLADANIA, przypomnienie = true } = {}) {
  seq += 1;
  const { tender } = await tenders.upsert({
    externalId: `${source === 'bzp' ? '' : `${source}:`}2098/PYT ${process.pid}${seq}/01`,
    source,
    title: `Przetarg pytania ${seq}`,
    deadline,
  });
  await saved.add(userId, {
    tender_id: tender.id, tender_title: tender.title, tender_deadline: deadline, tender_source: source,
  });
  if (przypomnienie) await saved.setReminder(userId, tender.id, true);
  return tender.id;
}

/** Testowy dostawca push: zapisuje wysyłki, odpowiada zaprogramowanym wynikiem. */
function dostawca(wynik = () => ({ sent: 1, failed: 0, martweTokeny: [] })) {
  const wyslane = [];
  const wyslij = async (token, tresc) => {
    wyslane.push({ token, ...tresc });
    return wynik();
  };
  return { wyslane, wyslij };
}

const dla = (wyslane, tenderId) => wyslane.filter((w) => w.data?.tender_id === tenderId);

test('w ostatniej dobie: dokładnie jedno powiadomienie PL prowadzące do przetargu i terminu', async () => {
  const userId = await uzytkownik();
  const tenderId = await zapisanyPrzetarg(userId);
  const { wyslane, wyslij } = dostawca();

  await runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij });

  const moje = dla(wyslane, tenderId);
  assert.equal(moje.length, 1);
  assert.equal(moje[0].token, 'ExponentPushToken[pytania]');
  assert.match(moje[0].title, /pytania do SWZ/i);
  assert.match(moje[0].body, /6 marca 2098, 10:00/, 'czas warszawski (CET)');
  assert.deepEqual(moje[0].data, { type: 'swz_questions_reminder', tender_id: tenderId, termin: TERMIN_PYTAN });
});

test('ponowny przebieg nie duplikuje', async () => {
  const userId = await uzytkownik();
  const tenderId = await zapisanyPrzetarg(userId);
  const { wyslane, wyslij } = dostawca();

  await runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij });
  await runPrzypomnieniaPytanSwz({ teraz: '2098-03-06T03:00:00.000Z', wyslij });
  assert.equal(dla(wyslane, tenderId).length, 1);
});

test('dwa równoległe przebiegi wysyłają jedno powiadomienie', async () => {
  const userId = await uzytkownik();
  const tenderId = await zapisanyPrzetarg(userId);
  const { wyslane, wyslij } = dostawca();

  await Promise.all([
    runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij }),
    runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij }),
  ]);
  assert.equal(dla(wyslane, tenderId).length, 1);
});

test('błąd dostawcy to NIE sukces: przypomnienie wraca w kolejnym przebiegu', async () => {
  const userId = await uzytkownik();
  const tenderId = await zapisanyPrzetarg(userId);
  let awaria = true;
  const { wyslane, wyslij } = dostawca(() => (awaria
    ? { sent: 0, failed: 1, bledy: { InvalidCredentials: 1 }, martweTokeny: [] }
    : { sent: 1, failed: 0, martweTokeny: [] }));

  const pierwszy = await runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij });
  assert.ok(pierwszy.nieudane >= 1);
  assert.equal(pierwszy.ok, true, 'awaria dostawcy to nie awaria joba — ponowi następny przebieg');

  awaria = false;
  await runPrzypomnieniaPytanSwz({ teraz: '2098-03-06T03:00:00.000Z', wyslij });
  await runPrzypomnieniaPytanSwz({ teraz: '2098-03-06T05:00:00.000Z', wyslij });
  assert.equal(dla(wyslane, tenderId).length, 2, 'jedna nieudana próba + jedna udana, bez duplikatu po sukcesie');
});

test(`trwała awaria dostawcy: po ${MAKS_PROB_WYSYLKI_PYTAN} próbach koniec prób`, async () => {
  const userId = await uzytkownik();
  const tenderId = await zapisanyPrzetarg(userId);
  const { wyslane, wyslij } = dostawca(() => ({ sent: 0, failed: 1, bledy: { MessageRateExceeded: 1 }, martweTokeny: [] }));
  for (const godzina of ['21', '22', '23']) {
    await runPrzypomnieniaPytanSwz({ teraz: `2098-03-05T${godzina}:30:00.000Z`, wyslij });
  }
  await runPrzypomnieniaPytanSwz({ teraz: '2098-03-06T05:00:00.000Z', wyslij });
  assert.equal(dla(wyslane, tenderId).length, MAKS_PROB_WYSYLKI_PYTAN);
});

test('przed oknem i po terminie — bez wysyłki', async () => {
  const userId = await uzytkownik();
  const tenderId = await zapisanyPrzetarg(userId);
  const { wyslane, wyslij } = dostawca();
  await runPrzypomnieniaPytanSwz({ teraz: PRZED_OKNEM, wyslij });
  await runPrzypomnieniaPytanSwz({ teraz: '2098-03-06T09:30:00.000Z', wyslij });
  assert.equal(dla(wyslane, tenderId).length, 0);
});

test('preferencja użytkownika: przypomnienie wyłączone — bez wysyłki', async () => {
  const userId = await uzytkownik();
  const tenderId = await zapisanyPrzetarg(userId, { przypomnienie: false });
  const { wyslane, wyslij } = dostawca();
  await runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij });
  assert.equal(dla(wyslane, tenderId).length, 0);
});

test('rejestr bez ustawowego terminu pytań (Baza Konkurencyjności) — bez zmyślonego terminu i bez wysyłki', async () => {
  const userId = await uzytkownik();
  const tenderId = await zapisanyPrzetarg(userId, { source: 'bk' });
  const { wyslane, wyslij } = dostawca();
  await runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij });
  assert.equal(dla(wyslane, tenderId).length, 0);
});

test('bez tokenu push: nic nie wysyłamy, a po nadaniu zgody w oknie przypomnienie dochodzi', async () => {
  const userId = await uzytkownik({ token: null });
  const tenderId = await zapisanyPrzetarg(userId);
  const { wyslane, wyslij } = dostawca();
  await runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij });
  assert.equal(dla(wyslane, tenderId).length, 0);

  await users.setPushToken(userId, 'ExponentPushToken[pozniej]');
  await runPrzypomnieniaPytanSwz({ teraz: '2098-03-06T03:00:00.000Z', wyslij });
  assert.equal(dla(wyslane, tenderId).length, 1);
});
