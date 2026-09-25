import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Praca po odpowiedzi w Cloud Functions ginie (klasa błędu D-044, 2026-09-25).
 *
 * Functions zamrażają CPU instancji po wysłaniu odpowiedzi. `POST /auth/forgot-password`
 * wysyłał mail z kodem resetu BEZ `await` — kod dochodził z opóźnieniem albo wcale
 * (emulator maskuje problem, bo jego proces żyje dalej). To samo dotyczy wpisów
 * audytu w ścieżkach krytycznych (reset, zmiana hasła/e-maila, usunięcie konta):
 * ślad bezpieczeństwa, który „czasem" nie powstaje, nie jest śladem.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { getFirestore } = await import('firebase-admin/firestore');
const { users } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { zaleznosciAuth } = await import('../src/routes/auth.js');
const { audit } = await import('../src/lib/audit.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const oryginalnySendEmail = zaleznosciAuth.sendEmail;
let seq = 0;

async function konto() {
  seq++;
  const email = `aw-${process.pid}-${seq}-${Date.now()}@t.pl`;
  await users.create({ email, passwordHash: 'h' });
  return email;
}

const zapomnialem = (email) => fetch(`${BAZA}/auth/forgot-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
});

test('forgot-password: odpowiedź wychodzi DOPIERO po zakończeniu wysyłki maila z kodem', async () => {
  const email = await konto();
  let zwolnij;
  const wysylka = new Promise((resolve) => { zwolnij = resolve; });
  let wyslanoDo = null;
  zaleznosciAuth.sendEmail = async (mail) => { wyslanoDo = mail.to; await wysylka; return { sent: true }; };

  try {
    let odpowiedziano = false;
    const zadanie = zapomnialem(email).then((r) => { odpowiedziano = true; return r; });

    await new Promise((r) => setTimeout(r, 400));
    assert.equal(wyslanoDo, email, 'wysyłka musiała się zacząć');
    assert.equal(odpowiedziano, false,
      'odpowiedź przed końcem wysyłki = na produkcji mail z kodem ginie w zamrożonej instancji');

    zwolnij();
    const odp = await zadanie;
    assert.equal(odp.status, 200);
  } finally {
    zaleznosciAuth.sendEmail = oryginalnySendEmail;
  }
});

test('forgot-password: błąd wysyłki nie jest ujawniany — odpowiedź identyczna jak dla nieznanego adresu', async () => {
  const email = await konto();
  zaleznosciAuth.sendEmail = async () => { throw new Error('Resend 500'); };
  try {
    const znany = await zapomnialem(email);
    const nieznany = await zapomnialem(`nikt-${process.pid}-${Date.now()}@t.pl`);
    assert.equal(znany.status, 200);
    assert.equal(nieznany.status, 200);
    assert.deepEqual(await znany.json(), await nieznany.json(), 'anty-enumeracja: ta sama odpowiedź');
  } finally {
    zaleznosciAuth.sendEmail = oryginalnySendEmail;
  }
});

test('audit() zwraca obietnicę, po której wpis JUŻ jest w bazie (da się na nią czekać)', async () => {
  const akcja = `test_await_${process.pid}_${Date.now()}`;
  const wynik = audit({ userId: null, action: akcja });
  assert.ok(wynik instanceof Promise, 'bez obietnicy ścieżka krytyczna nie ma na co czekać');
  await wynik;
  const snap = await getFirestore().collection('audit_logs').where('action', '==', akcja).get();
  assert.equal(snap.size, 1);
});

test('audit() nadal nigdy nie rzuca (błąd audytu nie wywraca operacji)', async () => {
  // Niepoprawne pole (undefined w dokumencie) — Firestore odrzuci zapis; audit ma to połknąć.
  await audit({ userId: undefined, action: undefined });
});

test('STRAŻNIK: ścieżki krytyczne w routes/auth.js CZEKAJĄ na audyt', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const kod = fs.readFileSync(path.resolve(__dirname, '../src/routes/auth.js'), 'utf8');
  const krytyczne = ['forgot_password', 'reset_password', 'change_password', 'change_email', 'delete_account'];
  const bezAwait = krytyczne.filter((akcja) => {
    const wywolania = [...kod.matchAll(new RegExp(`(await\\s+)?audit\\(\\{[^}]*action: '${akcja}'`, 'g'))];
    return !wywolania.length || wywolania.some((m) => !m[1]);
  });
  assert.deepEqual(bezAwait, [], 'audyt bez await w ścieżce krytycznej ginie po odpowiedzi (D-044)');
});
