import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Eksport CSV (P2-3) przez realny serwer HTTP na emulatorze.
 * RESEND_API_KEY pusty → e-mail w trybie degradacji (nic nie wychodzi na zewnątrz).
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { saved, tenders } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { LIMIT_WYSYLEK_DZIENNIE, eksportKatalogu, MAKS_SKANU_EKSPORTU, MAKS_PISM_W_PAKIECIE } = await import('../src/routes/eksport.js');
const { BOM } = await import('../src/lib/eksportCsv.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const ZNAK = `ek${process.pid}x${Date.now()}`;
let seq = 0;

async function konto() {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `ek-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123' }),
  });
  const { token, user } = await odp.json();
  return { token, userId: user.id };
}
const naglowki = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

describe('GET /eksport/*.csv', () => {
  test('bez tokenu 401', async () => {
    assert.equal((await fetch(`${BAZA}/eksport/zapisane.csv`)).status, 401);
  });

  test('zapisane: BOM, nagłówek po polsku, średnik, ochrona formuł', async () => {
    const { token, userId } = await konto();
    await saved.add(userId, {
      tender_id: `${ZNAK}-S1`,
      tender_title: '=HYPERLINK("http://zly";"kliknij")',
      tender_organization: 'Gmina Łódź',
      tender_deadline: '2026-10-05T08:00:00.000Z',
      tender_budget: 1250000.5,
      tender_source: 'bzp',
    });
    const odp = await fetch(`${BAZA}/eksport/zapisane.csv`, { headers: naglowki(token) });
    assert.equal(odp.status, 200);
    assert.match(odp.headers.get('content-type'), /text\/csv/);
    assert.match(odp.headers.get('content-disposition'), /przetargai-zapisane-\d{4}-\d{2}-\d{2}\.csv/);
    const bajty = Buffer.from(await odp.arrayBuffer());
    const tekst = bajty.toString('utf8');
    assert.ok(tekst.startsWith(BOM), 'BOM musi dojść do klienta');
    assert.match(tekst, /Przedmiot zamówienia;Zamawiający;Etap/);
    assert.match(tekst, /"'=HYPERLINK/);
    assert.match(tekst, /Gmina Łódź/);
    assert.match(tekst, /1250000,5/);
    assert.match(tekst, /2026-10-05 10:00/);
    assert.equal(odp.headers.get('x-wierszy'), '1');
  });

  test('katalog: filtry jak w GET /tenders', async () => {
    const { token } = await konto();
    await tenders.upsert({
      externalId: `${ZNAK}-K1`,
      title: `Eksportowalny przetarg ${ZNAK}`,
      organization: 'Szpital',
      cpvMain: '33100000',
      source: 'bzp',
      wojewodztwo: 'PL14',
      deadline: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      publishedAt: new Date().toISOString(),
    });
    const odp = await fetch(`${BAZA}/eksport/katalog.csv?cpv=33100000`, { headers: naglowki(token) });
    assert.equal(odp.status, 200);
    const tekst = await odp.text();
    assert.match(tekst, new RegExp(`Eksportowalny przetarg ${ZNAK}`));
    assert.match(tekst, /Mazowieckie/);
  });
});

describe('POST /eksport/wyslij', () => {
  test('wysyła na adres z KONTA, nie z żądania', async () => {
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/eksport/wyslij`, {
      method: 'POST', headers: naglowki(token),
      body: JSON.stringify({ rodzaj: 'zapisane', to: 'obcy@example.com' }),
    });
    assert.equal(odp.status, 200);
    const dane = await odp.json();
    assert.match(dane.do, /@t\.pl$/);
    assert.equal(dane.tryb_degradacji, true, 'w testach bez RESEND nic nie wychodzi');
  });

  test('zły rodzaj → 400', async () => {
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/eksport/wyslij`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ rodzaj: 'wszystko' }) });
    assert.equal(odp.status, 400);
  });

  test(`dzienny limit ${LIMIT_WYSYLEK_DZIENNIE} wysyłek → potem 429`, async () => {
    const { token } = await konto();
    for (let i = 0; i < LIMIT_WYSYLEK_DZIENNIE; i++) {
      const odp = await fetch(`${BAZA}/eksport/wyslij`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ rodzaj: 'zapisane' }) });
      assert.equal(odp.status, 200, `wysyłka ${i + 1}`);
    }
    const ponad = await fetch(`${BAZA}/eksport/wyslij`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ rodzaj: 'zapisane' }) });
    assert.equal(ponad.status, 429);
  });
});

describe('POST /eksport/wyslij — kalendarz ICS', () => {
  test('rodzaj kalendarz → plik .ics z terminami zapisanych', async () => {
    const { token, userId } = await konto();
    await saved.add(userId, {
      tender_id: `${ZNAK}-ICS`, tender_title: 'Przetarg z terminem',
      tender_deadline: new Date(Date.now() + 20 * 86_400_000).toISOString(), tender_source: 'bzp',
    });
    const odp = await fetch(`${BAZA}/eksport/wyslij`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ rodzaj: 'kalendarz' }) });
    assert.equal(odp.status, 200);
    const dane = await odp.json();
    assert.match(dane.plik, /^przetargai-terminy-\d{4}-\d{2}-\d{2}\.ics$/);
    assert.equal(dane.wierszy, 1);
  });
});

/*
 * EKSPORT KATALOGU A SUFIT SKANU (naprawa 2026-09-25).
 *
 * Katalog czyta najwyżej 1200 dokumentów na wywołanie. Przy rzadkim filtrze strona
 * potrafi wrócić PUSTA, choć dane się nie skończyły (`wyczerpano: false`). Eksport
 * przerywał wtedy pętlę i oddawał plik z `obciety: false` — czyli „to już wszystko",
 * choć za sufitem skanu leżały pasujące ogłoszenia.
 */
test('pusta strona przy NIEWYCZERPANYM skanie nie kończy eksportu — dociąga dalsze trafienia', async () => {
  const strony = [
    { wiersze: [], ostatni: { wartosc: 'a', id: '1' }, przeskanowano: 1200, wyczerpano: false },
    { wiersze: [{ id: 't1', title: 'Rzadkie trafienie' }], ostatni: null, przeskanowano: 300, wyczerpano: true },
  ];
  const kursory = [];
  const plik = await eksportKatalogu({}, '2026-09-25T10:00:00.000Z', {
    katalog: async ({ kursor }) => { kursory.push(kursor); return strony.shift(); },
  });
  assert.equal(plik.wierszy, 1, 'trafienie za pustą stroną musi trafić do pliku');
  assert.equal(plik.obciety, false, 'skan wyczerpany — plik jest kompletny');
  assert.deepEqual(kursory[1], { wartosc: 'a', id: '1' }, 'druga strona rusza od kursora pierwszej');
});

test('eksport przerwany sufitem skanu mówi prawdę: `obciety: true`', async () => {
  let wywolan = 0;
  const plik = await eksportKatalogu({}, '2026-09-25T10:00:00.000Z', {
    katalog: async () => {
      wywolan += 1;
      return { wiersze: [], ostatni: { wartosc: String(wywolan), id: String(wywolan) }, przeskanowano: 1200, wyczerpano: false };
    },
  });
  assert.equal(plik.wierszy, 0);
  assert.equal(plik.obciety, true, 'niewyczerpany skan to NIE jest pełny wynik');
  assert.ok(wywolan * 1200 >= MAKS_SKANU_EKSPORTU && wywolan * 1200 < MAKS_SKANU_EKSPORTU + 1200,
    'pętla kończy się na budżecie skanu, nie wcześniej i nie w nieskończoność');
});

describe('POST /eksport/pismo — pismo jako Word na e-mail konta', () => {
  test('poprawne pismo → plik .docx na adres z konta (w testach tryb degradacji), ignoruje `to` z żądania', async () => {
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/eksport/pismo`, {
      method: 'POST', headers: naglowki(token),
      body: JSON.stringify({ nazwa: 'Wniosek o zwrot wadium', tresc: 'Treść\nlinia 2', to: 'obcy@example.com' }),
    });
    assert.equal(odp.status, 200);
    const dane = await odp.json();
    assert.match(dane.do, /@t\.pl$/);
    assert.equal(dane.plik, 'Wniosek o zwrot wadium.docx');
    assert.equal(dane.tryb_degradacji, true);
  });

  test('pakiet pism → jeden e-mail, osobne pliki, powtórzone nazwy numerowane; pusty albo za duży pakiet → 400', async () => {
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/eksport/pismo`, {
      method: 'POST', headers: naglowki(token),
      body: JSON.stringify({ tytul: 'Dokumenty do oferty — Remont dachu', pisma: [
        { nazwa: 'Formularz ofertowy', tresc: 'a' }, { nazwa: 'Oświadczenie', tresc: 'b' }, { nazwa: 'Oświadczenie', tresc: 'c' },
      ] }),
    });
    assert.equal(odp.status, 200);
    const dane = await odp.json();
    assert.deepEqual(dane.pliki, ['Formularz ofertowy.docx', 'Oświadczenie.docx', 'Oświadczenie (2).docx']);
    assert.equal(dane.plik, 'Formularz ofertowy.docx');
    assert.equal((await fetch(`${BAZA}/eksport/pismo`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ pisma: [] }) })).status, 400);
    const zaDuzo = Array.from({ length: MAKS_PISM_W_PAKIECIE + 1 }, (_, i) => ({ nazwa: `P${i}`, tresc: 'x' }));
    assert.equal((await fetch(`${BAZA}/eksport/pismo`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ pisma: zaDuzo }) })).status, 400);
  });

  test('POST /eksport/pismo.docx zwraca plik Word do pobrania (ZIP „PK”, typ MIME, nazwa z polskimi znakami w filename*)', async () => {
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/eksport/pismo.docx`, {
      method: 'POST', headers: naglowki(token), body: JSON.stringify({ nazwa: 'Oświadczenie wstępne', tresc: 'Treść' }),
    });
    assert.equal(odp.status, 200);
    assert.equal(odp.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.match(odp.headers.get('content-disposition'), /attachment; filename="Oswiadczenie wstepne.docx"; filename\*=UTF-8''O%C5%9Bwiadczenie%20wst%C4%99pne.docx/);
    assert.equal(decodeURIComponent(odp.headers.get('x-plik')), 'Oświadczenie wstępne.docx');
    const bajty = Buffer.from(await odp.arrayBuffer());
    assert.equal(bajty.subarray(0, 2).toString('latin1'), 'PK');
    assert.ok(bajty.length > 1000);
    assert.equal((await fetch(`${BAZA}/eksport/pismo.docx`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ nazwa: 'x', tresc: '' }) })).status, 400);
  });

  test('CORS odsłania nagłówki pliku (X-Plik, Content-Disposition) — web zna nazwę pobieranego .docx', async () => {
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/eksport/pismo.docx`, {
      method: 'POST', headers: { ...naglowki(token), Origin: 'https://przetarg-ai.pl' }, body: JSON.stringify({ nazwa: 'Pismo', tresc: 'x' }),
    });
    assert.equal(odp.status, 200);
    const expose = (odp.headers.get('access-control-expose-headers') ?? '').toLowerCase();
    assert.ok(expose.includes('x-plik') && expose.includes('content-disposition'), expose);
  });

  test('brak treści albo za długa nazwa → 400; bez tokenu → 401', async () => {
    const { token } = await konto();
    assert.equal((await fetch(`${BAZA}/eksport/pismo`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ nazwa: 'x', tresc: '' }) })).status, 400);
    assert.equal((await fetch(`${BAZA}/eksport/pismo`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ nazwa: 'x'.repeat(121), tresc: 'a' }) })).status, 400);
    assert.equal((await fetch(`${BAZA}/eksport/pismo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nazwa: 'x', tresc: 'a' }) })).status, 401);
  });
});

describe('POST /eksport/zalacznik(.docx) — formularz zamawiającego wypełniony danymi firmy', async () => {
  const { ustawPobieranieZalacznika } = await import('../src/routes/eksport.js');
  const { zbudujZip } = await import('../src/lib/docx.js');
  const { czytajZip } = await import('../src/lib/wypelnijZalacznik.js');
  const xml = '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Nazwa Wykonawcy: ……………………</w:t></w:r></w:p><w:p><w:r><w:t>Cena brutto: ……………… zł</w:t></w:r></w:p></w:body></w:document>';
  const formularz = zbudujZip([{ nazwa: 'word/document.xml', dane: Buffer.from(xml) }]);
  const cialo = { url: 'https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/x/x_1', nazwa: 'Załącznik nr 1', dane: { nazwa: 'Budmax Sp. z o.o.', nip: '8130000001' } };
  test.after(() => ustawPobieranieZalacznika(null));

  test('plik do pobrania: wpisana nazwa, cena zostaje, liczniki w nagłówkach', async () => {
    ustawPobieranieZalacznika(async () => formularz);
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/eksport/zalacznik.docx`, { method: 'POST', headers: naglowki(token), body: JSON.stringify(cialo) });
    assert.equal(odp.status, 200);
    assert.match(odp.headers.get('content-type'), /wordprocessingml/);
    assert.equal(decodeURIComponent(odp.headers.get('x-plik')), 'Załącznik nr 1 - wypełniony.docx');
    assert.equal(odp.headers.get('x-wypelnione'), '1');
    const tekst = czytajZip(Buffer.from(await odp.arrayBuffer()))[0].dane.toString('utf8');
    assert.match(tekst, /Nazwa Wykonawcy: Budmax Sp\. z o\.o\./);
    assert.match(tekst, /Cena brutto: ……………… zł/);
  });

  test('e-mail na adres konta z raportem; błędy pobrania mają swój status; bez danych 400; bez tokenu 401', async () => {
    ustawPobieranieZalacznika(async () => formularz);
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/eksport/zalacznik`, { method: 'POST', headers: naglowki(token), body: JSON.stringify(cialo) });
    assert.equal(odp.status, 200);
    const d = await odp.json();
    assert.equal(d.tryb_degradacji, true, 'w testach bez klucza Resend');
    assert.deepEqual(d.wypelnione.map((w) => w.pole), ['nazwa']);
    assert.ok(d.do_uzupelnienia.some((x) => /Cena brutto/.test(x.etykieta)));

    ustawPobieranieZalacznika(async () => { throw Object.assign(new Error('To stary format Word (.doc).'), { status: 422 }); });
    const stary = await fetch(`${BAZA}/eksport/zalacznik.docx`, { method: 'POST', headers: naglowki(token), body: JSON.stringify(cialo) });
    assert.equal(stary.status, 422);
    assert.match((await stary.json()).error.message, /\.doc/);
    assert.equal((await fetch(`${BAZA}/eksport/zalacznik.docx`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ url: cialo.url, dane: {} }) })).status, 400);
    assert.equal((await fetch(`${BAZA}/eksport/zalacznik.docx`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cialo) })).status, 401);
  });
});
