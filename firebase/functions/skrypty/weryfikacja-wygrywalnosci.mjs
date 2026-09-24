/*
 * Weryfikacja etapu 6 (wygrywalnosc) na PRODUKCJI.
 *
 * Uzycie (z katalogu firebase/functions):
 *   ADMIN_KEY=<klucz> node skrypty/weryfikacja-wygrywalnosci.mjs [okno|benchmark|health|karta] [dniBzp] [dniTed]
 *   (bez argumentu: wszystko po kolei)
 *
 * Klucz administratora: `firebase functions:secrets:access ADMIN_API_KEY --project przetargai`.
 *
 * 🚨 Konto sondujace zakladane jest BEZ slow kluczowych i BEZ kodow CPV — dzieki
 * temu nie pada ani jedno wywolanie platnego AI — i jest USUWANE w bloku finally.
 * DELETE /auth/me WYMAGA hasla w ciele zadania; puste `{}` daje 400 i zostawia
 * konto sierote (zdarzylo sie przy pierwszym przebiegu 2026-09-24).
 *
 * Pomiar 2026-09-24 (po domknieciu okna 14 dob):
 *   okno:      doby_niedomkniete 0, bzp 2948 ogloszen / 5250 czesci, ted 401 / 1550,
 *              zmian umow 10
 *   benchmark: 5805 rozstrzygniec, 3488 kubelkow policzonych, 932 utrwalone,
 *              2556 bez wniosku (nieutrwalone — patrz D-070)
 *   karta:     trafia w kubelek zamawiajacego przy probce 16 czesci, a przy mniejszej
 *              schodzi do dzialu CPV w wojewodztwie
 */
/*
 * Weryfikacja etapu 6 na PRODUKCJI. Read-only poza:
 *  - wyzwalaczami operatora (/admin/okno-wynikow, /admin/benchmark) — bez płatnego AI,
 *  - kontem sondującym BEZ słów kluczowych i BEZ CPV (zero wywołań modelu), usuwanym na końcu.
 */
const BAZA = 'https://europe-central2-przetargai.cloudfunctions.net/api';
const ADMIN = process.env.ADMIN_KEY;
if (!ADMIN) { console.error('brak ADMIN_KEY'); process.exit(1); }

const j = (r) => r.json().catch(() => null);

async function admin(sciezka, body = {}) {
  const t0 = Date.now();
  const r = await fetch(`${BAZA}${sciezka}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN },
    body: JSON.stringify(body),
  });
  return { status: r.status, ms: Date.now() - t0, cialo: await j(r) };
}

const krok = process.argv[2] ?? 'wszystko';

if (krok === 'okno' || krok === 'wszystko') {
  const dniBzp = Number(process.argv[3] ?? 3);
  const dniTed = Number(process.argv[4] ?? 3);
  const w = await admin('/admin/okno-wynikow', { dniBzp, dniTed });
  console.log('okno-wynikow:', w.status, `${(w.ms / 1000).toFixed(1)} s`);
  console.log(JSON.stringify(w.cialo, null, 1));
}

if (krok === 'benchmark' || krok === 'wszystko') {
  const b = await admin('/admin/benchmark');
  console.log('benchmark:', b.status, `${(b.ms / 1000).toFixed(1)} s`);
  console.log(JSON.stringify(b.cialo, null, 1));
}

if (krok === 'health' || krok === 'wszystko') {
  const h = await (await fetch(`${BAZA}/health`)).json();
  console.log('health wersja:', h.wersja, '| otwarte:', h.otwarte_przetargi);
  console.log('wyniki_okno:', JSON.stringify(h.wyniki_okno));
}

if (krok === 'karta' || krok === 'wszystko') {
  // Konto sondujące BEZ keywords i BEZ cpv_codes => zero wywołań płatnego AI.
  const email = `sonda-etap6-${Date.now()}@przetargai-test.pl`;
  const rej = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'tajnehaslo123456' }),
  });
  const { token } = await j(rej);
  if (!token) { console.error('rejestracja nieudana', rej.status); process.exit(1); }
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  try {
    const katalog = await (await fetch(`${BAZA}/tenders?limit=5`, { headers: auth })).json();
    console.log('katalog count:', katalog.count);

    for (const t of (katalog.tenders ?? []).slice(0, 3)) {
      const odp = await (await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}`, { headers: auth })).json();
      const k = odp.karta;
      console.log('---', t.id, '|', (t.title ?? '').slice(0, 55));
      if (odp.stan === 'rozstrzygniete') { console.log('   ROZSTRZYGNIETE, czesci:', odp.rozstrzygniecie.czesci.length); continue; }
      console.log('   werdykt:', k.werdykt, '| zrodlo:', k.zrodloBenchmarku, '| probka czesci:', k.probka?.czesci ?? null);
      for (const c of k.czynniki) console.log('    ', c.ton.padEnd(9), c.kod.padEnd(15), c.naglowek);
      const bench = await (await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}/benchmark`, { headers: auth })).json();
      console.log('   klucze:', JSON.stringify(bench.klucze));
      console.log('   kubelki:', Object.entries(bench.benchmark).map(([k2, v]) => `${k2}=${v ? (v.wystarczajacaProbka ? 'wniosek' : 'za mala probka') : 'brak'}`).join(' '));

      const ch = await (await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}/checklista`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({
          wymagania: [{ kod: 'krk', nazwa: 'KRK', obowiazkowe: true }, { kod: 'zus', nazwa: 'ZUS', obowiazkowe: true }],
          dokumenty: [{ typ_dokumentu: 'krk', nazwaTypu: 'KRK', dataWaznosci: new Date(Date.now() + 5 * 86400000).toISOString() }],
        }),
      })).json();
      console.log('   checklista: dzien zlozenia', String(ch.checklista.dzienZlozenia).slice(0, 10),
        '| masz', ch.checklista.koszyki.masz.length,
        '| przeterminuje', ch.checklista.koszyki.przeterminuje_sie.length,
        '| brakuje', ch.checklista.koszyki.brakuje.length,
        '| nastepny:', ch.checklista.nastepnyKrok?.nazwa ?? '-');
    }
  } finally {
    const usun = await fetch(`${BAZA}/auth/me`, { method: 'DELETE', headers: auth, body: JSON.stringify({ password: 'tajnehaslo123456' }) });
    const kontrola = await fetch(`${BAZA}/auth/me`, { headers: auth });
    console.log('sprzatanie: DELETE /auth/me ->', usun.status, '| kontrolnie GET /auth/me ->', kontrola.status);
  }
}
