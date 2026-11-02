import express, { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { esc } from '../lib/html.js';
import { audit } from '../lib/audit.js';
import { isValidNip, normalizeNip } from '../lib/nip.js';
import { users, magicLinks } from '../db/repos.js';
import { CEL_NIP, nazwaZBialejListy } from '../services/nipZMaila.js';

/*
 * Formularz „Podaj NIP” z linku w przeglądzie tygodniowym (services/nipZMaila.js) — montowany pod `/maile`.
 * GET tylko pokazuje formularz (skanery poczty otwierają linki z maili), zapisuje dopiero POST. Link zużywamy
 * PO udanym zapisie: literówka w NIP-ie albo NIP zajęty przez inne konto nie palą jednorazowego linku.
 */
const router = Router();
const WYGASL = 'Link wygasł albo został już użyty. NIP wpiszesz też w aplikacji: Karta firmy → NIP firmy.';
const KORZYSCI = 'Dzięki niemu sami sprawdzimy, czy wygrałeś, które miejsce zajęła Twoja oferta po otwarciu ofert '
  + 'i kiedy kończą się Twoje umowy z zamawiającymi.';

function strona(tresc, formularz = '') {
  return '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>PrzetargAI — NIP firmy</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#14213d">'
    + `<h1 style="font-size:20px">PrzetargAI</h1>${tresc}${formularz}</body></html>`;
}

const formularz = (token, nip = '') => `<form method="post" action="?token=${esc(token)}">`
  + '<label for="nip" style="display:block;font-weight:600;margin:16px 0 6px">NIP firmy</label>'
  + `<input id="nip" name="nip" value="${esc(nip)}" inputmode="numeric" autocomplete="off" maxlength="20" required `
  + 'style="font-size:18px;padding:10px;width:100%;box-sizing:border-box;border:1px solid #98a2b3;border-radius:8px">'
  + '<button type="submit" style="margin-top:12px;padding:12px 20px;font-size:16px">Zapisz NIP</button></form>';

const tokenZ = (req) => (typeof req.query.token === 'string' ? req.query.token.slice(0, 200) : '');

router.get('/nip', ah(async (req, res) => {
  const token = tokenZ(req);
  if (!token || !await magicLinks.peek(token, CEL_NIP)) {
    res.status(400).type('html').send(strona(`<p>${WYGASL}</p>`));
    return;
  }
  res.type('html').send(strona(`<p>Podaj NIP swojej firmy — 30 sekund. ${KORZYSCI}</p>`, formularz(token)));
}));

router.post('/nip', express.urlencoded({ extended: false, limit: '2kb' }), ah(async (req, res) => {
  const token = tokenZ(req);
  const userId = token ? await magicLinks.peek(token, CEL_NIP) : null;
  if (!userId) {
    res.status(400).type('html').send(strona(`<p>${WYGASL}</p>`));
    return;
  }
  const wpisany = typeof req.body?.nip === 'string' ? req.body.nip.slice(0, 20) : '';
  const nip = normalizeNip(wpisany);
  if (!isValidNip(nip)) {
    res.status(400).type('html').send(strona('<p style="color:#b42318;font-weight:600">To nie jest prawidłowy NIP — sprawdź cyfry (10 cyfr).</p>',
      formularz(token, wpisany)));
    return;
  }
  try {
    await users.ustawNip(userId, nip);
  } catch (err) {
    if (err.code !== 'DUPLICATE_NIP') throw err;
    res.status(409).type('html').send(strona('<p>Ten NIP ma już inne konto w PrzetargAI. Jeśli to Twoja firma, odpisz na maila z przeglądem — przepiszemy go.</p>'));
    return;
  }
  await magicLinks.consume(token, CEL_NIP);
  const nazwa = await nazwaZBialejListy(nip);
  if (nazwa) await users.uzupelnijNazweFirmy(userId, nazwa);
  audit({ userId, action: 'update_nip_email', ip: req.ip });
  res.type('html').send(strona(`<p><b>Gotowe — zapisaliśmy NIP ${esc(nip)}</b>${nazwa ? ` (${esc(nazwa)})` : ''}.</p><p>${KORZYSCI}</p>`
    + '<p style="color:#667085">Pomyłka? NIP zmienisz w aplikacji: Karta firmy → NIP firmy.</p>'));
}));

export default router;
