/**
 * Prezentacja statystyk rozstrzygniętych postępowań (R17).
 * „Za taką robotę w Twoim regionie płacono X–Y, startowało ~N firm, w Z% wygrywał mały".
 * Brak metryk → null (nie pokazujemy pustej sekcji).
 */

function zl(n) {
  return `${Math.round(n).toLocaleString('pl-PL')} zł`;
}

export function opisWyniki(stat) {
  if (!stat) return null;

  const cena = stat.cena && Number.isFinite(stat.cena.mediana)
    ? `Mediana ceny zwycięzcy: ${zl(stat.cena.mediana)} (od ${zl(stat.cena.min)} do ${zl(stat.cena.max)})`
    : null;

  const konkurencja = stat.oferty && Number.isFinite(stat.oferty.mediana)
    ? `Zwykle około ${stat.oferty.mediana} ofert w takim postępowaniu`
    : null;

  const maly = stat.maly && Number.isFinite(stat.maly.procent)
    ? `W ${stat.maly.procent}% wygrywała mała firma`
    : null;

  if (!cena && !konkurencja && !maly) return null;

  return {
    cena,
    konkurencja,
    maly,
    podpis: `Na podstawie ${stat.probka} rozstrzygniętych postępowań w Twojej branży i regionie.`,
  };
}
