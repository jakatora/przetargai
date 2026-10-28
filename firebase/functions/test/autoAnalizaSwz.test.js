import { test } from 'node:test';
import assert from 'node:assert/strict';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders, matches, powiazaniaSwz, autoSwz } = await import('../src/db/repos.js');
const { runAutoAnalizaSwz, wybierzSwz, pobierzPdfBase64 } = await import('../src/jobs/autoAnalizaSwz.js');

/*
 * Automatyczna analiza SWZ (2026-10-28): płatne AI na backendzie, więc testy pilnują przede wszystkim
 * granic kosztu (tylko Standard, limit na dobę i na przebieg, brak duplikatów przy równoległych
 * przebiegach) i tego, że wynik modułu jest SPRAWDZANY (most nie rzuca na kodach HTTP).
 */
const ZNAK = `${process.pid}${Date.now()}`.slice(-8);
let seq = 0;
const TERAZ = '2026-10-28T10:00:00.000Z';
const POST = (n) => `ocds-148610-16f1c19e-be85-4853-82f5-${String(ZNAK + n).padStart(12, '0').slice(-12)}`;
const dokSwz = (pid) => [
  { id: `${pid}_1`, nazwa: 'Załącznik nr 1 do SWZ - Formularz', plik: 'zal1.pdf', rozszerzenie: 'pdf', url: `https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/${pid}/${pid}_1` },
  { id: `${pid}_2`, nazwa: 'Specyfikacja Warunków Zamówienia', plik: 'SWZ.pdf', rozszerzenie: 'pdf', url: `https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/${pid}/${pid}_2` },
];

async function klient({ standard = true } = {}) {
  const u = await users.create({ email: `aswz${ZNAK}-${++seq}@t.pl`, passwordHash: 'h', keywords: ['dach'] });
  if (standard) await users.setTier(u.id, 'standard');
  return users.findById(u.id);
}
async function wybrany(user, { dokumenty = 'swz', source = 'bzp' } = {}) {
  const pid = POST(++seq);
  const { tender } = await tenders.upsert({ externalId: `2026/BZP aswz${ZNAK}${seq}/01`, title: `Remont dachu ${seq}`, organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source, postepowanie_id: pid });
  if (dokumenty === 'swz') await tenders.zapiszDokumentyEz(tender.id, dokSwz(pid), TERAZ);
  if (dokumenty === 'brak') await tenders.zapiszDokumentyEz(tender.id, [], TERAZ);
  await matches.createWithEvaluation({ userId: user.id, tenderId: tender.id, score: 80, reasoning: 'dach', tender });
  return tender;
}
const modulOk = (wywolania, { statusAnalizy = 201 } = {}) => async (_u, { sciezka, dane }) => {
  wywolania.push({ sciezka, dane });
  if (sciezka === '/swz/postepowania') return { status: 201, dane: { postepowanie: { id: `p${wywolania.length}` } } };
  return { status: statusAnalizy, dane: { liczba: 3 } };
};
const pdf = async () => 'JVBERi0xLjcK';

test('wybierzSwz: właściwa specyfikacja przed „Załącznikiem do SWZ”; bez SWZ → null', () => {
  assert.equal(wybierzSwz(dokSwz('x')).plik, 'SWZ.pdf');
  assert.equal(wybierzSwz([{ nazwa: 'OPZ', plik: 'opz.docx', rozszerzenie: 'docx', url: 'u' }]), null);
  assert.equal(wybierzSwz(null), null);
});

test('pobierzPdfBase64: odrzuca nie-PDF i plik > 5 MB; PDF → base64', async () => {
  const pdfBuf = Buffer.from('%PDF-1.7\n');
  assert.equal(await pobierzPdfBase64('u', { fetchFn: async () => ({ ok: true, arrayBuffer: async () => pdfBuf }) }), pdfBuf.toString('base64'));
  await assert.rejects(pobierzPdfBase64('u', { fetchFn: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('<html>') }) }), /nie jest PDF/);
  await assert.rejects(pobierzPdfBase64('u', { fetchFn: async () => ({ ok: true, arrayBuffer: async () => Buffer.alloc(5 * 1024 * 1024 + 1) }) }), /limit 5 MB/);
  await assert.rejects(pobierzPdfBase64('u', { fetchFn: async () => ({ ok: false, status: 503 }) }), /503/);
});

test('przebieg: Standard z SWZ → postępowanie, analiza z PDF, powiązanie i znacznik „gotowe”; Free i bez SWZ pominięci', async () => {
  const s = await klient();
  const f = await klient({ standard: false });
  const t1 = await wybrany(s);
  const bez = await wybrany(s, { dokumenty: 'brak' });
  await wybrany(f);
  const wyw = [];
  const w = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s, f], modul: modulOk(wyw), pobierzPdf: pdf });
  assert.equal(w.ok, true);
  assert.equal(w.analizy, 1);
  assert.equal(w.gotowe, 1);
  assert.deepEqual(wyw.map((x) => x.sciezka), ['/swz/postepowania', '/swz/postepowania/p1/analiza']);
  assert.equal(wyw[0].dane.nazwa, t1.title);
  assert.equal(wyw[1].dane.swz_pdf_base64, 'JVBERi0xLjcK');
  assert.equal((await powiazaniaSwz.pobierz(s.id, t1.id)).postepowanie_id, 'p1');
  const z = await autoSwz.pobierz(s.id, t1.id);
  assert.deepEqual([z.status, z.postepowanie_id, z.liczba_pytan], ['gotowe', 'p1', 3]);
  assert.equal(await autoSwz.pobierz(s.id, bez.id), null, 'bez SWZ nic się nie dzieje');
  assert.equal((await autoSwz.wczytajPrzebieg()).ostatni_przebieg.gotowe, 1);

  // Drugi przebieg: nic nowego (znacznik + powiązanie) — zero wywołań.
  const wyw2 = [];
  await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul: modulOk(wyw2), pobierzPdf: pdf });
  assert.equal(wyw2.length, 0);
});

test('limity kosztu: najwyżej 2 analizy na klienta na dobę i maksNaPrzebieg na przebieg', async () => {
  const s = await klient();
  for (let i = 0; i < 4; i++) await wybrany(s);
  const wyw = [];
  const w = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul: modulOk(wyw), pobierzPdf: pdf });
  assert.equal(w.analizy, 2, 'limit dobowy klienta');
  const w2 = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul: modulOk([]), pobierzPdf: pdf });
  assert.equal(w2.analizy, 0);
  assert.equal(w2.pominiete_limit, 1);

  const a = await klient(); const b = await klient();
  await wybrany(a); await wybrany(b);
  const w3 = await runAutoAnalizaSwz({ teraz: TERAZ, maksNaPrzebieg: 1, wczytajUzytkownikow: async () => [a, b], modul: modulOk([]), pobierzPdf: pdf });
  assert.equal(w3.analizy, 1, 'limit na przebieg');
});

test('równoległe przebiegi: ten sam przetarg analizowany RAZ (zajęcie znacznika przed płatnym AI)', async () => {
  const s = await klient();
  await wybrany(s);
  const wyw = [];
  const wolny = modulOk(wyw);
  const modul = async (...a) => { await new Promise((r) => setTimeout(r, 30)); return wolny(...a); };
  const [x, y] = await Promise.all([
    runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul, pobierzPdf: pdf }),
    runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul, pobierzPdf: pdf }),
  ]);
  assert.equal(x.analizy + y.analizy, 1);
  assert.equal(wyw.filter((c) => c.sciezka.endsWith('/analiza')).length, 1);
});

test('limit czasu analizy: postępowanie i tak powiązane (treść zapisana przed AI), analiza dostaje 240 s', async () => {
  const s = await klient();
  const t = await wybrany(s);
  const limity = [];
  const modul = async (_u, { sciezka, limitMs }) => {
    limity.push(limitMs ?? null);
    if (sciezka === '/swz/postepowania') return { status: 201, dane: { postepowanie: { id: 'pT' } } };
    throw new Error('The operation was aborted due to timeout');
  };
  const w = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul, pobierzPdf: pdf });
  assert.equal(w.bez_analizy, 1);
  assert.deepEqual(limity, [null, 240_000], 'założenie z domyślnym limitem, analiza z 240 s');
  assert.equal((await powiazaniaSwz.pobierz(s.id, t.id)).postepowanie_id, 'pT');
  assert.equal((await autoSwz.pobierz(s.id, t.id)).status, 'tresc_bez_analizy');
});

test('naprawa po limicie z 28.10: znacznik „blad/timeout” → odnalezione po nazwie postępowanie powiązane BEZ płatnego AI, raz', async () => {
  const s = await klient();
  const t = await wybrany(s);
  await autoSwz.zajmij(s.id, t.id, { dokument: 'd', teraz: TERAZ });
  await autoSwz.zakoncz(s.id, t.id, { status: 'blad', blad: 'The operation was aborted due to timeout' });
  const wyw = [];
  const modul = async (_u, { metoda, sciezka }) => {
    wyw.push(`${metoda} ${sciezka}`);
    if (metoda === 'GET') return { status: 200, dane: { postepowania: [{ id: 'stare', nazwa: 'inne' }, { id: 'pX', nazwa: t.title, liczba_pytan: 4 }] } };
    return { status: 201, dane: { postepowanie: { id: 'nowe' } } };
  };
  const w = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul, pobierzPdf: pdf });
  assert.equal(w.naprawione, 1);
  assert.deepEqual(wyw, ['GET /swz/postepowania'], 'bez POST — bez płatnego AI');
  assert.equal((await powiazaniaSwz.pobierz(s.id, t.id)).postepowanie_id, 'pX');
  const z = await autoSwz.pobierz(s.id, t.id);
  assert.deepEqual([z.status, z.liczba_pytan, Boolean(z.naprawa_o)], ['gotowe', 4, true]);
  const w2 = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul, pobierzPdf: pdf });
  assert.equal(w2.naprawione, 0, 'naprawa jednorazowa');
});

test('wynik modułu sprawdzany: 400 (PDF-skan) → bez powiązania; 429/503 → powiązanie z treścią, status „tresc_bez_analizy”; błąd założenia → „blad”', async () => {
  const s = await klient();
  const skan = await wybrany(s);
  await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul: modulOk([], { statusAnalizy: 400 }), pobierzPdf: pdf });
  assert.equal((await autoSwz.pobierz(s.id, skan.id)).status, 'nieczytelny_pdf');
  assert.equal(await powiazaniaSwz.pobierz(s.id, skan.id), null);

  const s2 = await klient();
  const limit = await wybrany(s2);
  await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s2], modul: modulOk([], { statusAnalizy: 429 }), pobierzPdf: pdf });
  assert.equal((await autoSwz.pobierz(s2.id, limit.id)).status, 'tresc_bez_analizy');
  assert.ok(await powiazaniaSwz.pobierz(s2.id, limit.id), 'treść SWZ zapisana przed AI — checklista z niej korzysta');

  const s3 = await klient();
  const zly = await wybrany(s3);
  const w = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s3], modul: async () => ({ status: 503, dane: null }), pobierzPdf: pdf });
  assert.equal(w.bledy, 1);
  assert.equal((await autoSwz.pobierz(s3.id, zly.id)).status, 'blad');
  assert.equal(await powiazaniaSwz.pobierz(s3.id, zly.id), null);
});
