import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * „Zapytaj SWZ” przy dowolnym przetargu (2026-10-31): pierwsze pytanie samo bierze SWZ w PDF
 * z dokumentów, zakłada postępowanie na Railway, zapisuje tekst bez płatnej analizy i wiąże je
 * z przetargiem; kolejne pytania idą od razu. Railway i pobieranie PDF-a — atrapy.
 */
process.env.ANTHROPIC_API_KEY = '';
process.env.MOST_ENABLED = 'true';
process.env.MOST_RAILWAY_URL = 'http://127.0.0.1:39127';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');
const { users, tenders, powiazaniaSwz, limitPytanSwz } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { env } = await import('../src/config.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let licznik = 0;
async function uzytkownik() {
  licznik += 1;
  const user = await users.create({ email: `zsp-${process.pid}-${licznik}@test.invalid`, passwordHash: 'x' });
  return { token: signToken(user.id, 0), uid: user.id };
}
async function przetarg(dokumenty) {
  licznik += 1;
  const { tender } = await tenders.upsert({
    externalId: `2026/BZP 0078${process.pid % 1000}${licznik}/01`, title: 'Remont szkoły', deadline: '2099-01-10T09:00:00.000Z', source: 'bzp',
  });
  await tenders.zapiszDokumentyEz(tender.id, dokumenty);
  return tender;
}
const SWZ_PDF = { nazwa: 'SWZ', plik: 'SWZ.pdf', rozszerzenie: 'pdf', url: 'https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/ocds-1/ocds-1_2' };

function podstawRailway(failures = {}) {
  const zadania = [];
  globalThis.fetch = async (url, opcje = {}) => {
    const adres = String(url);
    if (adres === SWZ_PDF.url) {
      if (failures.pdf) throw Error('PDF download unavailable');
      return new Response(Buffer.from('%PDF-1.4 tresc swz'), { status: 200 });
    }
    if (!adres.startsWith(env.MOST_RAILWAY_URL)) return oryginalnyFetch(url, opcje);
    const sciezka = new URL(adres).pathname;
    zadania.push(`${opcje.method ?? 'GET'} ${sciezka}`);
    if (sciezka === '/api/przetarg/swz/postepowania/stale/zapytaj') {
      return Response.json({error:{message:'Missing SWZ'}},{status:failures.staleStatus ?? 404});
    }
    if (sciezka === '/auth/register') return Response.json({ user: { id: `rw-${licznik}` } }, { status: 201 });
    if (sciezka === '/api/przetarg/swz/postepowania') return Response.json({ postepowanie: { id: 'pst-1' } }, { status: 201 });
    if (sciezka === '/api/przetarg/swz/postepowania/pst-1/tresc-pdf') {
      if (failures.text) return Response.json({error:{message:'PDF unreadable'}},{status:422});
      assert.equal(JSON.parse(opcje.body.toString()).swz_pdf_base64, Buffer.from('%PDF-1.4 tresc swz').toString('base64'));
      return Response.json({ znakow: 120 }, { status: 200 });
    }
    if (sciezka === '/api/przetarg/swz/postepowania/pst-1/zapytaj') {
      if (failures.question) throw Error('Response lost after forwarding');
      return Response.json({ odpowiedz: 'Wadium 4 000,00 zł.', status: 'potwierdzone', cytaty: [{ tekst: 'wadium w wysokości 4 000,00 zł', potwierdzony: true }] }, { status: 200 });
    }
    return Response.json({ error: 'atrapa: nieobsługiwana ścieżka' }, { status: 500 });
  };
  return zadania;
}

const zapytaj = (token, id, pytanie) => fetch(`${BAZA}/wygrywalnosc/tender/${encodeURIComponent(id)}/zapytaj-swz`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ pytanie }),
});

for (const status of [404, 409]) {
  test(`stare powiązanie ${status}: nieudana naprawa nie zabiera pytań`, async () => {
    const {token,uid}=await uzytkownik();
    const tender=await przetarg([]);
    await powiazaniaSwz.ustaw(uid,tender.id,{postepowanieId:'stale',nazwa:'Old'});
    podstawRailway({staleStatus:status});
    for(let i=0;i<3;i++) assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,409);
    await tenders.zapiszDokumentyEz(tender.id,[SWZ_PDF]);
    for(let i=0;i<3;i++) assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,200);
    assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,429);
  });
}

test('zwolnienie dotyczy dnia rezerwacji i nie narusza równoległego pytania', async () => {
  const {uid}=await uzytkownik();
  const old='2026-11-10'; const next='2026-11-11';
  for(const day of [old,next]) for(let i=0;i<3;i++) assert.equal(await limitPytanSwz.zarezerwuj(uid,3,day),true);
  await limitPytanSwz.zwolnij(uid,old);
  assert.equal(await limitPytanSwz.zarezerwuj(uid,3,next),false,'nowy dzień bez zwrotu');
  const reserved=await Promise.all(Array.from({length:4},()=>limitPytanSwz.zarezerwuj(uid,3,old)));
  assert.equal(reserved.filter(Boolean).length,1,'dokładnie jedno zwolnione miejsce');
  await assert.rejects(()=>limitPytanSwz.zwolnij(uid),/Reservation day required/);
});

test('pierwsze pytanie: SWZ z PDF → postępowanie z treścią (bez analizy) → powiązanie → odpowiedź; drugie od razu', async () => {
  const { token, uid } = await uzytkownik();
  const tender = await przetarg([SWZ_PDF, { nazwa: 'Załącznik nr 1', rozszerzenie: 'docx', url: 'https://ezamowienia.gov.pl/x_3' }]);
  const zadania = podstawRailway();

  const r1 = await zapytaj(token, tender.id, 'Czy jest wadium?');
  assert.equal(r1.status, 200);
  const d1 = await r1.json();
  assert.deepEqual([d1.status, d1.postepowanie_id], ['potwierdzone', 'pst-1']);
  assert.ok(zadania.includes('POST /api/przetarg/swz/postepowania'));
  assert.ok(zadania.includes('POST /api/przetarg/swz/postepowania/pst-1/tresc-pdf'));
  assert.ok(!zadania.some((z) => z.endsWith('/analiza')), 'bez płatnej analizy');

  assert.equal((await powiazaniaSwz.pobierz(uid, tender.id))?.postepowanie_id, 'pst-1', 'przetarg powiązany z postępowaniem');
  // Pyta o SWZ = szykuje ofertę: przetarg sam trafia do Zapisanych z przypomnieniem o terminie.
  assert.equal(d1.zapisano, true);
  const { getFirestore } = await import('firebase-admin/firestore');
  const zakladka = (await getFirestore().collection('users').doc(uid).collection('saved').doc(tender.id).get()).data();
  assert.equal(zakladka?.tender_id, tender.id);
  assert.equal(zakladka.reminder_enabled, true, 'przypomnienie włączone');

  zadania.length = 0;
  const r2 = await zapytaj(token, tender.id, 'Jakie kryteria?');
  assert.equal(r2.status, 200);
  assert.deepEqual(zadania.filter((z) => !z.includes('/auth/')), ['POST /api/przetarg/swz/postepowania/pst-1/zapytaj'], 'drugie pytanie bez zakładania i pobierania');
  assert.equal((await r2.json()).zapisano, false, 'drugi raz już zapisany');
});

test('bez SWZ w PDF → 409 z instrukcją; za krótkie pytanie → 400; bez tokenu → 401', async () => {
  const { token } = await uzytkownik();
  const tender = await przetarg([{ nazwa: 'Formularz', rozszerzenie: 'docx', url: 'https://ezamowienia.gov.pl/x_9' }]);
  podstawRailway();
  const r = await zapytaj(token, tender.id, 'Czy jest wadium?');
  assert.equal(r.status, 409);
  assert.match((await r.json()).error.message, /Radar SWZ/);
  assert.equal((await zapytaj(token, tender.id, 'a')).status, 400);
  assert.equal((await fetch(`${BAZA}/wygrywalnosc/tender/${tender.id}/zapytaj-swz`, { method: 'POST' })).status, 401);
});

test('brak PDF nie zużywa pytań: po dodaniu dokumentu pozostają trzy próby', async () => {
  const { token } = await uzytkownik();
  const tender = await przetarg([{nazwa:'Formularz',rozszerzenie:'docx',url:'https://ezamowienia.gov.pl/form'}]);
  const zadania = podstawRailway();
  for(let i=0;i<3;i++) assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,409);
  assert.equal(zadania.length,0);
  await tenders.zapiszDokumentyEz(tender.id,[SWZ_PDF]);
  for(let i=0;i<3;i++) assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,200);
  assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,429);
});

for (const failure of ['pdf','text']) {
  test(`nieudane przygotowanie (${failure}) nie odbiera pytań po naprawie`, async () => {
    const {token}=await uzytkownik(); const tender=await przetarg([SWZ_PDF]);
    const failures={[failure]:true};const requests=podstawRailway(failures);
    for(let i=0;i<3;i++)assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,failure==='pdf'?502:422);
    assert.equal(requests.filter(p=>p.endsWith('/zapytaj')).length,0);
    failures[failure]=false;
    for(let i=0;i<3;i++)assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,200);
    assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,429);
  });
}

test('nieznany wynik po wysłaniu pytania nadal zużywa próbę', async () => {
  const {token}=await uzytkownik();const tender=await przetarg([SWZ_PDF]);
  const requests=podstawRailway({question:true});
  for(let i=0;i<3;i++)assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,500);
  assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,429);
  assert.equal(requests.filter(p=>p.endsWith('/zapytaj')).length,3);
});

test('wyczerpany limit blokuje przygotowanie nowego PDF przed pobraniem', async () => {
  const {token}=await uzytkownik();const tender=await przetarg([SWZ_PDF]);
  const failures={};const requests=podstawRailway(failures);
  for(let i=0;i<3;i++)assert.equal((await zapytaj(token,tender.id,'Jakie wadium?')).status,200);
  const other=await przetarg([SWZ_PDF]);failures.pdf=true;requests.length=0;
  assert.equal((await zapytaj(token,other.id,'Jakie wadium?')).status,429);
  assert.equal(requests.length,0);
});

test('plan darmowy: 3 pytania dziennie, czwarte 429 z zachętą do Standardu; Standard bez limitu', async () => {
  const { token } = await uzytkownik();
  const tender = await przetarg([SWZ_PDF]);
  podstawRailway();
  for (let i = 0; i < 3; i++) assert.equal((await zapytaj(token, tender.id, `Pytanie numer ${i}`)).status, 200);
  const czwarte = await zapytaj(token, tender.id, 'Pytanie czwarte');
  assert.equal(czwarte.status, 429);
  assert.match((await czwarte.json()).error.message, /Standard/);

  const standard = await users.create({ email: `zsp-std-${process.pid}-${Date.now()}@test.invalid`, passwordHash: 'x' });
  await users.setTier(standard.id, 'standard');
  const tokenStd = signToken(standard.id, 0);
  for (let i = 0; i < 4; i++) assert.equal((await zapytaj(tokenStd, tender.id, `Pytanie std ${i}`)).status, 200);
});
