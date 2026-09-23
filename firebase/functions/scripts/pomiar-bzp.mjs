#!/usr/bin/env node
/*
 * POMIAR I REKONSYLIACJA OKNA BZP (P0-2).
 *
 * Odpowiada na pytanie, którego audyt 2026-09-23 nie potrafił zamknąć:
 * „ile ogłoszeń BZP opublikowało w danym oknie i ile z nich widzi nasz adapter".
 *
 * Skrypt jest WYŁĄCZNIE ODCZYTOWY:
 *  • nie dotyka bazy (żadnego Firestore, żadnego zapisu),
 *  • nie woła płatnego AI,
 *  • pyta publiczne API BZP tym samym kodem, którym pyta produkcja.
 *
 * Użycie:
 *   node --env-file=.env.test scripts/pomiar-bzp.mjs 2026-09-16 2026-09-22
 *   node --env-file=.env.test scripts/pomiar-bzp.mjs 2026-09-16 2026-09-22 --odniesienie pomiar-audytu.json
 *
 * Plik odniesienia to `{ "2026-09-16": 1103, ... }` — np. liczby zmierzone
 * niezależną metodą. Skrypt policzy pokrycie per doba i dla całego okna.
 */

import { pobierzOgloszeniaBzp, dniWZakresie } from '../src/services/bzp.js';
import { pustyLicznik, zliczDuplikaty } from '../src/lib/licznikZrodla.js';

const [od, doDnia, ...reszta] = process.argv.slice(2);
if (!od || !doDnia) {
  console.error('Użycie: node scripts/pomiar-bzp.mjs <od YYYY-MM-DD> <do YYYY-MM-DD> [--odniesienie plik.json]');
  process.exit(2);
}

const iOdniesienie = reszta.indexOf('--odniesienie');
const odniesienie = iOdniesienie >= 0
  ? JSON.parse(await (await import('node:fs/promises')).readFile(reszta[iOdniesienie + 1], 'utf8'))
  : null;

const dni = dniWZakresie(od, doDnia);
const licznik = pustyLicznik();
const start = Date.now();

const ogloszenia = await pobierzOgloszeniaBzp({ dni, licznik });

const wiersze = (licznik.dni ?? []).map((d) => {
  const wzorzec = odniesienie?.[d.dzien] ?? null;
  return {
    dzien: d.dzien,
    pobrano: d.pobrano,
    ucietySufit: d.ucietySufit,
    zapytania: d.zapytania,
    wojewodztwaBezDanych: d.wojewodztwaBezDanych,
    blad: d.blad ?? null,
    odniesienie: wzorzec,
    pokrycie_proc: wzorzec ? Number(((d.pobrano / wzorzec) * 100).toFixed(1)) : null,
  };
});

const sumaPobrano = wiersze.reduce((s, w) => s + w.pobrano, 0);
const sumaOdniesienia = odniesienie
  ? dni.reduce((s, d) => s + (odniesienie[d] ?? 0), 0)
  : null;

const raport = {
  okno: { od, do: doDnia, dni: dni.length },
  ogloszenia_unikalne_w_oknie: ogloszenia.length,
  suma_pobrano_per_doba: sumaPobrano,
  liczniki: {
    surowe: licznik.surowe,
    odrzucone: licznik.odrzucone,
    zapytania: licznik.zapytania,
    zduplikowane: zliczDuplikaty(licznik, ogloszenia.length),
  },
  doby_z_bledem: wiersze.filter((w) => w.blad).map((w) => w.dzien),
  doby_pominiete: licznik.pominieteDni ?? [],
  rekonsyliacja: sumaOdniesienia === null ? null : {
    suma_odniesienia: sumaOdniesienia,
    pokrycie_proc: Number(((sumaPobrano / sumaOdniesienia) * 100).toFixed(1)),
  },
  doby: wiersze,
  czas_ms: Date.now() - start,
};

console.log(JSON.stringify(raport, null, 2));
