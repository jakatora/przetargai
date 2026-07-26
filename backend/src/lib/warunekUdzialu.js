import { isMainModule } from './ids.js';

/**
 * WALIDACJA warunku udziału typu „doświadczenie" (zdolność techniczna/zawodowa)
 * z wykryciem ścieżki ratunkowej z art. 118 Pzp — podzadanie 1/12 ulepszenia
 * „Pożycz doświadczenie: kreator polegania na zasobach podmiotu trzeciego".
 *
 * Czysta funkcja, bez I/O i bez sieci. Porównuje WYMAGANE doświadczenie z tym,
 * które wykonawca wykazuje WŁASNYMI referencjami. Gdy własne nie wystarcza,
 * NIE zwraca blokującego „nie spełniasz warunków", lecz obiekt-sygnał
 * `WynikWarunku` z `uruchom_kreator_118=true` — wejście do kreatora, który
 * poprowadzi przez zobowiązanie podmiotu trzeciego (art. 118 Pzp).
 *
 * Świadome decyzje modelu:
 *  • Sygnał kreatora dotyczy WYŁĄCZNIE warunku doświadczenia (zdolność
 *    techniczna/zawodowa) — to tu art. 118 Pzp pozwala polegać na zasobach
 *    innego podmiotu; podstaw wykluczenia „pożyczyć" nie można, więc taka
 *    walidacja nie należy do tej funkcji.
 *  • ZERO własnego doświadczenia (posiadana=0) też uruchamia kreator — na
 *    gruncie art. 118 wolno polegać na zasobach podmiotu trzeciego w całości,
 *    nie tylko „uzupełniająco". Blokada byłaby błędem merytorycznym.
 *  • `spelniony` jest WYPROWADZONY z porównania (posiadana >= wymagana), a
 *    `uruchom_kreator_118 == !spelniony` — jedno źródło prawdy, sygnał nie może
 *    twierdzić „spełniony" i jednocześnie proponować kreatora.
 *  • Wynik jest ZAMROŻONY — to migawka oceny, której nikt nie „poprawi" po fakcie.
 *  • Konstruktor pilnuje integralności wejścia (niepusta nazwa, dodatnia wymagana
 *    wartość, nieujemna liczbowa posiadana), żeby wadliwe dane nie zamieniły się
 *    w mylący sygnał o (nie)spełnieniu warunku.
 *
 * Uwaga: „wartości" są tu skalarami porównywalnymi (np. liczba wymaganych robót,
 * albo wartość zł) — jednostkę do opisu luki podaje wywołujący (`jednostka`).
 * Reguła „doświadczenia nie wolno sumować" i realne podwykonawstwo podmiotu
 * użyczającego to treść kolejnych podzadań kreatora, nie tej detekcji.
 */

/** Czy wartość jest niepustym (po przycięciu spacji) stringiem. */
function niepustyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** Czy wartość jest skończoną liczbą. */
function skonczonaLiczba(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Ocenia jeden warunek udziału dotyczący doświadczenia.
 * @param {object} arg
 * @param {string} arg.nazwa_warunku etykieta warunku (np. z SWZ) — wymagana, niepusta.
 * @param {number} arg.wymagana_wartosc wymagane doświadczenie (skalar > 0).
 * @param {number} arg.posiadana_wartosc wykazane WŁASNYMI referencjami (skalar >= 0).
 * @param {string} [arg.jednostka] jednostka do opisu luki (np. „roboty budowlane…").
 * @returns {{nazwa_warunku: string, spelniony: boolean, luka_opis: string,
 *   wymagana_wartosc: number, posiadana_wartosc: number, uruchom_kreator_118: boolean}}
 *   obiekt ZAMROŻONY (`WynikWarunku`).
 * @throws {TypeError} gdy nazwa pusta, wymagana_wartosc <= 0, albo posiadana_wartosc
 *   nieliczbowa/ujemna.
 */
export function oceniWarunekDoswiadczenia({
  nazwa_warunku,
  wymagana_wartosc,
  posiadana_wartosc,
  jednostka = '',
} = {}) {
  if (!niepustyString(nazwa_warunku)) {
    throw new TypeError('oceniWarunekDoswiadczenia: nazwa_warunku musi być niepustym stringiem');
  }
  if (!(skonczonaLiczba(wymagana_wartosc) && wymagana_wartosc > 0)) {
    throw new TypeError('oceniWarunekDoswiadczenia: wymagana_wartosc musi być liczbą > 0');
  }
  if (!(skonczonaLiczba(posiadana_wartosc) && posiadana_wartosc >= 0)) {
    throw new TypeError('oceniWarunekDoswiadczenia: posiadana_wartosc musi być liczbą >= 0');
  }

  const spelniony = posiadana_wartosc >= wymagana_wartosc;
  const jed = niepustyString(jednostka) ? `${jednostka.trim()}: ` : '';
  const luka_opis = spelniony
    ? ''
    : `${jed}wymagane ${wymagana_wartosc}, wykazane własnym doświadczeniem `
      + `${posiadana_wartosc}, brakuje ${wymagana_wartosc - posiadana_wartosc}.`;

  return Object.freeze({
    nazwa_warunku,
    spelniony,
    luka_opis,
    wymagana_wartosc,
    posiadana_wartosc,
    uruchom_kreator_118: !spelniony,
  });
}

// Podgląd: `node src/lib/warunekUdzialu.js --demo`
if (isMainModule(import.meta.url) && process.argv.includes('--demo')) {
  const demo = oceniWarunekDoswiadczenia({
    nazwa_warunku: 'Zdolność techniczna — roboty budowlane',
    wymagana_wartosc: 2,
    posiadana_wartosc: 1,
    jednostka: 'roboty budowlane o wartości min. 500 000 zł',
  });
  console.log(JSON.stringify(demo, null, 2));
}
