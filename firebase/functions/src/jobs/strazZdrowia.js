import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { dobaWarszawska } from '../lib/czasPolski.js';
import { strazZdrowia as repoStrazy, alarmZdrowia } from '../db/repos.js';
import { sendEmail, alarmZdrowiaEmail } from '../services/email.js';

/*
 * STRAŻNIK ZDROWIA (2026-10-29). Alarmy maili (AI, ciche źródło) wywołuje SAM cykl dzienny — gdy cykl się
 * nie uruchomi, nie ma komu wysłać alarmu. 27.10 cykl dzienny nie odbył się wcale (Cloud Run „no available
 * instance”), /health przez dobę zwracał 503 i nikt się nie dowiedział; push padał 8 dni (InvalidCredentials)
 * widoczny tylko w logach. Strażnik jest niezależny: co godzinę odpytuje PUBLICZNY /health (sprawdza przy
 * okazji, że API w ogóle odpowiada), wylicza konkretne powody i wysyła mail do właściciela, gdy ten sam
 * powód utrzymuje się w DWÓCH kolejnych pomiarach (bez alarmów o chwilowych mrugnięciach). Ten sam zestaw
 * powodów najwyżej raz na dobę (czas polski).
 */
export const PROG_GODZIN_CYKLU = 26;

/** Odpowiedź /health → lista powodów alarmu (puste = zdrowo). Czysta funkcja. */
export function powodyAlarmu(odpowiedz) {
  if (!odpowiedz || odpowiedz.blad || !odpowiedz.cialo || typeof odpowiedz.cialo !== 'object') {
    return [{ kod: 'api', opis: `API nie odpowiada poprawnie (${odpowiedz?.blad ?? `HTTP ${odpowiedz?.status ?? '?'}`})` }];
  }
  const d = odpowiedz.cialo;
  const powody = [];
  if (d.db === false) powody.push({ kod: 'baza', opis: 'Firestore nie odpowiada' });
  const godzin = d.cron?.godzin_temu;
  if (typeof godzin === 'number' && godzin > PROG_GODZIN_CYKLU) powody.push({ kod: 'cykl', opis: `cykl dzienny nie odbył się od ${Math.round(godzin)} h` });
  else if (d.cron?.ok === false && !d.cron?.ostatni_przebieg) powody.push({ kod: 'cykl', opis: 'brak śladu cyklu dziennego' });
  const zBledem = Array.isArray(d.cron?.zrodla_z_bledem) ? d.cron.zrodla_z_bledem : [];
  if (zBledem.length && d.cron?.slad_sprzed_naprawy !== true) powody.push({ kod: 'zrodla', opis: `błąd źródła w cyklu: ${zBledem.join(', ')}` });
  if (d.ai?.ok === false) powody.push({ kod: 'ai', opis: `oceny AI padają (${Object.keys(d.ai?.bledy_wg_typu ?? {}).join(', ') || 'błąd'})` });
  if (d.push?.ok === false) powody.push({ kod: 'push', opis: `powiadomienia push nie docierają (${d.push?.ostatni_blad ?? 'błąd'})` });
  if (d.auto_swz?.ok === false) powody.push({ kod: 'auto_swz', opis: `automatyczna analiza SWZ przerwana (${d.auto_swz?.error ?? 'błąd'})` });
  // 503 bez rozpoznanego powodu — i tak alarm (nowa reguła w /health, której strażnik nie zna).
  if (!powody.length && (odpowiedz.status >= 500 || d.status !== 'ok')) powody.push({ kod: 'status', opis: `/health zgłasza „${d.status ?? odpowiedz.status}”` });
  return powody;
}

export async function pobierzHealth({ url = env.HEALTH_URL, fetchFn = fetch, limitMs = 30_000 } = {}) {
  try {
    const res = await fetchFn(url, { headers: { Accept: 'application/json', 'User-Agent': 'PrzetargAI-straz/1.0' }, signal: AbortSignal.timeout(limitMs) });
    let cialo = null;
    try { cialo = await res.json(); } catch { /* nie-JSON */ }
    return { status: res.status, cialo, blad: cialo ? null : `HTTP ${res.status}, odpowiedź nie-JSON` };
  } catch (err) {
    return { status: null, cialo: null, blad: err.message };
  }
}

export async function runStrazZdrowia({
  teraz = nowIso(), pobierz = pobierzHealth, wyslij = sendEmail, repo = repoStrazy, znacznik = alarmZdrowia,
} = {}) {
  const odpowiedz = await pobierz();
  const powody = powodyAlarmu(odpowiedz);
  const poprzedni = await repo.wczytaj().catch(() => null);
  const bylo = new Set((poprzedni?.powody ?? []).map((p) => p.kod));
  // Alarm tylko dla powodów obecnych także w POPRZEDNIM pomiarze (≥ 1 h trwania).
  const trwale = powody.filter((p) => bylo.has(p.kod));
  await repo.zapisz({ powody, sprawdzono_o: teraz, status_http: odpowiedz.status ?? null });

  const wynik = { ok: true, powody: powody.map((p) => p.kod), trwale: trwale.map((p) => p.kod), wyslano: false };
  if (!trwale.length) return wynik;

  const klucz = `${dobaWarszawska(teraz)}|${trwale.map((p) => p.kod).sort().join(',')}`;
  if (!await znacznik.zarezerwuj(klucz)) return { ...wynik, powod: 'juz_wyslany_dzis' };
  let rezultat;
  try {
    rezultat = await wyslij({ to: env.ALARM_EMAIL, ...alarmZdrowiaEmail({ powody: trwale, healthUrl: env.HEALTH_URL }) });
  } catch (err) {
    rezultat = { sent: false, error: err.message };
  }
  if (!rezultat?.sent) {
    await znacznik.zwolnij(klucz).catch(() => {});
    logger.error({ powody: wynik.trwale, error: rezultat?.error }, 'Strażnik: alarm zdrowia NIE został wysłany');
    return { ...wynik, ok: false, error: rezultat?.error ?? 'wysyłka nieudana' };
  }
  await znacznik.potwierdz(klucz, { emailId: rezultat.id ?? null, typ: wynik.trwale.join(',') }).catch(() => {});
  logger.warn({ powody: wynik.trwale }, 'Strażnik: wysłano alarm zdrowia do właściciela');
  return { ...wynik, wyslano: true };
}
