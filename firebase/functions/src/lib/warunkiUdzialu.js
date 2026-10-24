/*
 * Fragment „warunki udziału” z ogłoszenia (spec §6.1), zapisywany przy pobieraniu.
 * Treść ogłoszenia poza tym fragmentem nadal wyrzucamy (limit dokumentu Firestore).
 * Brak fragmentu ≠ brak warunków — wtedy aplikacja mówi „warunki w ogłoszeniu/SWZ”.
 */
export const MAKS_ZNAKOW_WARUNKOW = 3000;

function przytnij(tekst) {
  const t = String(tekst ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > MAKS_ZNAKOW_WARUNKOW ? `${t.slice(0, MAKS_ZNAKOW_WARUNKOW - 1)}…` : t;
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

/**
 * BZP: sekcja warunków w htmlBody.
 *
 * Format niezmierzony (e-Zamówienia w przerwie technicznej od 2026-10-23 wieczorem,
 * HTTP 403 na całej platformie) — pułapka z pamięci projektu: formatu BZP się NIE zgaduje.
 * Do czasu pomiaru na żywo BZP nie niesie warunków, a aplikacja mówi „warunki w SWZ”.
 * Zadanie „zmierzyć BZP i włączyć warunkiZBzp” jest w STAN projektu.
 */
export function warunkiZBzp(_htmlBody) {
  return null;
}
