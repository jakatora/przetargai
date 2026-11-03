import { createHash } from 'node:crypto';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { planEfektywny } from '../lib/plan.js';
import { ciszaNocna, dobaWarszawska } from '../lib/czasPolski.js';
import { PUNKT_BEZ_WARUNKOW } from '../lib/warunkiUdzialu.js';
import { mailSelekcji, mailTerenu, odmianaPrzetargow } from '../lib/mailSelekcji.js';
import { terminPytan } from '../lib/przypomnieniePytan.js';
import { matches, alerty, magicLinks, dziennik, znacznikMailaSelekcji, users } from '../db/repos.js';
import { czasPytacOTeren, liczbaWojewodztw, linkTerenu } from './terenZMaila.js';
import { linkOceny, linkDoPozycji } from './ocenaZMaila.js';
import { sendPush } from './push.js';
import { sendEmail } from './email.js';
import { dostarcz } from '../jobs/monitorWyszukiwan.js';

/*
 * Powiadomienia o wybranych przetargach (spec §7). Free: raz dziennie (push + jeden mail
 * na dobę). Standard (także próba): po każdym przebiegu — Centrum alertów, push, a gdy
 * push nie dotrze, mail. Cisza nocna 21:00–7:00: wybrane czekają do porannego przebiegu.
 * Idempotencja: `notified` na dopasowaniu + znacznik maila doby (Free) + klucz alertu (Standard).
 */
export const OKNO_POWIADOMIEN_MS = 36 * 3_600_000;
export const MIN_WOJEWODZTW_PYTANIA = 3;
const WYPIS_TTL_MIN = 30 * 24 * 60;

async function linkWypisu(userId) {
  const { token } = await magicLinks.create({ userId, purpose: 'wypisz_pracownik', ttlMinutes: WYPIS_TTL_MIN });
  return `${env.APP_URL}/maile/wypisz?token=${token}`;
}

function pozycjeZ(lista, { zKrokiem, teraz }) {
  return lista.map((m) => {
    const pytania = zKrokiem
      ? terminPytan({ id: m.tender_id, source: m.tender_source, deadline: m.tender_deadline }, teraz)
      : null;
    return {
      id: m.id,
      tytul: m.tender_title ?? 'Przetarg',
      organizacja: m.tender_organization ?? null,
      termin: m.tender_deadline ?? null,
      // „Bez warunków udziału” osobną linią — mail pokazuje tylko 2 punkty, a ten stoi na końcu uzasadnienia.
      punkty: (m.uzasadnienie ?? []).filter((p) => p !== PUNKT_BEZ_WARUNKOW).slice(0, 2),
      bez_warunkow: (m.uzasadnienie ?? []).includes(PUNKT_BEZ_WARUNKOW),
      krok: pytania?.lokalnie?.etykieta ? `pytania do SWZ najpóźniej ${pytania.lokalnie.etykieta}` : null,
    };
  });
}

export async function powiadomPoPrzebiegu(user, { tryb = 'dzienny', teraz = nowIso(), wyslijPush = sendPush, wyslijEmail = sendEmail } = {}) {
  if (ciszaNocna(teraz)) return 'cisza';
  const plan = planEfektywny(user, teraz);
  if (plan === 'free' && tryb !== 'dzienny') return 'poza_harmonogramem';

  const lista = await matches.doPowiadomienia(user.id, new Date(Date.parse(teraz) - OKNO_POWIADOMIEN_MS).toISOString());
  if (!lista.length) return 'brak';

  const ids = lista.map((m) => m.id);
  // Najlepiej ocenione pierwsze — mail pokazuje najwyżej 10 (lib/mailSelekcji.js), reszta czeka w apce.
  const pozycje = pozycjeZ([...lista].sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0)), { zKrokiem: plan === 'standard', teraz });
  const doba = dobaWarszawska(teraz);
  const mailWlaczony = user.powiadomienia_pracownik_email !== false && Boolean(user.email);
  // Konto bez województw: raz na tydzień pytamy o teren (link do strony z województwami, bez logowania).
  // Tydzień liczy się od maila, który naprawdę wyszedł — push zamiast maila (Standard) nie zużywa pytania.
  let terenWMailu = false;
  const trescMaila = async () => {
    let teren = null;
    if (czasPytacOTeren(user, teraz)) {
      teren = { link: await linkTerenu(user.id), wojewodztw: liczbaWojewodztw(lista) };
      terenWMailu = true;
    }
    // „Nie dla nas” przy każdej pozycji — jeden wielokrotny link na mail (services/ocenaZMaila.js).
    const ocena = await linkOceny(user.id);
    return mailSelekcji({
      pozycje: pozycje.map((p) => ({ ...p, link_odrzuc: linkDoPozycji(ocena, p.id) })), plan, raport: await dziennik.pobierz(user.id, doba),
      linkWypisu: await linkWypisu(user.id), linkAplikacji: env.APP_LINK_URL, teren,
    });
  };
  const wyslijMail = async (to) => {
    const w = await wyslijEmail({ to, ...(await trescMaila()) });
    if (w?.sent && terenWMailu) await users.oznaczPytanieOTeren(user.id, teraz);
    return w;
  };

  if (plan === 'free') {
    let dostarczono = false;
    if (user.push_token) {
      const w = await wyslijPush(user.push_token, {
        title: 'Nowe dopasowane przetargi',
        body: lista.length === 1 ? pozycje[0].tytul : `Mamy dla Ciebie ${odmianaPrzetargow(lista.length)}`,
        data: { type: 'new_matches', count: lista.length },
      }).catch((err) => { logger.error({ err: err.message, userId: user.id }, 'Push wybranych nie wysłany'); return null; });
      dostarczono = (w?.sent ?? 0) > 0;
    }
    if (mailWlaczony && await znacznikMailaSelekcji.zarezerwuj(user.id, doba)) {
      const w = await wyslijMail(user.email);
      if (w?.sent || w?.odrzuconyAdresat) await znacznikMailaSelekcji.potwierdz(user.id, doba, { emailId: w?.id ?? null });
      else await znacznikMailaSelekcji.zwolnij(user.id, doba);
      dostarczono = dostarczono || Boolean(w?.sent);
    }
    if (dostarczono) await matches.markNotifiedBatch(user.id, ids);
    return dostarczono ? 'dostarczono' : 'nie_dostarczono';
  }

  const klucz = `selekcja-${createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 16)}`;
  const alert = {
    klucz,
    typ: 'new_matches', // push otwiera „Twoje przetargi” (mobile/src/lib/nawigacjaPush.js)
    tytul: lista.length === 1
      ? { pl: 'Nowy przetarg dla Twojej firmy', en: 'New tender for your company' }
      : { pl: `Mamy dla Ciebie ${odmianaPrzetargow(lista.length)}`, en: `${lista.length} new tenders for you` },
    tresc: {
      pl: lista.length === 1 ? pozycje[0].tytul : `${pozycje[0].tytul} i ${lista.length - 1} więcej`,
      en: lista.length === 1 ? pozycje[0].tytul : `${pozycje[0].tytul} and ${lista.length - 1} more`,
    },
    pozycje: pozycje.map(({ tytul, organizacja }) => ({ tytul, organizacja })),
  };
  const { nowy } = await alerty.dodaj(user.id, alert, teraz);
  if (!nowy) {
    // Ten zestaw już raz wyszedł (przebieg przerwany przed oznaczeniem) — nie wysyłamy drugi raz.
    await matches.markNotifiedBatch(user.id, ids);
    return 'juz_wyslane';
  }

  let kanal = 'centrum';
  if (user.push_token || mailWlaczony) {
    // Treść maila (i jednorazowe linki) dopiero, gdy push nie dotarł i mail naprawdę wychodzi.
    kanal = await dostarcz({
      user: mailWlaczony ? user : { ...user, email: null },
      alert, wyslijPush,
      wyslijEmail: ({ to }) => wyslijMail(to),
    });
  }
  await matches.markNotifiedBatch(user.id, ids);
  // Wybrane poszły pushem, a konto bez województw dostaje je z całej Polski — pytanie o teren osobnym mailem
  // (raz na 7 dni, tylko gdy wybrane są z ≥ 3 województw; błąd nie psuje powiadomienia).
  const wojewodztw = liczbaWojewodztw(lista);
  if (kanal !== 'email' && mailWlaczony && wojewodztw >= MIN_WOJEWODZTW_PYTANIA && czasPytacOTeren(user, teraz)) {
    try {
      const m = mailTerenu({ link: await linkTerenu(user.id), wybrane: lista.length, wojewodztw, linkWypisu: await linkWypisu(user.id) });
      if ((await wyslijEmail({ to: user.email, ...m }))?.sent) await users.oznaczPytanieOTeren(user.id, teraz);
    } catch (err) {
      logger.warn({ err: err.message, userId: user.id }, 'Mail z pytaniem o teren nie wysłany');
    }
  }
  return kanal;
}
