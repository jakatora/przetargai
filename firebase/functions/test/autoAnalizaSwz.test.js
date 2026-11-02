import { test } from 'node:test';
import assert from 'node:assert/strict';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders, matches, powiazaniaSwz, autoSwz, alerty } = await import('../src/db/repos.js');
const { runAutoAnalizaSwz, wybierzSwz, pobierzPdfBase64, alertAnalizy, dokumentyPrzetargu, wybierzUmowe, wybierzPrzedmiar, tekstDokumentu, tekstDuzejSwz, dokumentyDoAnalizy } = await import('../src/jobs/autoAnalizaSwz.js');
const { zbudujDocx } = await import('../src/lib/docx.js');

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
  if (typeof dokumenty === 'function') await tenders.zapiszDokumentyEz(tender.id, dokumenty(pid), TERAZ);
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

test('wybierzUmowe: wzór umowy / projektowane postanowienia (PDF, .docx) obok SWZ; zmiana umowy, .doc i obcy host — nie', () => {
  const ez = (n, nazwa, rozszerzenie) => ({ id: `u${n}`, nazwa, rozszerzenie, url: `https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/x/u${n}` });
  const swz = ez(1, 'Specyfikacja Warunków Zamówienia', 'pdf');
  assert.equal(wybierzUmowe([swz, ez(2, 'Załącznik nr 6 do SWZ - Wzór umowy', 'pdf')], swz).id, 'u2');
  assert.equal(wybierzUmowe([ez(3, 'Załącznik nr 3 - Projektowane postanowienia umowy', 'docx')]).id, 'u3');
  assert.equal(wybierzUmowe([ez(4, 'UMOWA', 'docx')]).id, 'u4');
  for (const [nazwa, rozszerzenie] of [['Zmiana umowy', 'docx'], ['Załącznik nr 2 do umowy - protokół', 'pdf'], ['Projekt umowy', 'doc'], ['Formularz ofertowy', 'pdf']]) {
    assert.equal(wybierzUmowe([ez(5, nazwa, rozszerzenie)]), null, nazwa);
  }
  assert.equal(wybierzUmowe([{ ...ez(6, 'Wzór umowy', 'pdf'), url: 'https://evil.example/umowa.pdf' }]), null, 'obcy host');
  assert.equal(wybierzUmowe([swz], swz), null, 'nie ten sam plik co SWZ');
  const przedmiar = ez(7, 'Załącznik nr 9 do SWZ - Przedmiar robót', 'pdf');
  assert.equal(wybierzPrzedmiar([swz, przedmiar], [swz, null]).id, 'u7');
  assert.equal(wybierzPrzedmiar([ez(8, 'Przedmiary', 'zip'), ez(9, 'Przedmiar robót', 'xlsx')]), null, '.zip i .xlsx nie czytamy');
  assert.equal(wybierzPrzedmiar([przedmiar], [przedmiar]), null, 'plik już użyty');
});

test('tekstDokumentu: .docx i PDF z warstwą tekstową → tekst; inny format → null; obcy host → błąd', async () => {
  const U = 'https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/x/u1';
  const odp = (buf) => async () => ({ ok: true, arrayBuffer: async () => buf });
  const docx = zbudujDocx({ nazwa: 'Wzór umowy', tresc: '§ 1. Przedmiot umowy\n§ 5. Kara umowna 0,5% za każdy dzień zwłoki' });
  assert.match(await tekstDokumentu({ url: U }, { fetchFn: odp(docx) }), /Kara umowna 0,5%/);
  const pdfBuf = Buffer.from('%PDF-1.7 ...');
  assert.equal(await tekstDokumentu({ url: U }, { fetchFn: odp(pdfBuf), czytajPdf: async () => ['§ 1', 'Termin: 30 dni'] }), '§ 1\nTermin: 30 dni');
  assert.equal(await tekstDokumentu({ url: U }, { fetchFn: odp(pdfBuf), czytajPdf: async () => [] }), null, 'skan bez tekstu');
  assert.equal(await tekstDokumentu({ url: U }, { fetchFn: odp(Buffer.from('<html>')) }), null);
  await assert.rejects(tekstDokumentu({ url: 'https://evil.example/u.pdf' }, { fetchFn: odp(docx) }), /niedozwolony adres/);
});

test('wybierzSwz: wersja ujednolicona po zmianach (najnowsza) przed oryginałem; pismo „Zmiana SWZ” to nie SWZ', () => {
  const ez = (nazwa, opublikowano) => ({ nazwa, rozszerzenie: 'pdf', opublikowano, url: `https://ezamowienia.gov.pl/x/${encodeURIComponent(nazwa)}` });
  // 2026/BZP 00508332 (2.11): skan „SWZ” z 29.10 (16 MB, bez tekstu) i „SWZ po zmianach” z 2.11 z tekstem.
  assert.equal(wybierzSwz([ez('SWZ', '2026-10-29'), ez('pytania i odpowiedzi', '2026-11-02'), ez('SWZ po zmianach', '2026-11-02')]).nazwa, 'SWZ po zmianach');
  assert.equal(wybierzSwz([ez('SWZ', '2026-10-01'), ez('Zmiana SWZ nr 1 - zmiana terminu', '2026-10-05')]).nazwa, 'SWZ');
  assert.equal(wybierzSwz([ez('SWZ', '2026-10-01'), ez('SWZ - tekst jednolity', '2026-10-05'), ez('SWZ ujednolicona v2', '2026-10-09')]).nazwa, 'SWZ ujednolicona v2');
});

test('alertAnalizy: tylko przy pytaniach; termin pytań w treści, gdy znany i nieminiony', () => {
  assert.equal(alertAnalizy({ id: 't', title: 'X', source: 'bzp', deadline: '2099-01-01T00:00:00.000Z' }, 0, TERAZ), null);
  const a = alertAnalizy({ id: 't', title: 'Remont', source: 'bzp', deadline: '2026-11-20T09:00:00.000Z' }, 5, TERAZ);
  assert.equal(a.klucz, 'auto-swz-t');
  assert.equal(a.typ, 'auto_swz');
  assert.match(a.tresc.pl, /5 szkiców pytań do „Remont”/);
  assert.match(a.tresc.pl, /Pytania można zadać do /);
  assert.match(a.tresc.en, /5 draft questions/);
  const cyt = alertAnalizy({ id: 't2', title: '„Modernizacja dachu”', source: 'bzp', deadline: null }, 2, TERAZ);
  assert.match(cyt.tresc.pl, /do „Modernizacja dachu”\./, 'bez podwójnego cudzysłowu');
  assert.equal(cyt.pozycje[0].tytul, '„Modernizacja dachu”', 'pozycja z oryginalnym tytułem');
});

test('pobierzPdfBase64: odrzuca nie-PDF, plik > 5 MB i obcy host; PDF → base64', async () => {
  const pdfBuf = Buffer.from('%PDF-1.7\n');
  const U = 'https://platformazakupowa.pl/file/get_new/abc.pdf';
  assert.equal(await pobierzPdfBase64(U, { fetchFn: async () => ({ ok: true, arrayBuffer: async () => pdfBuf }) }), pdfBuf.toString('base64'));
  await assert.rejects(pobierzPdfBase64(U, { fetchFn: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('<html>') }) }), /nie jest PDF/);
  await assert.rejects(pobierzPdfBase64(U, { fetchFn: async () => ({ ok: true, arrayBuffer: async () => Buffer.alloc(5 * 1024 * 1024 + 1) }) }), /limit 5 MB/);
  await assert.rejects(pobierzPdfBase64(U, { fetchFn: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(pobierzPdfBase64('https://evil.example/swz.pdf', { fetchFn: async () => { throw new Error('nie wolno'); } }), /niedozwolony adres/);
});

test('dokumentyPrzetargu + wybierzSwz dla platformazakupowa: załączniki szczegółu, PDF ≤ 5 MB, tylko z platformy', () => {
  const t = { source: 'platformazakupowa', pz_szczegol: { zalaczniki: [
    { nazwa: '27_2026 SWZ (zatwierdzona).pdf', rozszerzenie: 'pdf', rozmiar_kb: 16448, url: 'https://platformazakupowa.pl/file/get_new/duzy.pdf' },
    { nazwa: 'Załącznik nr 1 do SWZ.pdf', rozszerzenie: 'pdf', rozmiar_kb: 120, url: 'https://platformazakupowa.pl/file/get_new/zal.pdf' },
    { nazwa: 'SWZ.pdf', rozmiar_kb: 395, url: 'https://platformazakupowa.pl/file/get_new/swz.pdf' },
    { nazwa: 'SWZ-kopia.pdf', rozszerzenie: 'pdf', rozmiar_kb: 10, url: 'https://evil.example/swz.pdf' },
  ] } };
  const d = dokumentyPrzetargu(t);
  assert.equal(d.length, 4);
  assert.equal(d[2].rozszerzenie, 'pdf', 'rozszerzenie z nazwy pliku');
  assert.equal(wybierzSwz(d).url, 'https://platformazakupowa.pl/file/get_new/swz.pdf', 'woli ≤ 5 MB, pomija „Załącznik do SWZ” i obcy host');
  assert.equal(wybierzSwz([d[0], d[1]]).url, 'https://platformazakupowa.pl/file/get_new/duzy.pdf', 'jedyna SWZ ponad 5 MB — czytana tekstem');
  assert.equal(wybierzSwz([{ ...d[0], rozmiar_kb: 26 * 1024 }]), null, 'ponad 25 MB — nie');
  assert.deepEqual(dokumentyPrzetargu({ source: 'ted' }), []);
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
  // Alert w Centrum: 3 szkice pytań → wpis z przetargiem (otwiera szczegół w apce).
  const wpisy = await alerty.lista(s.id);
  const a = wpisy.find((x) => x.typ === 'auto_swz');
  assert.ok(a, 'alert o gotowej analizie');
  assert.match(a.tresc.pl, /^3 szkiców pytań/);
  assert.equal(a.pozycje[0].tender_id, t1.id);
  assert.equal(a.pozycje[0].zrodlo, 'bzp');

  // Drugi przebieg: nic nowego (znacznik + powiązanie) — zero wywołań.
  const wyw2 = [];
  await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul: modulOk(wyw2), pobierzPdf: pdf });
  assert.equal(wyw2.length, 0);
});

test('przebieg: wzór umowy idzie do analizy jako tekst (sprzeczności SWZ ↔ umowa); nieczytelny — analiza bez niego', async () => {
  const s = await klient();
  const zUmowa = (pid) => [...dokSwz(pid), { id: `${pid}_3`, nazwa: 'Załącznik nr 6 do SWZ - Wzór umowy', plik: 'umowa.docx', rozszerzenie: 'docx', url: `https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/${pid}/${pid}_3` },
    { id: `${pid}_4`, nazwa: 'Załącznik nr 7 do SWZ - Przedmiar robót', plik: 'przedmiar.pdf', rozszerzenie: 'pdf', url: `https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/${pid}/${pid}_4` }];
  const t1 = await wybrany(s, { dokumenty: zUmowa });
  const wyw = [];
  const czytane = [];
  const w = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul: modulOk(wyw), pobierzPdf: pdf,
    czytajDokument: async (d) => { czytane.push(d.plik); return d.plik === 'umowa.docx' ? '§ 5. Kary umowne' : 'Poz. 1 Pokrycie dachu 1200 m2'; } });
  assert.deepEqual([w.gotowe, w.z_umowa, w.z_przedmiarem], [1, 1, 1]);
  assert.deepEqual(czytane.sort(), ['przedmiar.pdf', 'umowa.docx']);
  assert.equal(wyw[1].dane.umowa, '§ 5. Kary umowne');
  assert.equal(wyw[1].dane.przedmiar, 'Poz. 1 Pokrycie dachu 1200 m2');
  assert.equal(wyw[1].dane.swz_pdf_base64, 'JVBERi0xLjcK');
  const znacznik = await autoSwz.pobierz(s.id, t1.id);
  assert.deepEqual([znacznik.umowa, znacznik.przedmiar], ['Załącznik nr 6 do SWZ - Wzór umowy', 'Załącznik nr 7 do SWZ - Przedmiar robót']);

  const s2 = await klient();
  const t2 = await wybrany(s2, { dokumenty: zUmowa });
  const wyw2 = [];
  const w2 = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s2], modul: modulOk(wyw2), pobierzPdf: pdf,
    czytajDokument: async () => { throw new Error('Pobranie wzoru umowy: HTTP 400'); } });
  assert.deepEqual([w2.gotowe, w2.z_umowa], [1, undefined], 'błąd umowy nie zatrzymuje analizy SWZ');
  assert.equal('umowa' in wyw2[1].dane || 'przedmiar' in wyw2[1].dane, false);
  assert.equal((await autoSwz.pobierz(s2.id, t2.id)).umowa, undefined);
});

test('SWZ ponad 5 MB: tekst czytany w Functions idzie jako `swz` (bez PDF-a); skan → „nieczytelny_pdf” bez wywołań', async () => {
  const zaDuza = async () => { throw Object.assign(new Error('SWZ ma 16 MB — limit 5 MB'), { zaDuzy: true }); };
  const s = await klient();
  await wybrany(s);
  const wyw = [];
  const w = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul: modulOk(wyw), pobierzPdf: zaDuza,
    czytajDuzaSwz: async () => 'Rozdział I. Zamawiający…' });
  assert.equal(w.gotowe, 1);
  assert.equal(wyw[1].dane.swz, 'Rozdział I. Zamawiający…');
  assert.equal('swz_pdf_base64' in wyw[1].dane, false);

  const s2 = await klient();
  const t2 = await wybrany(s2);
  const wyw2 = [];
  const w2 = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s2], modul: modulOk(wyw2), pobierzPdf: zaDuza, czytajDuzaSwz: async () => null });
  assert.deepEqual([w2.nieczytelne, wyw2.length], [1, 0], 'bez tekstu — bez płatnego wywołania');
  assert.equal((await autoSwz.pobierz(s2.id, t2.id)).status, 'nieczytelny_pdf');
});

test('tekstDuzejSwz: do 25 MB, tylko PDF; większy plik → błąd z limitem 25 MB', async () => {
  const U = 'https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/x/s1';
  const odp = (buf) => async () => ({ ok: true, arrayBuffer: async () => buf });
  const duzy = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(6 * 1024 * 1024)]);
  assert.equal(await tekstDuzejSwz({ url: U }, { fetchFn: odp(duzy), czytajPdf: async () => ['SWZ', 'Rozdział I'] }), 'SWZ\nRozdział I');
  assert.equal(await tekstDuzejSwz({ url: U }, { fetchFn: odp(Buffer.alloc(6 * 1024 * 1024)) }), null, 'nie PDF');
  await assert.rejects(tekstDuzejSwz({ url: U }, { fetchFn: odp(Buffer.alloc(25 * 1024 * 1024 + 1)) }), /limit 25 MB/);
  await assert.rejects(pobierzPdfBase64(U, { fetchFn: odp(duzy) }), (err) => err.zaDuzy === true && /limit 5 MB/.test(err.message));
});

test('przebieg: przetarg z platformazakupowa z SWZ w załącznikach → analiza i powiązanie', async () => {
  const s = await klient();
  const { tender } = await tenders.upsert({ externalId: `pz:aswz${ZNAK}${++seq}`, title: `Remont szkoły ${seq}`, organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'platformazakupowa' });
  await tenders.zapiszSzczegolPz(tender.id, { tryb: 'Tryb podstawowy', zalaczniki: [{ nazwa: 'SWZ.pdf', rozszerzenie: 'pdf', rozmiar_kb: 395, url: 'https://platformazakupowa.pl/file/get_new/swz.pdf' }] });
  await matches.createWithEvaluation({ userId: s.id, tenderId: tender.id, score: 80, reasoning: 'szkoła', tender });
  const pobrane = [];
  const w = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul: modulOk([]), pobierzPdf: async (u) => { pobrane.push(u); return 'JVBE'; } });
  assert.equal(w.gotowe, 1);
  assert.deepEqual(pobrane, ['https://platformazakupowa.pl/file/get_new/swz.pdf']);
  assert.ok(await powiazaniaSwz.pobierz(s.id, tender.id));
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

test('zapytanie ofertowe (BK, platformazakupowa): „Zapytanie ofertowe….pdf” to główny dokument; erraty, odpowiedzi i załączniki — nie', () => {
  const bk = (nazwa) => ({ nazwa, rozszerzenie: 'pdf', url: `https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/files/${nazwa.length}` });
  const docs = [bk('Zapytanie ofertowe-lampy wewnętrzne-Errata do ogłoszenia.pdf'), bk('Załącznik nr 1 do zapytania ofertowego.pdf'),
    bk('Odpowiedzi na pytania do zapytania.pdf'), bk('Zapytanie ofertowe-lampy wewnętrzne.pdf')];
  assert.equal(wybierzSwz(docs, { zrodlo: 'baza_konkurencyjnosci' }).nazwa, 'Zapytanie ofertowe-lampy wewnętrzne.pdf');
  assert.equal(wybierzSwz(docs), null, 'bez źródła zapytań — tylko SWZ');
  const pz = { nazwa: 'Zapytanie ofertowe.pdf', rozszerzenie: 'pdf', url: 'https://platformazakupowa.pl/file/get_new/zo.pdf' };
  assert.equal(wybierzSwz([pz], { zrodlo: 'platformazakupowa' }).nazwa, 'Zapytanie ofertowe.pdf');
  assert.equal(wybierzSwz([pz], { zrodlo: 'bzp' }), null);
  const word = { ...bk('Zapytanie ofertowe 2.0_remont pomieszczeń.pdf'), nazwa: 'Zapytanie ofertowe 2.0_remont pomieszczeń.docx', rozszerzenie: 'docx' };
  assert.equal(wybierzSwz([word], { zrodlo: 'baza_konkurencyjnosci' }).rozszerzenie, 'docx', 'tylko Word — bierzemy Worda');
  assert.equal(wybierzSwz([word, docs[3]], { zrodlo: 'baza_konkurencyjnosci' }).rozszerzenie, 'pdf', 'PDF przed Wordem');
});

test('dokumentyDoAnalizy: BK — załączniki ze szczegółu ogłoszenia (id bez prefiksu); inne źródła bez żądania', async () => {
  const { default: fixture } = await import('./fixtures/bk-szczegol-292028.json', { with: { type: 'json' } });
  const pytane = [];
  const d = await dokumentyDoAnalizy({ id: 'bk:292028', source: 'baza_konkurencyjnosci' }, { szczegolBk: async (id) => { pytane.push(id); return fixture; } });
  assert.deepEqual(pytane, ['292028']);
  assert.equal(d.length, 3);
  assert.equal(d[0].url, 'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/files/3080166');
  assert.equal(wybierzSwz(d, { zrodlo: 'baza_konkurencyjnosci' }).plik, "ZO'PB3'03-Zapytanie-Wynajem+catering-LSOS2026.pdf");
  assert.deepEqual(await dokumentyDoAnalizy({ source: 'bzp', ez_dokumenty: [{ id: 'x' }] }, { szczegolBk: async () => { throw new Error('nie wolno'); } }), [{ id: 'x' }]);
});

test('przebieg: zapytanie z Bazy Konkurencyjności → załączniki ze szczegółu, analiza zapytania ofertowego', async () => {
  const { default: fixture } = await import('./fixtures/bk-szczegol-292028.json', { with: { type: 'json' } });
  const s = await klient();
  const { tender } = await tenders.upsert({ externalId: `bk:aswz${ZNAK}${++seq}`, title: `Wynajem sali ${seq}`, organization: 'Fundacja', deadline: '2099-01-01T00:00:00.000Z', source: 'baza_konkurencyjnosci' });
  await matches.createWithEvaluation({ userId: s.id, tenderId: tender.id, score: 80, reasoning: 'sala', tender });
  const wyw = [];
  const pobrane = [];
  const w = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s], modul: modulOk(wyw),
    pobierzPdf: async (url) => { pobrane.push(url); return 'JVBERi0xLjcK'; }, szczegolBk: async () => fixture, czytajDokument: async () => null });
  assert.equal(w.gotowe, 1);
  assert.deepEqual(pobrane, ['https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/files/3080166']);
  assert.equal((await powiazaniaSwz.pobierz(s.id, tender.id)).postepowanie_id, 'p1');

  // Zapytanie tylko w .docx → tekst czytany tutaj, backend dostaje `swz`, bez pobierania PDF-a.
  const s2 = await klient();
  const { tender: t2 } = await tenders.upsert({ externalId: `bk:aswz${ZNAK}${++seq}`, title: `Remont ${seq}`, organization: 'Szkoła', deadline: '2099-01-01T00:00:00.000Z', source: 'baza_konkurencyjnosci' });
  await matches.createWithEvaluation({ userId: s2.id, tenderId: t2.id, score: 80, reasoning: 'remont', tender: t2 });
  const tylkoWord = { data: { advertisement: { attachments: [{ id: 1, name: 'Zapytanie ofertowe 2.0_remont pomieszczeń', file: { id: 9, name: 'Zapytanie ofertowe 2.0_remont pomieszczeń.docx', uri: '/api/files/9' } }] } } };
  const wyw2 = [];
  const w2 = await runAutoAnalizaSwz({ teraz: TERAZ, wczytajUzytkownikow: async () => [s2], modul: modulOk(wyw2),
    pobierzPdf: async () => { throw new Error('PDF nie powinien być pobierany'); }, szczegolBk: async () => tylkoWord,
    czytajDokument: async (d) => (d.rozszerzenie === 'docx' ? '§ 1. Przedmiot zapytania' : null) });
  assert.equal(w2.gotowe, 1);
  assert.equal(wyw2[1].dane.swz, '§ 1. Przedmiot zapytania');
  assert.equal('swz_pdf_base64' in wyw2[1].dane, false);
});
