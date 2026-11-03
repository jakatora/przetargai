import express, { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { esc } from '../lib/html.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { WOJEWODZTWA, kodWojewodztwa } from '../lib/wojewodztwa.js';
import { users, magicLinks } from '../db/repos.js';
import { CEL_TEREN } from '../services/terenZMaila.js';
import { przeliczProfil } from '../services/pracownik.js';
import { odmienPrzetargi } from '../lib/digestTresc.js';

/*
 * „Gdzie pracujesz?” z linku w mailu z wybranymi (services/terenZMaila.js) — montowany pod `/maile`. GET tylko
 * pokazuje województwa (skanery poczty otwierają linki z maili), zapisuje dopiero POST i od razu przelicza
 * selekcję: przetargi spoza terenu schodzą z listy (pełny przegląd w services/pracownik.js). Link zużywany po
 * udanym zapisie — pusty wybór go nie pali.
 */
const router = Router();
const WYGASL = 'Link wygasł albo został już użyty. Województwa ustawisz też w aplikacji: Karta firmy → „Gdzie pracujesz?”.';

function strona(tresc, formularz = '') {
  return '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>PrzetargAI — teren działania</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#14213d">'
    + `<h1 style="font-size:20px">PrzetargAI</h1>${tresc}${formularz}</body></html>`;
}

const PRZYCISK = 'margin-top:16px;padding:12px 20px;font-size:16px';
const formularz = (token, zaznaczone = []) => `<form method="post" action="?token=${esc(token)}">`
  + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 12px;margin-top:12px">'
  + Object.entries(WOJEWODZTWA).map(([kod, nazwa]) => `<label style="font-size:16px;padding:6px 0;display:flex;align-items:center"><input type="checkbox" name="woj" value="${kod}"`
    + `${zaznaczone.includes(kod) ? ' checked' : ''} style="width:20px;height:20px;margin:0 8px 0 0;flex:none">${esc(nazwa)}</label>`).join('')
  + '</div>'
  + `<button type="submit" name="akcja" value="zapisz" style="${PRZYCISK}">Zapisz województwa</button> `
  + `<button type="submit" name="akcja" value="cala" style="${PRZYCISK};background:none;border:1px solid #98a2b3;border-radius:8px">Biorę z całej Polski</button>`
  + '</form>';

const tokenZ = (req) => (typeof req.query.token === 'string' ? req.query.token.slice(0, 200) : '');

router.get('/teren', ah(async (req, res) => {
  const token = tokenZ(req);
  if (!token || !await magicLinks.peek(token, CEL_TEREN)) {
    res.status(400).type('html').send(strona(`<p>${WYGASL}</p>`));
    return;
  }
  res.type('html').send(strona('<p>Zaznacz województwa, w których bierzesz zlecenia. Przetargi z pozostałych '
    + 'pominiemy — od razu i w kolejnych mailach.</p>', formularz(token)));
}));

router.post('/teren', express.urlencoded({ extended: false, limit: '2kb' }), ah(async (req, res) => {
  const token = tokenZ(req);
  const userId = token ? await magicLinks.peek(token, CEL_TEREN) : null;
  if (!userId) {
    res.status(400).type('html').send(strona(`<p>${WYGASL}</p>`));
    return;
  }
  if (req.body?.akcja === 'cala') {
    await users.ustawTeren(userId, { calaPolska: true });
    await magicLinks.consume(token, CEL_TEREN);
    audit({ userId, action: 'set_area_email', detail: { cala_polska: true }, ip: req.ip });
    res.type('html').send(strona('<p><b>Gotowe — dalej wybieramy przetargi z całej Polski.</b> Nie będziemy już o to pytać.</p>'
      + '<p style="color:#667085">Zmienisz to w aplikacji: Karta firmy → „Gdzie pracujesz?”.</p>'));
    return;
  }
  const surowe = [req.body?.woj ?? []].flat().filter((w) => typeof w === 'string').slice(0, 16);
  const regiony = [...new Set(surowe.map(kodWojewodztwa).filter(Boolean))];
  if (!regiony.length) {
    res.status(400).type('html').send(strona('<p style="color:#b42318;font-weight:600">Zaznacz co najmniej jedno województwo '
      + 'albo wybierz „Biorę z całej Polski”.</p>', formularz(token)));
    return;
  }
  const zapisany = await users.ustawTeren(userId, { regiony });
  await magicLinks.consume(token, CEL_TEREN);
  audit({ userId, action: 'set_area_email', detail: { regiony }, ip: req.ip });
  // Przeliczenie od razu (klient kliknął świadomie) — błąd = selekcja zrobi to w najbliższym przebiegu.
  const w = await przeliczProfil(zapisany, { wymus: true }).catch((err) => {
    logger.error({ err: err.message, userId }, 'Przeliczenie po terenie z maila nieudane');
    return null;
  });
  const schowane = w?.schowane ?? 0;
  res.type('html').send(strona(`<p><b>Gotowe — bierzemy przetargi z: ${esc(regiony.map((k) => WOJEWODZTWA[k]).join(', '))}.</b></p>`
    + `<p>${schowane ? `Z listy w aplikacji zeszło ${schowane} ${odmienPrzetargi(schowane)} spoza tego terenu.` : 'Lista w aplikacji uwzględni to w najbliższym przebiegu selekcji.'}</p>`
    + '<p style="color:#667085">Zmienisz to w aplikacji: Karta firmy → „Gdzie pracujesz?”.</p>'));
}));

export default router;
