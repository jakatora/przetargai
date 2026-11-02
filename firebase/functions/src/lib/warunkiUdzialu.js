/*
 * Fragment „warunki udziału” z ogłoszenia (spec §6.1), zapisywany przy pobieraniu.
 * Treść ogłoszenia poza tym fragmentem nadal wyrzucamy (limit dokumentu Firestore).
 * Brak fragmentu ≠ brak warunków — wtedy aplikacja mówi „warunki w ogłoszeniu/SWZ”.
 */
export const MAKS_ZNAKOW_WARUNKOW = 3000;

// BZP (2026-11-02): pkt 5.4 bywa dłuższy (ze wstępem o wykluczeniu) — zdolność techniczna stoi na końcu, nie ucinamy jej.
export const MAKS_ZNAKOW_WARUNKOW_BZP = 5000;

function przytnij(tekst, maks = MAKS_ZNAKOW_WARUNKOW) {
  const t = String(tekst ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > maks ? `${t.slice(0, maks - 1)}…` : t;
}

const unikalne = (lista) => [...new Set(lista.map((s) => String(s).trim()).filter(Boolean))];

/** Baza Konkurencyjności: `orders[].order_items[].participation_conditions[].description`. */
export function warunkiZBk(orders) {
  const opisy = unikalne((Array.isArray(orders) ? orders : [])
    .flatMap((o) => (Array.isArray(o?.order_items) ? o.order_items : []))
    .flatMap((it) => (Array.isArray(it?.participation_conditions) ? it.participation_conditions : []))
    .map((c) => (typeof c?.description === 'string' ? c.description : '')));
  return opisy.length ? { tekst: przytnij(opisy.join('\n\n')), zrodlo: 'ogloszenie' } : null;
}

/** TED: BT-750 po polsku; gdy brak, a źródłem są dokumenty zamówienia — „w SWZ”. */
export function warunkiZTed(notice) {
  const opis = notice?.['selection-criterion-description-lot'];
  const surowe = opis && typeof opis === 'object' ? (opis.pol ?? Object.values(opis)[0] ?? []) : [];
  const teksty = unikalne((Array.isArray(surowe) ? surowe : [surowe]).filter((t) => typeof t === 'string'));
  if (teksty.length) return { tekst: przytnij(teksty.join('\n\n')), zrodlo: 'ogloszenie' };

  const zrodla = notice?.['selection-criteria-source'];
  if ((Array.isArray(zrodla) ? zrodla : [zrodla]).includes('epo-procurement-document')) return { tekst: null, zrodlo: 'swz' };
  return null;
}

/** htmlBody BZP → tekst z podziałem na linie (punkty „5.4.)” zaczynają się od nowej linii). */
function tekstBzp(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/**
 * BZP: sekcja V ogłoszenia o zamówieniu (zmierzone 2026-11-02 na 30 ogłoszeniach z 30.10): „5.3.) Warunki udziału
 * w postępowaniu: Tak|Nie”, przy „Tak” — „5.4.) Nazwa i opis warunków udziału w postępowaniu.” i opis do
 * następnego punktu (5.5.). „Nie” = zamawiający nie stawia warunków (`brak_warunkow` — porównanie z kartą bez AI).
 * Brak punktu 5.3 (inny rodzaj ogłoszenia) — null, jak dotąd.
 */
export function warunkiZBzp(htmlBody) {
  const t = tekstBzp(htmlBody);
  const flaga = t.match(/5\.3\.?\)?\s*Warunki udziału w postępowaniu:\s*(Tak|Nie)\b/i);
  if (!flaga) return null;
  if (/^nie$/i.test(flaga[1])) return { tekst: null, zrodlo: 'ogloszenie', brak_warunkow: true };
  const naglowek = /5\.4\.?\)?\s*Nazwa i opis warunków udziału w postępowaniu\.?/i;
  const od = t.search(naglowek);
  if (od < 0) return { tekst: null, zrodlo: 'swz' };
  const reszta = t.slice(od).replace(naglowek, '');
  const koniec = reszta.search(/\s5\.(?:[5-9]|1\d)\.?\)|SEKCJA VI\b/);
  const tekst = przytnij(koniec >= 0 ? reszta.slice(0, koniec) : reszta, MAKS_ZNAKOW_WARUNKOW_BZP);
  return tekst ? { tekst, zrodlo: 'ogloszenie' } : { tekst: null, zrodlo: 'swz' };
}
