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
