import express, { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { esc } from '../lib/html.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { users, matches, saved, magicLinks, alerty } from '../db/repos.js';
import { celDecyzji, alertDecyzjiSzefa, dataDecyzjiPL, zostaloDni, opisWadium, kwotaZamowienia } from '../services/decyzjaSzefa.js';
import { dostarcz } from '../jobs/monitorWyszukiwan.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';

/*
 * Strona decyzji szefa (services/decyzjaSzefa.js) — montowana pod `/maile`. GET tylko pokazuje (skanery linków
 * w komunikatorach niczego nie zatwierdzą), POST zapisuje decyzję. Bez logowania: link jest przypięty do jednego
 * dopasowania jednego konta i wygasa po 7 dniach.
 */
const router = Router();
const WYGASL = 'Link wygasł albo jest nieprawidłowy. Poproś o nowy — w aplikacji PrzetargAI: karta przetargu → „Wyślij szefowi do decyzji”.';
const PRZYCISK = 'display:block;width:100%;margin-top:12px;padding:14px 16px;font-size:17px;font-weight:700;border-radius:10px;cursor:pointer;';

function strona(tresc) {
  return '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex"><title>PrzetargAI — do decyzji</title></head>'
    + '<body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#0f1b2d;line-height:1.5">'
    + `<p style="font-weight:800;color:#1d4ed8;margin:0 0 16px">PrzetargAI</p>${tresc}</body></html>`;
}

const parametry = (req) => ({
  token: typeof req.query.token === 'string' ? req.query.token.slice(0, 200) : '',
  matchId: typeof req.query.m === 'string' ? req.query.m.slice(0, 200) : '',
});

async function dopasowanieDla({ token, matchId }) {
  const userId = token && matchId ? await magicLinks.peek(token, celDecyzji(matchId)) : null;
  if (!userId) return { blad: WYGASL };
  const row = await matches.detail(userId, matchId);
  if (!row) return { blad: 'Tego przetargu nie ma już na liście.' };
  return { userId, row };
}

const kwota = kwotaZamowienia;
const wiersz = (etykieta, wartosc) => (wartosc
  ? `<tr><td style="padding:6px 0;color:#526075">${esc(etykieta)}</td><td style="padding:6px 0;font-weight:700;text-align:right">${esc(wartosc)}</td></tr>` : '');

function opisPrzetargu(row) {
  const termin = dataDecyzjiPL(row.tender_deadline);
  const powody = (Array.isArray(row.uzasadnienie) ? row.uzasadnienie : []).slice(0, 6);
  return `<h1 style="font-size:21px;margin:0 0 6px">${esc(row.tender_title)}</h1>`
    + (row.tender_organization ? `<p style="margin:0;color:#526075">${esc(row.tender_organization)}</p>` : '')
    + '<table style="margin:16px 0;border-collapse:collapse;width:100%">'
    + (termin ? `<tr><td style="padding:6px 0;color:#526075">Termin ofert</td><td style="padding:6px 0;font-weight:700;text-align:right">${esc(termin)}</td></tr>` : '')
    + wiersz('Zostało', zostaloDni(row.tender_deadline))
    + wiersz('Wartość', kwota(row))
    + wiersz('Wadium', opisWadium(row))
    + '</table>'
    + (powody.length ? `<p style="margin:0 0 4px;font-weight:700">Dlaczego aplikacja go wybrała</p><ul style="margin:0 0 8px;padding-left:20px">${powody.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '')
    + (/^https?:\/\//.test(String(row.tender_url ?? '')) ? `<p><a href="${esc(row.tender_url)}" rel="noopener noreferrer">Pełne ogłoszenie u źródła</a></p>` : '');
}

router.get('/decyzja', ah(async (req, res) => {
  const p = parametry(req);
  const { blad, row } = await dopasowanieDla(p);
  if (blad) { res.status(400).type('html').send(strona(`<p>${esc(blad)}</p>`)); return; }
  const akcja = `?token=${encodeURIComponent(p.token)}&m=${encodeURIComponent(p.matchId)}`;
  const juz = row.decyzja_szefa?.decyzja
    ? `<p style="padding:10px 12px;background:#e8effd;border-radius:8px">Obecna decyzja: <b>${row.decyzja_szefa.decyzja === 'tak' ? 'startujemy' : 'nie startujemy'}</b>. Możesz ją zmienić.</p>` : '';
  res.type('html').send(strona(`${opisPrzetargu(row)}${juz}<form method="post" action="${esc(akcja)}">`
    + `<button type="submit" name="decyzja" value="tak" style="${PRZYCISK}background:#1d4ed8;color:#fff;border:0">Startujemy</button>`
    + `<button type="submit" name="decyzja" value="nie" style="${PRZYCISK}background:#fff;color:#0f1b2d;border:1px solid #848fa2">Nie startujemy</button>`
    + '</form><p style="color:#526075;font-size:14px;margin-top:16px">Odpowiedź trafi do osoby, która wysłała Ci ten link.</p>'));
}));

router.post('/decyzja', express.urlencoded({ extended: false, limit: '2kb' }), ah(async (req, res) => {
  const p = parametry(req);
  const { blad, userId, row } = await dopasowanieDla(p);
  if (blad) { res.status(400).type('html').send(strona(`<p>${esc(blad)}</p>`)); return; }
  const decyzja = ['tak', 'nie'].includes(req.body?.decyzja) ? req.body.decyzja : null;
  if (!decyzja) { res.status(400).type('html').send(strona('<p>Wybierz „Startujemy” albo „Nie startujemy”.</p>')); return; }

  const teraz = new Date().toISOString();
  const bezZmian = row.decyzja_szefa?.decyzja === decyzja;
  await matches.zapiszDecyzjeSzefa(userId, row.id, { decyzja, o: teraz });
  if (decyzja === 'tak') {
    // „Startujemy” = to samo co „Biorę” pracownika: zapis, przypomnienia 7/3/1, etap (tylko z „Rozważam”).
    const tenderId = row.tender_id ?? row.id;
    const nowy = await saved.add(userId, row);
    if (nowy) await saved.setReminder(userId, tenderId, true).catch((err) => logger.warn({ err: err.message, userId }, 'Decyzja szefa: przypomnienie nie włączone'));
    const wpis = (await saved.list(userId)).find((z) => (z.tender_id ?? z.id) === tenderId);
    if (!wpis?.status || wpis.status === 'rozwazam') await saved.setStatus(userId, tenderId, 'przygotowuje');
  }
  if (!bezZmian) {
    const alert = alertDecyzjiSzefa({ row, decyzja, teraz });
    const { nowy } = await alerty.dodaj(userId, alert, teraz);
    if (nowy) {
      const user = await users.findById(userId).catch(() => null);
      await dostarcz({ user, alert, wyslijPush: sendPush, wyslijEmail: sendEmail })
        .catch((err) => logger.warn({ err: err.message, userId }, 'Decyzja szefa: powiadomienie nie wysłane'));
    }
  }
  audit({ userId, action: 'boss_decision', detail: { matchId: row.id, decyzja }, ip: req.ip });
  res.type('html').send(strona(`<p style="font-size:19px"><b>${decyzja === 'tak' ? 'Zapisane: startujemy.' : 'Zapisane: nie startujemy.'}</b></p>`
    + `<p>„${esc(row.tender_title)}”</p><p style="color:#526075">Osoba, która wysłała link, dostała powiadomienie. Decyzję możesz zmienić, otwierając link ponownie.</p>`));
}));

export default router;
