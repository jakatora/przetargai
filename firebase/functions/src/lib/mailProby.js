import { esc } from './html.js';

/* Maile 7-dniowej próby Standard (spec §15) — czyste szablony. */
const CTA = 'Żeby zachować Standard (99 zł brutto miesięcznie), otwórz aplikację PrzetargAI → Konto → Przejdź na Standard.';

function zbuduj(subject, akapity, linkAplikacji) {
  return {
    subject,
    text: ['Dzień dobry,', '', ...akapity.flatMap((a) => [a, '']), `PrzetargAI: ${linkAplikacji}`].join('\n'),
    html: `<p>Dzień dobry,</p>${akapity.map((a) => `<p>${esc(a)}</p>`).join('')}<p><a href="${esc(linkAplikacji)}">PrzetargAI</a></p>`,
  };
}

export function mailProbyPrzypomnienie({ dniZostalo, linkAplikacji }) {
  const kiedy = dniZostalo <= 1 ? 'jutro' : `za ${dniZostalo} dni`;
  return zbuduj(`Twoja próba Standard kończy się ${kiedy}`, [
    'Przez tydzień korzystasz z pełnego planu Standard: wybieramy dla Ciebie przetargi bez dziennego limitu, powiadamiamy od razu, sprawdzamy warunki udziału i prowadzimy krok po kroku do oferty.',
    'Po zakończeniu próby konto wróci do planu Free: 5 przetargów dziennie i jeden mail dziennie.',
    CTA,
  ], linkAplikacji);
}

export function mailProbyKoniec({ linkAplikacji }) {
  return zbuduj('Próba Standard się skończyła — od dziś 5 przetargów dziennie', [
    'Twoja 7-dniowa próba planu Standard dobiegła końca. Konto działa dalej w planie Free: wybieramy do 5 przetargów dziennie i wysyłamy jeden mail dziennie.',
    'W Standard wracają: wybór bez limitu, powiadomienia od razu, sprawdzanie warunków udziału i plan działania do oferty.',
    CTA,
  ], linkAplikacji);
}
