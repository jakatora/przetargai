import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { esc } from '../lib/html.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { users, magicLinks } from '../db/repos.js';
import { propozycjeKarty, zastosujPropozycje } from '../lib/propozycjeKarty.js';
import { CEL_PROFIL } from '../services/profilZMaila.js';
import { przeliczProfil } from '../services/pracownik.js';
import { odmienPrzetargi } from '../lib/digestTresc.js';

/*
 * „Dopisz do profilu” z maila (services/profilZMaila.js) — montowany pod `/maile`. GET pokazuje propozycję
 * (skanery poczty niczego nie zmieniają), POST ją stosuje tak jak „Przyjmij” w panelu (zastosujPropozycje)
 * i od razu przelicza selekcję. Propozycja liczy się z AKTUALNEGO konta: gdy klient zmienił profil sam,
 * jest nieaktualna i nic nie zapisujemy. Link zużywany dopiero po udanym zapisie.
 */
const router = Router();
const NIEAKTUALNA = 'Ta propozycja jest już nieaktualna — profil został zmieniony. Zobaczysz go w aplikacji: Karta firmy.';

function strona(tresc, formularz = '') {
  return '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>PrzetargAI — profil firmy</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#14213d">'
    + `<h1 style="font-size:20px">PrzetargAI</h1>${tresc}${formularz}</body></html>`;
}

const tokenZ = (req) => (typeof req.query.token === 'string' ? req.query.token.slice(0, 200) : '');

async function propozycjaDla(token) {
  const userId = token ? await magicLinks.peek(token, CEL_PROFIL) : null;
  if (!userId) return { blad: 'Link wygasł albo został już użyty. Propozycję znajdziesz też w aplikacji, na górze listy przetargów.' };
  const user = await users.findById(userId);
  const propozycja = user ? propozycjeKarty(user, new Date().toISOString()).find((p) => p.pole === 'profil') : null;
  return propozycja ? { user, propozycja } : { blad: NIEAKTUALNA };
}

router.get('/profil', ah(async (req, res) => {
  const token = tokenZ(req);
  const { blad, propozycja } = await propozycjaDla(token);
  if (blad) {
    res.status(400).type('html').send(strona(`<p>${esc(blad)}</p>`));
    return;
  }
  const przyklady = (propozycja.dowody ?? []).map((t) => `<li>${esc(t)}</li>`).join('');
  res.type('html').send(strona(`<p>${esc(propozycja.opis.pl)}</p>${przyklady ? `<p>Na przykład:</p><ul>${przyklady}</ul>` : ''}`,
    `<form method="post" action="?token=${esc(token)}"><button type="submit" style="padding:12px 20px;font-size:16px">Dopisz do profilu</button></form>`));
}));

router.post('/profil', ah(async (req, res) => {
  const token = tokenZ(req);
  const { blad, user, propozycja } = await propozycjaDla(token);
  if (blad) {
    res.status(400).type('html').send(strona(`<p>${esc(blad)}</p>`));
    return;
  }
  const zapisany = await users.zapiszKarte(user.id, zastosujPropozycje(user, propozycja));
  await magicLinks.consume(token, CEL_PROFIL);
  audit({ userId: user.id, action: 'accept_profile_suggestion_email', ip: req.ip });
  // Selekcja od razu (klient kliknął świadomie) — błąd = wybierze cykl dzienny.
  const w = await przeliczProfil(zapisany, { wymus: true }).catch((err) => {
    logger.error({ err: err.message, userId: user.id }, 'Przeliczenie po profilu z maila nieudane');
    return null;
  });
  const ile = w?.created ?? 0;
  res.type('html').send(strona('<p><b>Gotowe — profil uzupełniony.</b></p>'
    + `<p>${ile ? `Już teraz wybraliśmy dla Ciebie ${ile} ${odmienPrzetargi(ile)} — otwórz aplikację PrzetargAI.`
      : 'Pierwsze przetargi pojawią się w aplikacji po najbliższym przebiegu selekcji (najpóźniej jutro w południe).'}</p>`));
}));

export default router;
