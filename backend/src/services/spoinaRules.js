/**
 * Spoina — uprawnienia ról. Czyste funkcje, bez bazy i bez sieci.
 *
 * Aplikacja trzyma dane firmy jako dokumenty „kolekcja/id" i wysyła zmiany pól. To tutaj
 * zapada decyzja, co dana osoba może ZOBACZYĆ i co może ZMIENIĆ — telefon pracownika nie
 * dostaje stawek, marży ani badań kolegów, a zmiana wysłana z pominięciem aplikacji nie
 * podniesie nikomu roli ani nie zatwierdzi godzin.
 *
 * Role: office (biuro — wszystko), toolroom (narzędziownia — sprzęt i wydania),
 * foreman (brygadzista — swoje + ekipa, którą prowadzi), worker (pracownik — swoje).
 */

export const ROLES = ['office', 'toolroom', 'foreman', 'worker'];

/** Kolekcje obiektów (dokument to obiekt z polem `id` równym id z klucza). */
export const ENTITY_COLLECTIONS = [
  'workers', 'crews', 'sites', 'assignments', 'gear', 'handovers', 'hours', 'leaves', 'messages', 'faults',
  'incidents', 'cards',
];
/** Kolekcje-zbiory: sam klucz jest informacją, wartością jest `true`. */
export const SET_COLLECTIONS = ['shortages', 'absent', 'attendanceOk', 'reminded'];
const COLLECTIONS = new Set([...ENTITY_COLLECTIONS, ...SET_COLLECTIONS, 'meta']);

const KEY = /^([A-Za-z]+)\/([^\u0000-\u001f/]{1,160})$/;

/** Rozbija klucz na kolekcję i id; `null`, gdy klucz jest niepoprawny. */
export function splitKey(key) {
  const m = KEY.exec(String(key));
  if (!m || !COLLECTIONS.has(m[1])) return null;
  return { col: m[1], id: m[2] };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Pola najwyższego poziomu, którymi `next` różni się od `cur`. */
function changedFields(cur, next) {
  const out = new Set();
  for (const k of new Set([...Object.keys(cur), ...Object.keys(next)])) {
    if (!same(cur[k], next[k])) out.add(k);
  }
  return out;
}

const only = (changed, allowed) => [...changed].every((f) => allowed.includes(f));

/**
 * Kontekst osoby wykonującej żądanie: kim jest, kogo prowadzi i które budowy jej dotyczą.
 * `state` udostępnia `get(key)` i `list(kolekcja)` → tablica par [id, dokument].
 */
export function buildContext(state, member) {
  const me = member.workerId;
  const role = member.role;
  const ctx = {
    me, role, state,
    office: role === 'office',
    toolroom: role === 'toolroom',
    foreman: role === 'foreman',
    field: role === 'foreman' || role === 'worker',
    team: new Set(), ledSites: new Set(), ledCrews: new Set(), mySites: new Set(),
    myCrew: state.get(`workers/${me}`)?.crewId ?? null,
  };
  if (!ctx.field) return ctx;

  for (const [id, s] of state.list('sites')) {
    if (s?.leadId === me) { ctx.ledSites.add(id); ctx.mySites.add(id); }
  }
  for (const [, a] of state.list('assignments')) {
    if (a?.workerId === me) ctx.mySites.add(a.siteId);
  }
  if (ctx.foreman) {
    for (const [id, c] of state.list('crews')) if (c?.leaderId === me) ctx.ledCrews.add(id);
    for (const [, a] of state.list('assignments')) if (ctx.ledSites.has(a?.siteId)) ctx.team.add(a.workerId);
    for (const [id, w] of state.list('workers')) if (w?.crewId && ctx.ledCrews.has(w.crewId)) ctx.team.add(id);
    ctx.team.delete(me);
  }
  return ctx;
}

// ── Odczyt ───────────────────────────────────────────────────────────────────

/** Kolega z pracy: tylko to, co jest potrzebne, żeby go rozpoznać i do niego zadzwonić. */
function colleague(w) {
  return {
    id: w.id, name: w.name, phone: w.phone, job: w.job, role: w.role, crewId: w.crewId ?? null,
    certs: [], docs: [], leaveDaysLeft: 0, ice: '', clothing: '',
    lang: w.lang ?? 'pl', invited: w.invited ?? false, pushOn: true,
  };
}

const MONEY = ['rate', 'laborCost', 'dietPerDay', 'lodgingPerDay', 'transportCost', 'otherCost'];

/** Budowa bez pieniędzy — stawki i koszty widzi tylko biuro. */
function siteNoMoney(s) {
  const out = { ...s };
  for (const f of MONEY) out[f] = 0;
  return out;
}

function settingsPublic(s) {
  const { marginTarget: _marza, ...rest } = s;
  return rest;
}

/**
 * Dokument w postaci, którą ta osoba może zobaczyć, albo `undefined`, gdy nie może go widzieć.
 * Zwraca TEN SAM obiekt, gdy nic nie zostało ukryte (wywołujący może wtedy użyć gotowego JSON-a).
 */
export function visible(ctx, key, doc) {
  if (doc === undefined || doc === null) return undefined;
  if (ctx.office) return doc;
  const parts = splitKey(key);
  if (!parts) return undefined;
  const { col, id } = parts;
  const { me } = ctx;

  if (col === 'workers') return id === me ? doc : colleague(doc);
  if (col === 'crews') return doc;
  if (col === 'messages') return doc.workerId === me ? doc : undefined;
  // Wypadek albo zagrożenie widzi zgłaszający, jego brygadzista i biuro.
  if (col === 'incidents') return doc.workerId === me || ctx.team.has(doc.workerId) ? doc : undefined;
  // Zdjęcie karty z budowy: kto je zrobił, jego brygadzista i biuro.
  if (col === 'cards') return doc.workerId === me || ctx.team.has(doc.workerId) ? doc : undefined;
  if (col === 'meta') return id === 'settings' ? settingsPublic(doc) : undefined;

  if (ctx.toolroom) {
    switch (col) {
      case 'sites': return siteNoMoney(doc);
      case 'assignments': case 'gear': case 'handovers': case 'faults': case 'shortages': return doc;
      case 'hours': case 'leaves': return doc.workerId === me ? doc : undefined;
      default: return undefined;
    }
  }

  const mine = (wid) => wid === me || ctx.team.has(wid);
  switch (col) {
    case 'sites': return ctx.mySites.has(id) ? siteNoMoney(doc) : undefined;
    case 'assignments': return ctx.mySites.has(doc.siteId) ? doc : undefined;
    case 'gear':
      return mine(doc.holderId) || (doc.reservedSiteId && ctx.ledSites.has(doc.reservedSiteId)) ? doc : undefined;
    case 'handovers': return doc.workerId === me ? doc : undefined;
    case 'hours': case 'faults': return mine(doc.workerId) ? doc : undefined;
    case 'leaves':
      return doc.workerId === me || (ctx.team.has(doc.workerId) && doc.status === 'approved') ? doc : undefined;
    case 'absent': return mine(id.split('|')[1]) ? doc : undefined;
    case 'attendanceOk': return ctx.foreman && crewOf(ctx, id) ? doc : undefined;
    default: return undefined;
  }
}

/** Czy klucz obecności „data|ekipa" dotyczy ekipy tego brygadzisty. */
function crewOf(ctx, id) {
  const crewId = id.split('|')[1];
  return Boolean(crewId) && (ctx.ledCrews.has(crewId) || ctx.myCrew === crewId);
}

// ── Zapis ────────────────────────────────────────────────────────────────────

const ok = (next) => ({ next });
const no = (reason) => ({ reject: reason });

/** Poprawność kształtu dokumentu — niezależnie od roli. */
function shapeError(col, id, next) {
  if (next === null) return null;
  if (SET_COLLECTIONS.includes(col)) return next === true ? null : 'zbiór przyjmuje tylko wartość true';
  if (col === 'meta') {
    if (id === 'settings') return isObj(next) ? null : 'ustawienia muszą być obiektem';
    if (id === 'lastDigest') return typeof next === 'string' ? null : 'lastDigest musi być napisem';
    return 'nieznany dokument meta';
  }
  if (!isObj(next)) return 'dokument musi być obiektem';
  if (next.id !== id) return 'pole id musi być zgodne z kluczem';
  if (col === 'workers') {
    if (typeof next.name !== 'string' || !next.name.trim()) return 'pracownik musi mieć imię i nazwisko';
    if (!ROLES.includes(next.role)) return 'nieznana rola';
    if (typeof next.phone !== 'string') return 'telefon musi być napisem';
  }
  return null;
}

const HOURS_OPEN = ['open', 'draft', 'sent'];

/**
 * Decyzja o jednej zmianie.
 * @param {object} ctx     kontekst z buildContext
 * @param {string} key     'kolekcja/id'
 * @param {*} cur          obecny dokument (undefined = nie istnieje)
 * @param {null|{v:*}|{p:object}} change  null = usuń, {v} = zapisz całość, {p} = zmień pola
 * @returns {{next:*}|{reject:string}}  `next === null` oznacza usunięcie
 */
export function decide(ctx, key, cur, change) {
  const parts = splitKey(key);
  if (!parts) return no('niepoprawny klucz');
  const { col, id } = parts;
  const exists = cur !== undefined && cur !== null;

  let next;
  if (change === null) next = null;
  else if (isObj(change) && 'v' in change) next = change.v;
  else if (isObj(change) && isObj(change.p)) next = isObj(cur) ? { ...cur, ...change.p } : { ...change.p };
  else return no('niepoprawna zmiana');
  if (next === undefined) return no('niepoprawna zmiana');

  if (next === null && !exists) return ok(null); // usunięcie czegoś, czego nie ma — nic do zrobienia
  const bad = shapeError(col, id, next);
  if (bad) return no(bad);

  const creating = !exists && next !== null;
  const deleting = exists && next === null;
  const patching = exists && next !== null;
  const changed = patching && isObj(cur) && isObj(next) ? changedFields(cur, next) : new Set();
  if (patching && isObj(cur) && changed.size === 0) return ok(cur);

  const { me, state } = ctx;

  // Biuro może wszystko — poza odebraniem firmie ostatniej osoby z dostępem do biura.
  if (ctx.office) {
    if (col === 'workers' && exists && cur.role === 'office' && (deleting || next.role !== 'office')) {
      const offices = state.list('workers').filter(([, w]) => w?.role === 'office').length;
      if (offices <= 1) return no('firma musi mieć przynajmniej jedną osobę w biurze');
    }
    return ok(next);
  }

  // ── Wspólne dla każdej osoby: własny profil, własne wiadomości, własne wnioski o wolne.
  if (col === 'workers') {
    if (patching && id === me && only(changed, ['lang', 'invited', 'ice', 'clothing', 'pushOn'])
      && (!changed.has('invited') || next.invited === false)) return ok(next);
    return no('dane pracowników zmienia biuro');
  }
  if (col === 'messages') {
    if (patching && cur.workerId === me && only(changed, ['read']) && next.read === true) return ok(next);
    if (creating && ctx.toolroom) return ok(next);
    return no('nie można zmienić tej wiadomości');
  }
  if (col === 'incidents') {
    // Każdy może zgłosić wypadek albo zagrożenie i cofnąć własną pomyłkę; przyjmuje je biuro.
    if (creating && next.workerId === me && next.handled === false) return ok(next);
    if (deleting && cur.workerId === me && !cur.handled) return ok(null);
    return no('zgłoszenia przyjmuje biuro');
  }
  if (col === 'cards') {
    // Kartę z budowy dodaje osoba z terenu do SWOJEJ budowy; usunąć może własną.
    if (creating && ctx.field && next.workerId === me && ctx.mySites.has(next.siteId)
      && typeof next.fileId === 'string') return ok(next);
    if (deleting && cur.workerId === me) return ok(null);
    return no('kartę z budowy dodaje brygadzista albo pracownik tej budowy');
  }
  if (col === 'leaves') {
    if (creating && next.workerId === me && next.status === 'pending') return ok(next);
    if (deleting && cur.workerId === me && cur.status === 'pending') return ok(null);
    return no('o wolnym decyduje biuro');
  }

  if (ctx.toolroom) {
    if (col === 'gear' || col === 'handovers' || col === 'shortages') return ok(next);
    if (col === 'faults' && (deleting || (patching && only(changed, ['resolved'])))) return ok(next);
    if (col === 'sites' && patching && only(changed, ['toolroomDone'])) return ok(next);
    return no('narzędziownia zmienia tylko sprzęt i wydania');
  }

  // ── Pracownik i brygadzista.
  const mine = (wid) => wid === me || ctx.team.has(wid);
  switch (col) {
    case 'hours':
      if (creating && mine(next.workerId) && HOURS_OPEN.includes(next.status) && next.cardHours == null) return ok(next);
      if (patching && mine(cur.workerId) && cur.status !== 'approved' && HOURS_OPEN.includes(next.status)
        && only(changed, ['siteId', 'startMin', 'endMin', 'status', 'byForeman'])) return ok(next);
      if (deleting && mine(cur.workerId) && cur.status === 'open') return ok(null);
      return no('zatwierdzonych godzin i cudzych wpisów nie można zmieniać');
    case 'assignments':
      if (patching && cur.workerId === me && only(changed, ['status'])
        && ['proposed', 'accepted', 'declined'].includes(next.status)) return ok(next);
      return no('skład ekipy ustala biuro');
    case 'gear': {
      const states = ['ok', 'fault'];
      if (patching && cur.holderId === me && only(changed, ['state', 'faultNote', 'inTransit'])
        && (!changed.has('state') || (states.includes(cur.state) && states.includes(next.state)))
        && (!changed.has('inTransit') || next.inTransit === false)) return ok(next);
      return no('sprzętem zarządza narzędziownia');
    }
    case 'handovers':
      if (patching && cur.workerId === me && only(changed, ['confirmed']) && next.confirmed === true) return ok(next);
      return no('wydania zapisuje narzędziownia');
    case 'faults':
      if (creating && next.workerId === me && next.resolved === false
        && state.get(`gear/${next.gearId}`)?.holderId === me) return ok(next);
      if (deleting && cur.workerId === me && !cur.resolved) return ok(null);
      return no('zgłoszenie można dodać tylko do sprzętu, który masz u siebie');
    case 'absent': {
      const wid = id.split('|')[1];
      if (ctx.team.has(wid)) return ok(next);
      if (wid === me && deleting) return ok(null); // rozpoczęcie pracy zdejmuje „nieobecny"
      return no('obecność zaznacza brygadzista');
    }
    case 'attendanceOk':
      if (ctx.foreman && crewOf(ctx, id)) return ok(next);
      return no('obecność potwierdza brygadzista');
    default:
      return no('brak uprawnień do tej zmiany');
  }
}
