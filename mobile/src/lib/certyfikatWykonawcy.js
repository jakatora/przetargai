/**
 * „CERTYFIKAT WYKONAWCY — jedna teczka zamiast stosu dokumentów" — czysta logika kalkulatora
 * opłacalności (testowalna `node:test`).
 *
 * KONTEKST: od 12 lipca 2026 działa ustawa o certyfikacji wykonawców zamówień publicznych
 * (dobrowolny, urzędowy certyfikat potwierdzający brak podstaw wykluczenia i spełnianie warunków
 * udziału), który zastępuje składanie tych samych dokumentów w każdym postępowaniu. Mało kto o
 * tym wie. Kalkulator liczy, czy certyfikat się użytkownikowi opłaca.
 *
 * NIE zaszywamy żadnej ceny certyfikatu (to nowość, stawki się ustalą) — użytkownik podaje ją
 * sam; liczymy tylko arytmetykę oszczędności czasu/kosztu. Deterministyczne, odporne na braki.
 */

function liczba(x) {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Analiza opłacalności certyfikatu (ujęcie roczne).
 * @param {{startowRocznie?:number, godzinNaStart?:number, stawkaGodzinowa?:number,
 *   kosztCertyfikatuRocznie?:number, godzinNaStartZCertyfikatem?:number}} we
 * @returns {Readonly<object>} { kosztObecny, kosztZCertyfikatem, oszczednosc, oplacaSie, ton,
 *   progStartow, godzinyObecnie, godzinyZCertyfikatem }
 */
export function analizaCertyfikatu(we = {}) {
  const starty = liczba(we.startowRocznie);
  const godzNaStart = liczba(we.godzinNaStart);
  const stawka = liczba(we.stawkaGodzinowa);
  const kosztCert = liczba(we.kosztCertyfikatuRocznie);
  // Z certyfikatem nadal trochę pracy przy ofercie (domyślnie 20% dawnego czasu na dokumenty).
  const godzZCert = we.godzinNaStartZCertyfikatem != null
    ? liczba(we.godzinNaStartZCertyfikatem)
    : Math.round(godzNaStart * 0.2 * 100) / 100;

  const godzinyObecnie = starty * godzNaStart;
  const godzinyZCertyfikatem = starty * godzZCert;
  const kosztObecny = godzinyObecnie * stawka;
  const kosztZCertyfikatem = godzinyZCertyfikatem * stawka + kosztCert;
  const oszczednosc = kosztObecny - kosztZCertyfikatem;
  const oplacaSie = oszczednosc > 0;

  // Break-even: ile startów rocznie sprawia, że certyfikat się zwraca (oszczędność czasu na
  // start × stawka ≥ koszt certyfikatu).
  const oszczOszczNaStart = (godzNaStart - godzZCert) * stawka;
  const progStartow = oszczOszczNaStart > 0 ? Math.ceil(kosztCert / oszczOszczNaStart) : null;

  return Object.freeze({
    kosztObecny: Math.round(kosztObecny),
    kosztZCertyfikatem: Math.round(kosztZCertyfikatem),
    oszczednosc: Math.round(oszczednosc),
    oplacaSie,
    ton: oplacaSie ? 'sukces' : 'neutral',
    progStartow,
    godzinyObecnie: Math.round(godzinyObecnie * 10) / 10,
    godzinyZCertyfikatem: Math.round(godzinyZCertyfikatem * 10) / 10,
  });
}
