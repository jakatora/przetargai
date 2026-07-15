/**
 * Etapy pracy nad zapisanym przetargiem (D-054 — warsztat przetargu).
 * Lustro backendu (src/lib/statusPrzetargu.js) — świadomy duplikat, bo mobile i
 * functions to osobne pakiety. Przy zmianie etapów zaktualizować OBA miejsca.
 */
export const STATUSY = [
  { wartosc: 'rozwazam', etykieta: 'Rozważam' },
  { wartosc: 'przygotowuje', etykieta: 'Przygotowuję ofertę' },
  { wartosc: 'zlozona', etykieta: 'Oferta złożona' },
  { wartosc: 'wygrana', etykieta: 'Wygrana' },
  { wartosc: 'przegrana', etykieta: 'Przegrana' },
];

export const STATUS_DOMYSLNY = 'rozwazam';

export function etykietaStatusu(wartosc) {
  return (STATUSY.find((s) => s.wartosc === wartosc) ?? STATUSY[0]).etykieta;
}
