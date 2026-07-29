import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Unieważnianie sesji JWT przy zmianie hasła (audyt 2026-07-29). Token niesie `tv`
 * = token_version konta w chwili wydania; setPassword zwiększa token_version, więc
 * wszystkie starsze tokeny przestają działać. Bez tego skradziona/pozostawiona sesja
 * żyła do 30 dni mimo zmiany hasła. Biegnie na EMULATORZE (authRequired czyta bazę).
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users } = await import('../src/db/repos.js');
const { signToken, authRequired } = await import('../src/middleware/auth.js');
const jwt = (await import('jsonwebtoken')).default;
const { env } = await import('../src/config.js');

/** Przepuszcza token przez authRequired i mówi, czy przeszedł. */
async function przepusc(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  let err = null;
  let ok = false;
  await authRequired(req, {}, (e) => { if (e) err = e; else ok = true; });
  return { ok, err, user: req.user };
}

let seq = 0;
const nowyMail = () => `tv-${process.pid}-${seq++}@t.pl`;

test('token_version: świeży token przechodzi, po zmianie hasła STARY jest odrzucony, NOWY działa', async () => {
  const u = await users.create({ email: nowyMail(), passwordHash: 'h' });
  assert.equal(u.token_version, 0, 'nowe konto startuje z token_version 0');

  const staryToken = signToken(u.id, u.token_version ?? 0);
  const r1 = await przepusc(staryToken);
  assert.ok(r1.ok, 'świeży token musi przejść');
  assert.equal(r1.user.id, u.id);

  await users.setPassword(u.id, 'h2');
  const po = await users.findById(u.id);
  assert.equal(po.token_version, 1, 'setPassword MUSI zwiększyć token_version');

  const r2 = await przepusc(staryToken);
  assert.ok(!r2.ok && r2.err, 'stary token (tv=0) MUSI zostać odrzucony po zmianie hasła');

  const r3 = await przepusc(signToken(u.id, po.token_version));
  assert.ok(r3.ok, 'nowy token (tv=1) po zmianie hasła musi działać');
});

test('token_version: stary token BEZ pola tv działa dla konta bez zmiany hasła (zgodność wsteczna)', async () => {
  const u = await users.create({ email: nowyMail(), passwordHash: 'h' });
  // Token jak sprzed wdrożenia — bez claima `tv`.
  const tokenBezTv = jwt.sign({ sub: u.id }, env.JWT_SECRET, { expiresIn: '30d' });
  const r = await przepusc(tokenBezTv);
  assert.ok(r.ok, 'brak tv = 0; konto token_version 0 → przechodzi (nie wylogowujemy istniejących userów)');
});
