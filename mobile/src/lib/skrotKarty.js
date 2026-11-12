/**
 * „Firma w skrócie” (2026-11-12, runda 7; ekran Firma z projektu UI): cztery wiersze, z których selekcja
 * wybiera przetargi — co robisz, czego nie bierzesz, teren, kwoty. Każdy prowadzi do właściwego kroku
 * kreatora karty; brak wartości = wezwanie „Uzupełnij”. Czysta funkcja, bez sieci.
 */
import { nazwaWojewodztwa } from './wojewodztwa.js';

const tys = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v >= 1_000_000) return `${String(Math.round(v / 100_000) / 10).replace('.', ',')} mln zł`;
  if (v >= 1_000) return `${Math.round(v / 1_000)} tys. zł`;
  return `${Math.round(v)} zł`;
};

const lista = (pozycje, maks) => {
  const p = (Array.isArray(pozycje) ? pozycje : []).map((x) => String(x).trim()).filter(Boolean);
  if (!p.length) return null;
  return p.length > maks ? `${p.slice(0, maks).join(', ')} i ${p.length - maks} więcej` : p.join(', ');
};

/**
 * @param {object|null} karta odpowiedź `GET /pracownik/karta` (pole `karta`)
 * @returns {Array<{klucz: string, etykieta: {pl: string, en: string}, wartosc: string|null, krok: number}>}
 */
export function skrotKartyFirmy(karta) {
  const k = karta ?? {};
  const zakres = (typeof k.opis === 'string' && k.opis.trim())
    ? (k.opis.trim().length > 90 ? `${k.opis.trim().slice(0, 88).replace(/\s+\S*$/, '')}…` : k.opis.trim())
    : lista(k.keywords, 4);
  const regiony = (Array.isArray(k.regiony) ? k.regiony : []).map((r) => nazwaWojewodztwa(r) ?? String(r));
  const od = tys(k.wartosc_min);
  const doKwoty = tys(k.wartosc_max);
  const kwoty = od && doKwoty ? `${od} – ${doKwoty}` : doKwoty ? `do ${doKwoty}` : od ? `od ${od}` : null;
  return [
    { klucz: 'zakres', etykieta: { pl: 'Co robisz', en: 'What you do' }, wartosc: zakres, krok: 1 },
    { klucz: 'wykluczenia', etykieta: { pl: 'Czego nie bierzesz', en: 'What you skip' }, wartosc: lista(k.wykluczenia, 4), krok: 2 },
    { klucz: 'teren', etykieta: { pl: 'Teren', en: 'Area' }, wartosc: regiony.length >= 16 ? 'cała Polska' : lista(regiony, 3), krok: 3 },
    { klucz: 'skala', etykieta: { pl: 'Kwoty zamówień', en: 'Contract sizes' }, wartosc: kwoty, krok: 4 },
  ];
}

/** Ile z czterech wierszy jest wypełnionych — do paska „karta w 75%”. */
export const wypelnienieKarty = (wiersze) => wiersze.filter((w) => w.wartosc).length;
