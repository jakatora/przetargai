import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';

/*
 * RODO art. 17 („prawo do bycia zapomnianym") — brakowało w ogóle możliwości
 * usunięcia konta. Regulamin i polityka prywatności obiecują realizację tego prawa
 * na e-mail, ale ręczne kasowanie w Firestore jest pułapką: **usunięcie dokumentu
 * NIE usuwa jego podkolekcji**. Osierocone `matches`, `evaluations`, `ai_quota`
 * i `meta` zostają w bazie na zawsze, a dokumenty rezerwacji `unique/email:...`
 * blokują ponowną rejestrację z tym samym adresem.
 */


const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, tenders, matches, evaluations, aiQuota, backfillCooldown, magicLinks } =
  await import('../src/db/repos.js');

async function kontoZDanymi(email) {
  const u = await users.create({ email, passwordHash: 'h', companyNip: null, keywords: ['droga'] });
  const { tender } = await tenders.upsert({ externalId: `del-${email}`, title: 'Budowa drogi', deadline: null });

  await matches.createWithEvaluation({
    userId: u.id, tenderId: tender.id, score: 80, scorer: 'heuristic', tender, criteriaHash: 'h',
  });
  await evaluations.record(u.id, 'inny-tender', { score: 10, scorer: 'heuristic', criteriaHash: 'h' });
  await aiQuota.reserve(u.id, 5);
  await backfillCooldown.reserve(u.id);
  await magicLinks.create({ userId: u.id, purpose: 'upgrade', ttlMinutes: 10 });
  return u;
}

/** Czy w bazie został JAKIKOLWIEK ślad po użytkowniku. */
async function pozostaleSlady(userId, email) {
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore();
  const userRef = db.collection('users').doc(userId);

  const [dokument, podkolekcje, rezerwacjaEmaila, linki] = await Promise.all([
    userRef.get(),
    userRef.listCollections(),
    db.collection('unique').doc(`email:${email}`).get(),
    db.collection('magic_links').where('user_id', '==', userId).get(),
  ]);

  const nazwyPodkolekcji = [];
  for (const kol of podkolekcje) {
    const snap = await kol.limit(1).get();
    if (!snap.empty) nazwyPodkolekcji.push(kol.id);
  }

  return {
    dokumentIstnieje: dokument.exists,
    podkolekcje: nazwyPodkolekcji,
    rezerwacjaEmaila: rezerwacjaEmaila.exists,
    magicLinki: linki.size,
  };
}

test('RODO: usunięcie konta kasuje dokument, WSZYSTKIE podkolekcje i rezerwacje', async () => {
  const email = `rodo-${process.pid}@t.pl`;
  const u = await kontoZDanymi(email);

  // Przed: dane są.
  const przed = await pozostaleSlady(u.id, email);
  assert.equal(przed.dokumentIstnieje, true);
  assert.ok(przed.podkolekcje.length >= 3, `spodziewam się podkolekcji, jest: ${przed.podkolekcje.join(', ')}`);
  assert.equal(przed.rezerwacjaEmaila, true);
  assert.equal(przed.magicLinki, 1);

  await users.usunKonto(u.id);

  const po = await pozostaleSlady(u.id, email);
  assert.equal(po.dokumentIstnieje, false, 'dokument użytkownika musi zniknąć');
  assert.deepEqual(po.podkolekcje, [], `osierocone podkolekcje: ${po.podkolekcje.join(', ')}`);
  assert.equal(po.rezerwacjaEmaila, false, 'rezerwacja e-maila musi zniknąć, inaczej nie da się zarejestrować ponownie');
  assert.equal(po.magicLinki, 0, 'magic linki użytkownika muszą zniknąć');
});

test('RODO: po usunięciu konta ten sam e-mail można zarejestrować ponownie', async () => {
  const email = `ponow-${process.pid}@t.pl`;
  const u = await kontoZDanymi(email);
  await users.usunKonto(u.id);

  const nowy = await users.create({ email, passwordHash: 'h2' });
  assert.ok(nowy.id);
  assert.notEqual(nowy.id, u.id, 'to nowe konto, nie wskrzeszone stare');
  assert.equal((await matches.listForUser(nowy.id)).length, 0, 'nowe konto nie widzi dopasowań poprzednika');
});

test('RODO: usunięcie konta z NIP-em zwalnia także rezerwację NIP-u', async () => {
  const email = `nip-${process.pid}@t.pl`;
  // NIP unikalny dla tego przebiegu — pliki testowe dzielą jedną bazę emulatora,
  // a stała wartość kolidowałaby z rezerwacją z innego pliku.
  const nip = `nip-testowy-${process.pid}`;
  const u = await users.create({ email, passwordHash: 'h', companyNip: nip });

  await users.usunKonto(u.id);

  // Ta sama firma może założyć konto na nowo.
  const nowy = await users.create({ email: `nip2-${process.pid}@t.pl`, passwordHash: 'h', companyNip: nip });
  assert.ok(nowy.id);
});

test('RODO: usunięcie nieistniejącego konta nie wywraca się', async () => {
  await users.usunKonto('konto-ktorego-nie-ma');
});
