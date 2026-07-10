/**
 * Kody CPV z BZP przychodzą jako jeden sklejony string, np.
 *   "39100000-3 (Meble),39150000-8 (Różne meble i wyposażenie)"
 * Rozdzielamy je do osobnych linii, ale TYLKO po przecinkach spoza nawiasów —
 * nazwy kodów same zawierają przecinki („Meble, wyposażenie i sprzęt”).
 *
 * @param {string|null|undefined} surowe
 * @returns {{ etykieta: string, wartosc: string }}
 */
export function opisCpv(surowe) {
  const kody = rozdziel(String(surowe ?? ''));

  if (kody.length === 0) return { etykieta: 'Kod CPV', wartosc: 'brak danych' };

  return {
    etykieta: kody.length > 1 ? 'Kody CPV' : 'Kod CPV',
    wartosc: kody.join('\n'),
  };
}

function rozdziel(tekst) {
  const kody = [];
  let biezacy = '';
  let zagniezdzenie = 0;

  for (const znak of tekst) {
    if (znak === '(') zagniezdzenie += 1;
    else if (znak === ')') zagniezdzenie = Math.max(0, zagniezdzenie - 1);

    if (znak === ',' && zagniezdzenie === 0) {
      kody.push(biezacy);
      biezacy = '';
    } else {
      biezacy += znak;
    }
  }
  kody.push(biezacy);

  return kody.map((k) => k.trim()).filter(Boolean);
}
