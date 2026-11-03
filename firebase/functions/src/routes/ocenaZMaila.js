import express, { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { esc } from '../lib/html.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { PRZYCZYNY_KLIENTA, ETYKIETY_PRZYCZYN } from '../lib/przyczyny.js';
import { zbudujSygnal } from '../lib/sygnaly.js';
import { kodWojewodztwa } from '../lib/wojewodztwa.js';
import { users, matches, magicLinks } from '../db/repos.js';
import { CEL_OCENA } from '../services/ocenaZMaila.js';
import { czasPytacOTeren, linkTerenu } from '../services/terenZMaila.js';

/*
 * „Nie dla nas” z maila z wybranymi (services/ocenaZMaila.js) — montowany pod `/maile`. GET pokazuje przetarg
 * i przyczyny (skanery poczty niczego nie odrzucają), POST odrzuca jak „Odrzuć” w apce: dopasowanie schodzi z listy,
 * a sygnał z przyczyną trafia do selekcji. Link wielokrotny — nie zużywamy go.
 */
const router = Router();
const WYGASL = 'Link wygasł. Przetarg odrzucisz też w aplikacji PrzetargAI: przycisk „Odrzuć” na karcie przetargu.';
const PRZYCISK = 'display:block;width:100%;margin-top:10px;padding:12px 16px;font-size:16px;text-align:left;'
  + 'background:#fff;border:1px solid #98a2b3;border-radius:8px;color:#14213d';

function strona(tresc) {
  return '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>PrzetargAI — nie dla nas</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#14213d">'
    + `<h1 style="font-size:20px">PrzetargAI</h1>${tresc}</body></html>`;
}

const parametry = (req) => ({
  token: typeof req.query.token === 'string' ? req.query.token.slice(0, 200) : '',
  matchId: typeof req.query.m === 'string' ? req.query.m.slice(0, 200) : '',
});

async function dopasowanieDla({ token, matchId }) {
  const userId = token ? await magicLinks.peek(token, CEL_OCENA) : null;
  if (!userId) return { blad: WYGASL };
  const row = matchId ? await matches.detail(userId, matchId) : null;
  if (!row) return { blad: 'Nie znaleźliśmy tego przetargu na Twojej liście.' };
  return { userId, row };
}

router.get('/ocena', ah(async (req, res) => {
  const p = parametry(req);
  const { blad, row } = await dopasowanieDla(p);
  if (blad) {
    res.status(400).type('html').send(strona(`<p>${esc(blad)}</p>`));
    return;
  }
  if (row.odrzucony_przez_klienta) {
    res.type('html').send(strona(`<p>Przetarg „${esc(row.tender_title)}” jest już odrzucony.</p>`));
    return;
  }
  const akcja = `?token=${encodeURIComponent(p.token)}&m=${encodeURIComponent(p.matchId)}`;
  res.type('html').send(strona(`<p><b>${esc(row.tender_title)}</b>${row.tender_organization ? `<br>${esc(row.tender_organization)}` : ''}</p>`
    + '<p>Dlaczego to nie dla Ciebie? Na tej podstawie będziemy lepiej wybierać.</p>'
    + `<form method="post" action="${esc(akcja)}">`
    + PRZYCZYNY_KLIENTA.map((k) => `<button type="submit" name="przyczyna" value="${k}" style="${PRZYCISK}">${esc(ETYKIETY_PRZYCZYN[k].pl)}</button>`).join('')
    + '</form>'));
}));

router.post('/ocena', express.urlencoded({ extended: false, limit: '2kb' }), ah(async (req, res) => {
  const p = parametry(req);
  const { blad, userId, row } = await dopasowanieDla(p);
  if (blad) {
    res.status(400).type('html').send(strona(`<p>${esc(blad)}</p>`));
    return;
  }
  const przyczyna = PRZYCZYNY_KLIENTA.includes(req.body?.przyczyna) ? req.body.przyczyna : null;
  if (!przyczyna) {
    res.status(400).type('html').send(strona('<p>Wybierz przyczynę.</p>'));
    return;
  }
  const teraz = new Date().toISOString();
  if (!row.odrzucony_przez_klienta) {
    await matches.oznaczOdrzuconyPrzezKlienta(userId, row.id, { przyczyna, komentarz: null, teraz });
    await users.dodajSygnal(userId, zbudujSygnal({
      typ: 'odrzucenie', tenderId: row.tender_id, tytul: row.tender_title, wojewodztwo: kodWojewodztwa(row.tender_wojewodztwo),
      wartosc: row.tender_budget, termin: row.tender_deadline, przyczyna, teraz,
    }));
    audit({ userId, action: 'reject_match_email', detail: { matchId: row.id, przyczyna }, ip: req.ip });
  }
  // „Poza terenem” u konta bez województw: od razu propozycja ustawienia terenu (jeden klik zamiast wielu odrzuceń).
  let teren = '';
  if (przyczyna === 'teren') {
    const user = await users.findById(userId);
    if (user && czasPytacOTeren({ ...user, teren_pytanie_o: null }, teraz)) {
      const link = await linkTerenu(userId).catch((err) => { logger.warn({ err: err.message, userId }, 'Link terenu nieudany'); return null; });
      if (link) teren = `<p>Nie pracujesz w całej Polsce? <a href="${esc(link)}"><b>Zaznacz swoje województwa</b></a> — przetargi z innych pominiemy od razu.</p>`;
    }
  }
  res.type('html').send(strona(`<p><b>Gotowe — „${esc(row.tender_title)}” zszedł z Twojej listy</b> (${esc(ETYKIETY_PRZYCZYN[przyczyna].pl.toLocaleLowerCase('pl'))}).</p>`
    + `<p>Będziemy to brać pod uwagę przy kolejnych wyborach.</p>${teren}`));
}));

export default router;
