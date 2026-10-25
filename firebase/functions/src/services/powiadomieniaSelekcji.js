import { createHash } from 'node:crypto';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { planEfektywny } from '../lib/plan.js';
import { ciszaNocna, dobaWarszawska } from '../lib/czasPolski.js';
import { mailSelekcji, odmianaPrzetargow } from '../lib/mailSelekcji.js';
import { terminPytan } from '../lib/przypomnieniePytan.js';
import { matches, alerty, magicLinks, dziennik, znacznikMailaSelekcji } from '../db/repos.js';
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
      tytul: m.tender_title ?? 'Przetarg',
      organizacja: m.tender_organization ?? null,
      termin: m.tender_deadline ?? null,
      punkty: (m.uzasadnienie ?? []).slice(0, 2),
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
  const pozycje = pozycjeZ(lista, { zKrokiem: plan === 'standard', teraz });
  const doba = dobaWarszawska(teraz);
  const mailWlaczony = user.powiadomienia_pracownik_email !== false && Boolean(user.email);
  const trescMaila = async () => mailSelekcji({
    pozycje, plan, raport: await dziennik.pobierz(user.id, doba),
    linkWypisu: await linkWypisu(user.id), linkAplikacji: env.APP_LINK_URL,
  });

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
      const w = await wyslijEmail({ to: user.email, ...(await trescMaila()) });
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
    const mail = mailWlaczony ? await trescMaila() : null;
    kanal = await dostarcz({
      user: mailWlaczony ? user : { ...user, email: null },
      alert, wyslijPush,
      wyslijEmail: ({ to }) => wyslijEmail({ to, ...mail }),
    });
  }
  await matches.markNotifiedBatch(user.id, ids);
  return kanal;
}
