/**
 * NUTS → TERYT. Osobny słownik, bo te dwa kodowania WYGLĄDAJĄ tak samo i się mylą.
 *
 * TED podaje region zamawiającego jako `buyer-country-sub` w kodzie NUTS
 * (`PL426`, `PL22A`, `PL911`), a BZP jako TERYT z prefiksem (`PL12`).
 * Wspólny normalizator `lib/wojewodztwa.js` bierze z ciągu same cyfry i dwie
 * ostatnie — dla `PL426` daje „26" (świętokrzyskie) zamiast zachodniopomorskiego
 * (32). Byłby to błąd CICHY: przetarg z Koszalina wpadłby do statystyki Kielc
 * i nikt by się nie dowiedział.
 *
 * Kolizji nie da się rozstrzygnąć po samym ciągu — `PL12` to poprawny TERYT
 * (małopolskie) i zarazem nieaktualny kod NUTS 2013 (mazowieckie). Dlatego
 * kodowanie wybiera WOŁAJĄCY: TED → `kodWojewodztwaZNuts`, BZP → `kodWojewodztwa`.
 *
 * Mapa NUTS 2021 (poziom 2), zweryfikowana wobec kodów widzianych na żywym TED.
 */
const NUTS2_NA_TERYT = {
  PL21: '12', // Małopolskie
  PL22: '24', // Śląskie
  PL41: '30', // Wielkopolskie
  PL42: '32', // Zachodniopomorskie
  PL43: '08', // Lubuskie
  PL51: '02', // Dolnośląskie
  PL52: '16', // Opolskie
  PL61: '04', // Kujawsko-pomorskie
  PL62: '28', // Warmińsko-mazurskie
  PL63: '22', // Pomorskie
  PL71: '10', // Łódzkie
  PL72: '26', // Świętokrzyskie
  PL81: '06', // Lubelskie
  PL82: '18', // Podkarpackie
  PL84: '20', // Podlaskie
  PL91: '14', // Warszawski stołeczny → mazowieckie
  PL92: '14', // Mazowiecki regionalny → mazowieckie
};

/**
 * Kod TERYT województwa z kodu NUTS dowolnego poziomu.
 *
 * Poziom 3 (`PL426`, `PL22A`) zawiera w pierwszych czterech znakach swój poziom 2,
 * więc obcięcie do czterech znaków obsługuje oba przypadki jednym podejściem.
 *
 * @param {string|null|undefined} nuts np. `PL426`, `PL22A`, `PL91`
 * @returns {string|null} dwucyfrowy TERYT albo null, gdy to nie polski NUTS
 */
export function kodWojewodztwaZNuts(nuts) {
  if (nuts === null || nuts === undefined) return null;
  const czysty = String(nuts).trim().toUpperCase();
  if (!/^PL/.test(czysty)) return null;
  return NUTS2_NA_TERYT[czysty.slice(0, 4)] ?? null;
}

/** Same kody NUTS2, do testów i diagnostyki. */
export const NUTS2_POLSKA = Object.keys(NUTS2_NA_TERYT);
