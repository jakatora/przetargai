/*
 * Zamknięta lista przyczyn odrzucenia (spec §4.3) — wspólna dla reguł karty,
 * oceny AI i odrzuceń klienta. Raport dnia i propozycje zmian karty liczą się
 * po tych kodach, więc nowa przyczyna = zmiana tutaj, w mobile/src/lib/selekcja.js
 * i w prompcie AI (lib/werdyktAi.js).
 */
export const PRZYCZYNY = Object.freeze(['branza', 'wykluczenie', 'teren', 'za_duze', 'za_male', 'termin', 'warunki', 'inne']);

/** Klient odrzuca bez „wykluczenia” — to reguła karty, nie jego ocena. */
export const PRZYCZYNY_KLIENTA = Object.freeze(PRZYCZYNY.filter((k) => k !== 'wykluczenie'));

export const ETYKIETY_PRZYCZYN = Object.freeze({
  branza: { pl: 'Nie Twoja branża', en: 'Not your trade' },
  wykluczenie: { pl: 'Na liście „nie bierzemy”', en: 'On your “we don’t do” list' },
  teren: { pl: 'Poza Twoim terenem', en: 'Outside your area' },
  za_duze: { pl: 'Za duże dla Twojej firmy', en: 'Too large for your company' },
  za_male: { pl: 'Za małe', en: 'Too small' },
  termin: { pl: 'Za mało czasu na ofertę', en: 'Not enough time to bid' },
  warunki: { pl: 'Warunki udziału nie do spełnienia', en: 'Participation conditions not met' },
  inne: { pl: 'Inne', en: 'Other' },
});

export function normalizujPrzyczyne(kod) {
  return PRZYCZYNY.includes(kod) ? kod : 'inne';
}

export function pustyLicznikPrzyczyn() {
  return Object.fromEntries(PRZYCZYNY.map((k) => [k, 0]));
}
