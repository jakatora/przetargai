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
const poTerminie = (row) => { const t = Date.parse(String(row.tender_deadline ?? '')); return Number.isFinite(t) && t <= Date.now(); };
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
  // Po terminie składania nie ma o czym decydować (QA 2026-11-13) — bez przycisków i bez obietnicy przypomnień.
  if (poTerminie(row)) {
    res.type('html').send(strona(`${opisPrzetargu(row)}<p style="padding:10px 12px;background:#fdecec;border-radius:8px"><b>Termin składania ofert już minął.</b> Decyzji nie da się już zapisać.</p>`));
    return;
  }
  const akcja = `?token=${encodeURIComponent(p.token)}&m=${encodeURIComponent(p.matchId)}`;
  const juz = row.decyzja_szefa?.decyzja
    ? `<p style="padding:10px 12px;background:#e8effd;border-radius:8px">Obecna decyzja: <b>${row.decyzja_szefa.decyzja === 'tak' ? 'startujemy' : 'nie startujemy'}</b>. Możesz ją zmienić.</p>` : '';
  res.type('html').send(strona(`${opisPrzetargu(row)}${juz}<form method="post" action="${esc(akcja)}">`
    + '<label style="display:block;margin-top:8px;font-size:14px;color:#526075">Notatka dla wysyłającego (opcjonalnie)'
    + '<input type="text" name="komentarz" maxlength="140" autocomplete="off" placeholder="np. cena do 2,5 mln zł" '
    + 'style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:12px;font-size:16px;border:1px solid #848fa2;border-radius:8px"></label>'
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

  // Notatka szefa (seria 2 runda 9): jedna linia, do 140 znaków, bez znaków sterujących.
  const komentarz = typeof req.body?.komentarz === 'string'
    ? req.body.komentarz.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 140) || null : null;
  if (poTerminie(row)) {
    res.status(409).type('html').send(strona('<p><b>Termin składania ofert już minął.</b> Decyzji nie da się już zapisać.</p>'));
    return;
  }
  const teraz = new Date().toISOString();
  const poprzednia = row.decyzja_szefa ?? null;
  const bezZmian = poprzednia?.decyzja === decyzja && (poprzednia?.komentarz ?? null) === komentarz && poprzednia?.powiadomiono === true;
  const nr = bezZmian ? (poprzednia.nr ?? 1) : (poprzednia?.nr ?? 0) + 1;
  const tenderId = row.tender_id ?? row.id;

  /*
   * Kolejność (QA 2026-11-13): skutki → alert → DOPIERO zapis decyzji z `powiadomiono`. Wcześniej decyzja była
   * zapisywana pierwsza: błąd w dalszym kroku dawał szefowi 500, a ponowne kliknięcie uznawało „bez zmian”
   * i pracownik nigdy nie dostawał alertu. Wszystkie kroki są idempotentne, więc powtórka jest bezpieczna.
   */
  let wynik = null;
  if (decyzja === 'tak') {
    // „Startujemy” = to samo co „Biorę” pracownika: zapis, przypomnienia 7/3/1, etap (tylko z „Rozważam”).
    const nowyZapis = await saved.add(userId, row);
    if (nowyZapis) await saved.setReminder(userId, tenderId, true).catch((err) => logger.warn({ err: err.message, userId }, 'Decyzja szefa: przypomnienie nie włączone'));
    // Jeden dokument po id, nie lista z limitem 100 — przy wielu zapisanych starszy wpis nie był znajdowany i etap
    // „Oferta złożona” wracał do „Przygotowuję”.
    let wpis = await saved.pobierz(userId, tenderId);
    if (wpis && (!wpis.status || wpis.status === 'rozwazam')) {
      await saved.setStatus(userId, tenderId, 'przygotowuje');
      wpis = { ...wpis, status: 'przygotowuje' };
    }
    wynik = { przypomnienie: wpis?.reminder_enabled === true && wpis?.reminder_notified !== true, etap: wpis?.status ?? null };
  }
  if (!bezZmian) {
    const alert = alertDecyzjiSzefa({ row, decyzja, komentarz, teraz, nr, wynik });
    const { nowy } = await alerty.dodaj(userId, alert, teraz);
    if (nowy) {
      const user = await users.findById(userId).catch(() => null);
      await dostarcz({ user, alert, wyslijPush: sendPush, wyslijEmail: sendEmail })
        .catch((err) => logger.warn({ err: err.message, userId }, 'Decyzja szefa: powiadomienie nie wysłane'));
    }
  }
  await matches.zapiszDecyzjeSzefa(userId, row.id, { decyzja, komentarz, o: bezZmian ? (poprzednia.o ?? teraz) : teraz, nr, powiadomiono: true },
    { zdejmijOdrzucenie: decyzja === 'tak' && Boolean(row.odrzucony_przez_klienta) });
  audit({ userId, action: 'boss_decision', detail: { matchId: row.id, decyzja }, ip: req.ip });
  res.type('html').send(strona(`<p style="font-size:19px"><b>${decyzja === 'tak' ? 'Zapisane: startujemy.' : 'Zapisane: nie startujemy.'}</b></p>`
    + `<p>„${esc(row.tender_title)}”</p><p style="color:#526075">Osoba, która wysłała link, dostała powiadomienie. Decyzję możesz zmienić, otwierając link ponownie.</p>`));
}));

export default router;
