import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swzZZalacznikow, parametryRadaruZPlatformy, linkPlatformy } from '../src/lib/zalacznikiPlatformy.js';
import { wstepneDaneRadaru } from '../src/lib/radarSwz.js';

const Z = (nazwa, extra = {}) => ({ nazwa, rozszerzenie: 'pdf', rozmiar_kb: 800, opublikowano: null, url: 'https://platformazakupowa.pl/file/get_new/abc.pdf', ...extra });

test('swzZZalacznikow: tylko PDF ze specyfikacją w nazwie, z platformy, do 5 MB; SWZ przed OPZ; najwyżej 3', () => {
  const lista = [
    Z('Formularz oferty.docx', { rozszerzenie: 'docx' }),
    Z('OPZ - opis przedmiotu zamowienia.pdf'),
    Z('SWZ_remont_dachu.pdf'),
    Z('Plan sytuacyjny.pdf'),
    Z('SIWZ stary.pdf', { rozmiar_kb: 6000 }),
    Z('Specyfikacja techniczna.pdf', { url: 'https://zly-host.example/plik.pdf' }),
    Z('Specyfikacja warunków zamówienia cz. 2.pdf'),
    Z('swz cz. 3.pdf'),
    Z('Specyfikacja cz. 4.pdf'),
  ];
  const w = swzZZalacznikow(lista).map((z) => z.nazwa);
  assert.deepEqual(w, ['SWZ_remont_dachu.pdf', 'swz cz. 3.pdf', 'OPZ - opis przedmiotu zamowienia.pdf']);
  assert.deepEqual(swzZZalacznikow(null), []);
  assert.deepEqual(swzZZalacznikow([Z('Rysunek.pdf')]), []);
});

test('linkPlatformy: tylko https na platformazakupowa.pl (także subdomeny)', () => {
  assert.equal(linkPlatformy('https://platformazakupowa.pl/file/get_new/x.pdf'), true);
  assert.equal(linkPlatformy('https://zstw.platformazakupowa.pl/file/x.pdf'), true);
  assert.equal(linkPlatformy('http://platformazakupowa.pl/file/x.pdf'), false);
  assert.equal(linkPlatformy('https://platformazakupowa.pl.evil.com/x.pdf'), false);
  assert.equal(linkPlatformy(null), false);
});

test('parametryRadaruZPlatformy + wstepneDaneRadaru: link do PDF i nazwa przechodzą do Radaru; obcy host → null', () => {
  const tender = { id: 'pz:123', title: 'Remont dachu szkoły', deadline: '2026-11-05T09:00:00.000Z' };
  const params = parametryRadaruZPlatformy({ tender, zalacznik: Z('SWZ.pdf') });
  assert.deepEqual(params, { tenderId: 'pz:123', pdfUrl: 'https://platformazakupowa.pl/file/get_new/abc.pdf', pdfNazwa: 'SWZ.pdf', nazwa: 'Remont dachu szkoły', termin: '2026-11-05T09:00:00.000Z' });
  const w = wstepneDaneRadaru(params);
  assert.equal(w.tenderId, 'pz:123');
  assert.equal(w.pdfUrl, params.pdfUrl);
  assert.equal(w.pdfNazwa, 'SWZ.pdf');
  assert.equal(w.zPrzetargu, true);
  assert.equal(wstepneDaneRadaru({ tenderId: 'x', pdfUrl: 'https://evil.example/a.pdf' }).pdfUrl ?? null, null, 'obcy host odcięty');
  assert.equal(wstepneDaneRadaru({}).pdfUrl ?? null, null);
  assert.equal(parametryRadaruZPlatformy({ tender, zalacznik: Z('SWZ.pdf', { url: 'https://evil.example/a.pdf' }) }), null);
});

test('e-Zamówienia (2026-10-26): link DownloadDocument przechodzi jak załącznik platformy, SWZ.pdf trafia do Radaru', () => {
  const ID = 'ocds-148610-16f1c19e-be85-4853-82f5-171345acf01b';
  const url = `https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/${ID}/${ID}_2`;
  assert.equal(linkPlatformy(url), true);
  assert.equal(linkPlatformy('https://ezamowienia.gov.pl.evil.com/x.pdf'), false);
  const dokumenty = [
    { id: `${ID}_1`, nazwa: 'Załącznik Nr 1 - 10', plik: 'Załączniki 1-10.zip', rozszerzenie: 'zip', url: `https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/${ID}/${ID}_1` },
    { id: `${ID}_2`, nazwa: 'Specyfikacja Warunków Zamówienia', plik: 'SWZ.pdf', rozszerzenie: 'pdf', url },
  ];
  const swz = swzZZalacznikow(dokumenty);
  assert.deepEqual(swz.map((z) => z.id), [`${ID}_2`]);
  const tender = { id: '2026~BZP_00321077', title: 'Cyberbezpieczny wodociąg', deadline: '2026-11-02T08:00:00.000Z' };
  const params = parametryRadaruZPlatformy({ tender, zalacznik: swz[0] });
  assert.equal(params.pdfUrl, url);
  assert.equal(wstepneDaneRadaru(params).pdfUrl, url, 'Radar przyjmuje host ezamowienia.gov.pl');
});
