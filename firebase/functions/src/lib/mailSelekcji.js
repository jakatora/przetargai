import { esc } from './html.js';
import { dobaWarszawska } from './czasPolski.js';
import { ETYKIETY_PRZYCZYN } from './przyczyny.js';

/*
 * Mail z wybranymi przetargami (spec §7, §14). Czysty szablon — bez configu i sieci.
 * Teksty mówią „my” (PrzetargAI); słowo „pracownik” nie pada (decyzja 2026-10-23).
 */
export function odmianaPrzetargow(n) {
  if (n === 1) return '1 nowy przetarg';
  const j = n % 10;
  const d = n % 100;
  return j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? `${n} nowe przetargi` : `${n} nowych przetargów`;
}

function termin(iso) {
  if (!Number.isFinite(Date.parse(iso ?? ''))) return 'termin nieznany';
  const [r, m, d] = dobaWarszawska(iso).split('-');
  return `termin ${d}.${m}.${r}`;
}

export function zdanieRaportu(raport) {
  if (!raport) return null;
  const wpisy = Object.entries(raport.odrzucone ?? {}).filter(([, n]) => n > 0);
  const razem = wpisy.reduce((s, [, n]) => s + n, 0);
  const top = wpisy.sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([kod, n]) => `${n} — ${(ETYKIETY_PRZYCZYN[kod]?.pl ?? kod).toLocaleLowerCase('pl')}`);
  return `Dziś przejrzeliśmy ${raport.przejrzane ?? 0} ogłoszeń, wybraliśmy ${raport.wybrane ?? 0}, `
    + `odrzuciliśmy ${razem}${top.length ? ` (${top.join(', ')})` : ''}.`;
}

/** Pytanie o teren dla konta bez województw (services/terenZMaila.js); null = nie pytamy. */
export function zdanieTerenu(teren) {
  if (!teren?.link) return null;
  const ile = teren.wojewodztw >= 2 ? ` — te pochodzą z ${teren.wojewodztw} województw` : '';
  return `Wybieramy dla Ciebie przetargi z całej Polski${ile}. Bierzesz zlecenia tylko w swojej okolicy? `
    + 'Zaznacz województwa — resztę pominiemy:';
}

/** Mail pokazuje najwyżej tyle przetargów (kolejność od wywołującego — najlepiej ocenione pierwsze); reszta w apce. */
export const MAKS_W_MAILU = 10;

export function mailSelekcji({ pozycje: wszystkie, raport = null, plan = 'free', linkWypisu, linkAplikacji, teren = null }) {
  const n = wszystkie.length;
  const pozycje = wszystkie.slice(0, MAKS_W_MAILU);
  const reszta = n - pozycje.length;
  const zdanieReszty = reszta > 0 ? `…i jeszcze ${reszta} — wszystkie zobaczysz w aplikacji.` : null;
  const subject = plan === 'standard' && n === 1
    ? `Nowy przetarg dla Twojej firmy: ${pozycje[0].tytul}`.slice(0, 140)
    : `Mamy dla Ciebie ${odmianaPrzetargow(n)}`;
  const raportZdanie = zdanieRaportu(raport);
  const terenZdanie = zdanieTerenu(teren);

  const text = [
    'Dzień dobry,',
    '',
    'wybraliśmy przetargi pasujące do Twojej firmy:',
    '',
    ...pozycje.flatMap((p) => [
      `• ${p.tytul}${p.organizacja ? ` — ${p.organizacja}` : ''} (${termin(p.termin)})`,
      ...(p.punkty ?? []).slice(0, 2).map((x) => `  – ${x}`),
      ...(p.bez_warunkow ? ['  ✓ Bez warunków udziału — wystarczy oświadczenie o braku podstaw wykluczenia.'] : []),
      ...(p.krok ? [`  Pierwszy krok: ${p.krok}`] : []),
      ...(p.link_odrzuc ? [`  Nie dla nas? ${p.link_odrzuc}`] : []),
    ]),
    ...(zdanieReszty ? ['', zdanieReszty] : []),
    '',
    ...(terenZdanie ? [`${terenZdanie} ${teren.link}`, ''] : []),
    ...(raportZdanie ? [raportZdanie, ''] : []),
    `Szczegóły i uzasadnienie: otwórz aplikację PrzetargAI (${linkAplikacji}).`,
    '',
    `Nie chcesz tych maili? Wyłącz je: ${linkWypisu}`,
  ].join('\n');

  const html = `<p>Dzień dobry,</p>
<p>wybraliśmy przetargi pasujące do Twojej firmy:</p>
<ul>${pozycje.map((p) => `<li><b>${esc(p.tytul)}</b>${p.organizacja ? ` — ${esc(p.organizacja)}` : ''} (${esc(termin(p.termin))})${
    (p.punkty ?? []).slice(0, 2).map((x) => `<br>– ${esc(x)}`).join('')}${p.bez_warunkow ? '<br>✓ Bez warunków udziału — wystarczy oświadczenie o braku podstaw wykluczenia.' : ''}${
    p.krok ? `<br>Pierwszy krok: ${esc(p.krok)}` : ''}${
    p.link_odrzuc ? `<br><a href="${esc(p.link_odrzuc)}" style="font-size:13px;color:#5b6577">Nie dla nas</a>` : ''}</li>`).join('')}</ul>
${zdanieReszty ? `<p>${esc(zdanieReszty)}</p>` : ''}
${terenZdanie ? `<p>${esc(terenZdanie)} <a href="${esc(teren.link)}"><b>Wybierz województwa</b></a></p>` : ''}
${raportZdanie ? `<p>${esc(raportZdanie)}</p>` : ''}
<p>Szczegóły i uzasadnienie znajdziesz w aplikacji PrzetargAI: <a href="${esc(linkAplikacji)}">${esc(linkAplikacji)}</a></p>
<p style="font-size:12px;color:#5b6577">Nie chcesz tych maili? <a href="${esc(linkWypisu)}">Wyłącz je</a>.</p>`;

  return { subject, text, html };
}
