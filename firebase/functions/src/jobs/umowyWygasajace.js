import { rozstrzygniecia, umowyWygasajace, tenders, users, alerty } from '../db/repos.js';
import { zbudujKubelkiUmow, pozycjaUmowy, nastepcyUmow, twojeUmowy, alertTwojejUmowy, HORYZONT_DNI } from '../lib/umowyWygasajace.js';
import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';
import { dostarcz } from './monitorWyszukiwan.js';

/**
 * Przeliczenie radaru wygasających umów (2026-10-31) — raz na dobę, bez rejestrów i bez AI:
 * czyta zapisane rozstrzygnięcia z końcem umowy w [dziś, dziś + HORYZONT_DNI], składa kubełki
 * dział CPV × województwo (`lib/umowyWygasajace.js`) i zapisuje je w `umowy_wygasajace`.
 * Od 2026-11-01 dopisuje też następcę umowy: otwarty przetarg, który jest jej nową edycją.
 * Ślad przebiegu w `_health/umowy_wygasajace` (widać go w `/health`).
 */
export async function runUmowyWygasajace({
  teraz = Date.now(), repo = rozstrzygniecia, magazyn = umowyWygasajace, przetargi = tenders, twoje = runTwojeUmowy,
} = {}) {
  const start = Date.now();
  const od = new Date(teraz).toISOString().slice(0, 10);
  const doDnia = new Date(teraz + HORYZONT_DNI * 86_400_000).toISOString().slice(0, 10);
  let stan;
  try {
    const wyniki = await repo.konczaceSie(od, doDnia);
    // Bez listy otwartych przetargów radar dalej działa — tylko bez linków do nowych edycji.
    let bladNastepcow = null;
    const otwarte = await przetargi.otwarteZNipem().catch((err) => {
      bladNastepcow = err.message;
      logger.warn({ err: err.message }, 'Radar umów: nie odczytano otwartych przetargów — bez następców');
      return [];
    });
    const nastepcy = nastepcyUmow(wyniki, otwarte, { teraz });
    const kubelki = zbudujKubelkiUmow(wyniki, { teraz, nastepcy });
    const kubelkow = await magazyn.zapisz(kubelki);
    const pozycje = wyniki.filter((w) => pozycjaUmowy(w, { odDnia: od, doDnia }));
    stan = {
      zakonczony_o: new Date().toISOString(), od, do: doDnia,
      rozstrzygniec: wyniki.length, umow_cyklicznych: pozycje.length, kubelkow,
      otwartych_przetargow: otwarte.length,
      juz_ogloszonych: pozycje.filter((w) => nastepcy.has(w.externalId)).length,
      blad_nastepcow: bladNastepcow,
      // Alert o własnych umowach — błąd tej części nie psuje radaru (kubełki już zapisane).
      twoje_umowy: bladNastepcow ? null : await twoje({ teraz, otwarte }).catch((err) => {
        logger.error({ err: err.message }, 'Radar umów: alerty o własnych umowach nie powiodły się');
        return { ok: false, error: err.message };
      }),
      czas_ms: Date.now() - start, ok: true, error: null,
    };
  } catch (err) {
    logger.error({ err: err.message }, 'Radar wygasających umów: przeliczenie nie powiodło się');
    stan = { zakonczony_o: new Date().toISOString(), od, do: doDnia, czas_ms: Date.now() - start, ok: false, error: err.message };
  }
  await magazyn.zapiszPrzebieg(stan).catch((err) => logger.error({ err: err.message }, 'Radar umów: nie zapisano śladu przebiegu'));
  return stan;
}

/**
 * „Twoja umowa wraca do przetargu” (2026-11-01): dla kont z NIP-em firmy szuka ich umów kończących się
 * w horyzoncie radaru, których następca jest już ogłoszony (`otwarte` z przebiegu radaru — bez
 * drugiego odczytu przetargów). Alert idzie do centrum alertów i pushem (bez pushu — e-mailem) tylko
 * przy PIERWSZYM zapisie: klucz umowa × przetarg odsiewa powtórki z kolejnych dni. Bez płatnego AI.
 */
export async function runTwojeUmowy({
  teraz = Date.now(), otwarte = [], konta = users, wyniki = rozstrzygniecia, alertyRepo = alerty,
  wyslijPush = sendPush, wyslijEmail = sendEmail,
} = {}) {
  const wynik = { ok: true, konta: 0, umow: 0, z_nastepca: 0, alerty: 0, push: 0, email: 0, bledy: 0 };
  const od = new Date(teraz).toISOString().slice(0, 10);
  for (const user of await konta.zNipem()) {
    try {
      wynik.konta += 1;
      const lista = twojeUmowy({ wyniki: await wyniki.umowyWykonawcy(user.company_nip, { od }), otwarte, teraz });
      wynik.umow += lista.length;
      for (const umowa of lista) {
        if (umowa.nastepca) wynik.z_nastepca += 1;
        const alert = alertTwojejUmowy(umowa);
        if (!alert) continue;
        const { nowy } = await alertyRepo.dodaj(user.id, alert, nowIso());
        if (!nowy) continue;
        wynik.alerty += 1;
        const kanal = await dostarcz({ user, alert, wyslijPush, wyslijEmail });
        if (kanal === 'push') wynik.push += 1;
        if (kanal === 'email') wynik.email += 1;
      }
    } catch (err) {
      wynik.bledy += 1;
      logger.error({ err: err.message, userId: user.id }, 'Twoje umowy: konto pominięte');
    }
  }
  wynik.ok = wynik.bledy === 0;
  return wynik;
}
