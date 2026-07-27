import { logger } from '../lib/logger.js';
import { isMainModule, nowIso } from '../lib/ids.js';
import { db } from '../db/index.js';
import { users as usersRepoDomyslny } from '../db/repos.js';
import { createSejfDokumentow } from '../services/sejfDokumentow.js';
import { dzienAlertu } from '../services/waznoscDokumentow.js';
import { sendPush } from '../services/push.js';

/*
 * Przypomnienia z wyprzedzeniem dla sejfu dokumentów (ulepszenie „Sejf podmiotowych
 * środków dowodowych z licznikiem świeżości", podzadanie 6/7).
 *
 * Jeden przebieg skanuje dokumenty WSZYSTKICH użytkowników i dla każdego, który wszedł
 * w okno „zamów nowy", powiadamia właściciela. Okno liczy `dzienAlertu` (podzadanie 2):
 *   dzień alertu = data ważności − (realny czas oczekiwania urzędu + bufor).
 * Realny czas urzędu bierze się z katalogu typów — dlatego KRK pocztą (~21 dni) zapala
 * alert istotnie WCZEŚNIEJ niż US/ZUS (~7 dni). To sedno wymagania: „przypomina z
 * wyprzedzeniem uwzględniającym realny czas oczekiwania na urząd".
 *
 * Dokument jest w oknie, gdy `dzien >= dzienAlertu` i jeszcze NIE stracił ważności
 * (`dniDoWaznosci >= 0`) — to dokładnie status „zamów nowy" z podzadania 2. Dokumenty
 * bezterminowe (wykaz robót, część uprawnień) nie mają daty ważności → nigdy nie
 * alarmują. Porównanie dat idzie po łańcuchach ISO 'YYYY-MM-DD' (leksykograficznie =
 * chronologicznie), więc job nie potrzebuje arytmetyki dat — całą liczy `waznoscDokumentow`.
 *
 * BEZ SIECI I BEZ PŁATNEGO AI — czysta arytmetyka dat + best-effort push. `dzien`
 * (dziś) i powiadomienie są wstrzykiwane, więc job testujemy deterministycznie bez
 * zegara i bez Expo. Błąd jednego rekordu (np. push 500) NIE przerywa przebiegu —
 * łapiemy per dokument i lecimy dalej (jak monitorWaloryzacji/monitorPodprogowy).
 *
 * DEDUP: świadomie NIE trzymamy stanu „już alarmowano" — tabela `sejf_dokumenty` nie ma
 * takiej kolumny, a jej dołożenie ruszałoby współdzielony schemat z cudzym WIP (pułapka
 * drzewa roboczego z pamięci projektu). Przy dziennej kadencji oznacza to jedno
 * przypomnienie na dobę, dopóki dokument nie zostanie odnowiony — dla przypominajki jest
 * to zachowanie pożądane, a nie ścieżka pieniędzy, więc powtórki są nieszkodliwe.
 */

/** Dzisiejsza data ISO 'YYYY-MM-DD' — używana, gdy wołający nie poda dnia odniesienia. */
function dzienDzis() {
  return nowIso().slice(0, 10);
}

/**
 * Domyślne powiadomienie: push do właściciela dokumentu (best-effort). Bez push-tokenu
 * NIE ruszamy sieci — stan w bazie (status „zamów nowy") jest źródłem prawdy, push jest
 * tylko dodatkiem. Zwraca `{ sent }` (0, gdy brak tokenu/błąd wysyłki).
 */
export async function powiadomOTerminie(user, { dok } = {}) {
  if (!user?.push_token) return { sent: 0 };
  const dni = dok.dniDoWaznosci;
  const gdzie = dok.online ? ` Wyrób online: ${dok.online.nazwa} (${dok.online.url}).` : '';
  return sendPush(user.push_token, {
    title: `Zamów nowy dokument: ${dok.nazwaTypu}`,
    body: `„${dok.nazwaTypu}" traci ważność za ${dni} dni. Zamów nowy z wyprzedzeniem, `
      + `żeby zdążył dojść z urzędu przed złożeniem oferty.${gdzie}`,
    data: { type: 'sejf_alert', typ: dok.typ_dokumentu, dokumentId: dok.id },
  });
}

/**
 * Czy dokument wszedł w okno „zamów nowy" na dany dzień (liczone przez `dzienAlertu`).
 * @param {{dataWaznosci: string|null, czasOczekiwaniaUrzadDni: number, dniDoWaznosci: number|null}} dok
 * @param {string} dzien 'YYYY-MM-DD'
 * @param {number} buforDni dodatkowy zapas (alarm jeszcze wcześniej)
 * @returns {string|null} dzień alertu, gdy dokument JEST w oknie; inaczej null
 */
function alertNaDzien(dok, dzien, buforDni) {
  if (!dok.dataWaznosci) return null;                 // bezterminowy / brak daty → brak okna
  const alertOd = dzienAlertu(dok.dataWaznosci, dok.czasOczekiwaniaUrzadDni, buforDni);
  if (!alertOd) return null;
  // W oknie: minął dzień alertu (dzien >= alertOd) i dokument jeszcze ważny (dni >= 0).
  const wOknie = dzien >= alertOd && Number.isFinite(dok.dniDoWaznosci) && dok.dniDoWaznosci >= 0;
  return wOknie ? alertOd : null;
}

/**
 * Jeden przebieg cyklicznego monitora sejfu: dla każdego dokumentu w oknie „zamów nowy"
 * powiadamia właściciela. Zależności wstrzykiwane, więc job testujemy bez sieci/zegara.
 * @param {{sejf?: object, usersRepo?: object,
 *   powiadom?: (user: any, ctx: {dok: object}) => Promise<{sent: number}>,
 *   dzien?: string, buforDni?: number}} [deps]
 * @returns {Promise<{ok: boolean, dokumenty: number, alerty: number,
 *   powiadomienia: number, bledy: number, durationMs: number}>}
 */
export async function runSejfMonitor({
  sejf = createSejfDokumentow(db),
  usersRepo = usersRepoDomyslny,
  powiadom = powiadomOTerminie,
  dzien = dzienDzis(),
  buforDni = 0,
} = {}) {
  const startedAt = Date.now();
  const dokumenty = sejf.listaWszystkich({ dzienOdniesienia: dzien });
  let alerty = 0;
  let powiadomienia = 0;
  let bledy = 0;

  for (const dok of dokumenty) {
    const alertOd = alertNaDzien(dok, dzien, buforDni);
    if (!alertOd) continue; // poza oknem (świeży / bezterminowy / przeterminowany)

    alerty++;
    try {
      const user = usersRepo.findById(dok.user_id);
      const wynik = await powiadom(user, { dok, alertOd });
      if (wynik?.sent) powiadomienia++;
    } catch (err) {
      bledy++;
      logger.error({ dokument: dok.id, err: err.message }, 'monitorSejf: błąd powiadomienia');
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info(
    { dokumenty: dokumenty.length, alerty, powiadomienia, bledy, durationMs },
    'monitorSejf: zakończono',
  );
  return { ok: true, dokumenty: dokumenty.length, alerty, powiadomienia, bledy, durationMs };
}

// Ręczne uruchomienie: `node src/jobs/monitorSejf.js`
if (isMainModule(import.meta.url)) {
  const { migrate } = await import('../db/migrate.js');
  migrate();
  runSejfMonitor()
    .then((result) => {
      logger.info(result, 'Ręczne uruchomienie monitorSejf zakończone');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'monitorSejf: błąd krytyczny');
      process.exit(1);
    });
}
