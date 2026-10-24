import { WIELKOSCI_FIRMY, normalizujNip } from './dokumentyOferty.js';

/*
 * „Ściąga do JEDZ (ESPD)" — powyżej progów UE (ogłoszenia z TED) oświadczenie
 * wstępne z art. 125 ust. 1 Pzp składa się na Jednolitym Europejskim Dokumencie
 * Zamówienia: formularzu KE wypełnianym w serwisie eESPD (espd.uzp.gov.pl) albo
 * na wzorze dołączonym do SWZ. Formularz ma kilkadziesiąt pól i pytań „tak/nie";
 * typowa mała firma odpowiada w nich zawsze tak samo — tu dostaje gotową listę
 * „co wpisać, co zaznaczyć" z własnymi danymi.
 *
 * Zakres świadomie: Część II (wykonawca), III (podstawy wykluczenia), IV α
 * (ogólne oświadczenie o spełnianiu warunków — zamawiający w Polsce prawie zawsze
 * dopuszcza samą α), VI (oświadczenia końcowe). Część V (ograniczenie liczby
 * kandydatów) dotyczy trybów dwuetapowych — poza zakresem.
 * CZYSTA logika, nigdy nie rzuca.
 */

const niepusty = (v) => typeof v === 'string' && v.trim().length > 0;
const w = (v) => (niepusty(v) ? v.trim() : '…');

export const SEKCJE_JEDZ = Object.freeze([
  { id: 'II_A', tytul: 'CZĘŚĆ II A — Informacje na temat wykonawcy' },
  { id: 'II_B', tytul: 'CZĘŚĆ II B — Przedstawiciele wykonawcy' },
  { id: 'II_C', tytul: 'CZĘŚĆ II C — Poleganie na zdolnościach innych podmiotów' },
  { id: 'II_D', tytul: 'CZĘŚĆ II D — Podwykonawcy, na których zdolności wykonawca nie polega' },
  { id: 'III_A', tytul: 'CZĘŚĆ III A — Podstawy związane z wyrokami skazującymi' },
  { id: 'III_B', tytul: 'CZĘŚĆ III B — Podatki i składki na ubezpieczenie społeczne' },
  { id: 'III_C', tytul: 'CZĘŚĆ III C — Niewypłacalność, konflikt interesów, wykroczenia zawodowe' },
  { id: 'III_D', tytul: 'CZĘŚĆ III D — Krajowe podstawy wykluczenia (art. 108–109 Pzp)' },
  { id: 'IV_ALFA', tytul: 'CZĘŚĆ IV α — Ogólne oświadczenie o spełnianiu warunków udziału' },
  { id: 'VI', tytul: 'CZĘŚĆ VI — Oświadczenia końcowe' },
]);

/**
 * @param {{wykonawca?: object, przetarg?: {tytul?, zamawiajacy?, numer?}, sytuacja?: {polegaNaZasobach?: boolean, podwykonawcy?: string, konsorcjum?: boolean}}} we
 * @returns {{id, nazwa, tresc, ostrzezenia: string[]}}
 */
export function generujSciageJedz({ wykonawca, przetarg, sytuacja } = {}) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const p = przetarg && typeof przetarg === 'object' ? przetarg : {};
  const s = sytuacja && typeof sytuacja === 'object' ? sytuacja : {};
  const ostrzezenia = [];
  if (!niepusty(k.nazwa) || !niepusty(k.nip)) ostrzezenia.push('Uzupełnij dane firmy w „Dokumentach do oferty" — ściąga ma kropki w miejscu nazwy lub NIP.');
  const wielkosc = WIELKOSCI_FIRMY.find((x) => x.id === k.wielkosc);
  const msp = wielkosc ? (wielkosc.id === 'duze' ? 'NIE' : 'TAK') : 'TAK / NIE (ustaw wielkość firmy w danych)';
  const polega = Boolean(s.polegaNaZasobach);
  const podw = niepusty(s.podwykonawcy);
  const konsorcjum = Boolean(s.konsorcjum);
  if (polega) ostrzezenia.push('Polegasz na zasobach innego podmiotu: ten podmiot składa OSOBNY JEDZ (Część II A–B i III, a IV w zakresie udostępnianych zasobów) i dołączasz jego zobowiązanie (art. 118).');
  if (konsorcjum) ostrzezenia.push('Konsorcjum: każdy członek składa własny JEDZ; w II A podaj rolę w konsorcjum i nazwy pozostałych członków.');

  const wiersze = [
    'ŚCIĄGA DO JEDZ (ESPD) — co wpisać i co zaznaczyć',
    `Postępowanie: ${w(p.tytul)}${niepusty(p.numer) ? ` (nr ${p.numer.trim()})` : ''} · Zamawiający: ${w(p.zamawiajacy)}`,
    '',
    'Jak wypełnić: otwórz eESPD (https://espd.uzp.gov.pl), wczytaj plik JEDZ (.xml) z SWZ jako wykonawca, przejdź sekcje jak poniżej, wyeksportuj XML i PDF, podpisz elektronicznie i dołącz do oferty. Zamawiający może zamiast tego dać własny wzór w .docx — pola są te same.',
    '',
    SEKCJE_JEDZ[0].tytul,
    `• Nazwa: ${w(k.nazwa)}`,
    `• Numer VAT / NIP: ${w(normalizujNip(k.nip) || k.nip)}${niepusty(k.regon) ? ` · REGON: ${k.regon.trim()}` : ''}${niepusty(k.rejestr) ? ` · ${k.rejestr.trim()}` : ''}`,
    `• Adres pocztowy: ${w(k.adres)}`,
    `• Osoba do kontaktów / e-mail / telefon: ${w(k.reprezentant)} / ${w(k.email)} / ${w(k.telefon)}`,
    `• Czy wykonawca jest MŚP? → zaznacz: ${msp}`,
    '• Wykaz urzędowy / certyfikacja: NIE (chyba że masz certyfikat wykonawcy — wtedy TAK i numer)',
    `• Czy wykonawca bierze udział w postępowaniu wspólnie z innymi? → zaznacz: ${konsorcjum ? 'TAK — podaj rolę (lider/partner), nazwy pozostałych członków i nazwę konsorcjum' : 'NIE'}`,
    '• Części zamówienia, których dotyczy oferta: wpisz numery części (jeśli zamówienie jest podzielone)',
    '',
    SEKCJE_JEDZ[1].tytul,
    `• Imię i nazwisko: ${w(k.reprezentant)} · Stanowisko / działanie w charakterze: ${w(k.stanowisko)}`,
    `• Adres / e-mail / telefon: ${w(k.adres)} / ${w(k.email)} / ${w(k.telefon)}`,
    '• Informacje o reprezentacji: „zgodnie z odpisem z KRS / wpisem do CEIDG" albo „na podstawie pełnomocnictwa z dnia …"',
    '',
    SEKCJE_JEDZ[2].tytul,
    `• Czy wykonawca polega na zdolnościach innych podmiotów? → zaznacz: ${polega ? 'TAK — ten podmiot składa osobny JEDZ, a Ty dołączasz jego zobowiązanie (art. 118 Pzp)' : 'NIE'}`,
    '',
    SEKCJE_JEDZ[3].tytul,
    `• Czy wykonawca zamierza zlecić podwykonawcom jakąkolwiek część zamówienia? → zaznacz: ${podw ? `TAK — wpisz: ${s.podwykonawcy.trim()} (nazwy podwykonawców, jeśli już znani)` : 'NIE'}`,
    '',
    SEKCJE_JEDZ[4].tytul,
    '• Udział w organizacji przestępczej, korupcja, nadużycie, przestępstwa terrorystyczne, pranie pieniędzy, praca dzieci / handel ludźmi → przy każdym zaznacz: NIE',
    '',
    SEKCJE_JEDZ[5].tytul,
    '• Czy wykonawca wywiązał się z obowiązku płatności podatków i składek? → zaznacz: TAK (brak naruszeń) — jeśli masz układ ratalny z US/ZUS, zaznacz TAK z opisem porozumienia',
    '',
    SEKCJE_JEDZ[6].tytul,
    '• Naruszenie prawa ochrony środowiska / socjalnego / pracy, upadłość, likwidacja, układ z wierzycielami, poważne wykroczenie zawodowe, porozumienia zakłócające konkurencję, konflikt interesów, udział w przygotowaniu postępowania, wcześniejsze rozwiązanie umowy, wprowadzenie w błąd → przy każdym zaznacz: NIE',
    '• Jeśli którakolwiek odpowiedź to TAK — przejdź przez Kreator samooczyszczenia (art. 110) i opisz podjęte środki.',
    '',
    SEKCJE_JEDZ[7].tytul,
    '• Czy mają zastosowanie krajowe podstawy wykluczenia (art. 108 ust. 1, a gdy zamawiający przewidział — art. 109 ust. 1 Pzp; art. 7 ust. 1 ustawy sankcyjnej)? → zaznacz: NIE',
    '',
    SEKCJE_JEDZ[8].tytul,
    '• „Ogólne oświadczenie dotyczące wszystkich kryteriów kwalifikacji" → zaznacz: TAK. Sekcji A–D Części IV NIE wypełniaj, jeżeli zamawiający w SWZ dopuścił samą α (w Polsce to standard — sprawdź rozdział o JEDZ w SWZ).',
    '',
    SEKCJE_JEDZ[9].tytul,
    '• Oświadczenie o prawdziwości informacji i zgodzie na dostęp do dokumentów: zaznacz / wpisz datę i miejscowość.',
    `• Podpis: ${w(k.reprezentant)} — kwalifikowany podpis elektroniczny na pliku JEDZ (XML lub PDF); „ręcznie podpisany skan" nie wystarcza.`,
    '',
    ...(ostrzezenia.length ? ['UWAGI:', ...ostrzezenia.map((o) => `• ${o}`)] : []),
  ];

  return { id: 'sciaga_jedz', nazwa: 'Ściąga do JEDZ (ESPD)', tresc: wiersze.join('\n'), ostrzezenia };
}
