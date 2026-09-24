import { matchKeywords } from './textNorm.js';
import { bestPair } from './cpv.js';
import { kodWojewodztwa, WOJEWODZTWA } from './wojewodztwa.js';

/*
 * „Dlaczego widzę ten przetarg" (P1-4) — czysta funkcja, zero AI, zero bazy.
 *
 * Karta dopasowania niosła dotąd jedno zdanie z `match_reasoning`: albo tekst
 * z płatnego AI, albo ogólnik „Trafione słowa kluczowe: …". Użytkownik nie miał
 * jak sprawdzić, KTÓRY sygnał zadziałał ani co zmienić w profilu, żeby feed
 * wyglądał inaczej — a to jest jedyna dźwignia, jaką ma nad wynikami.
 *
 * Liczymy więc dokładnie to, co już policzył scoring (CPV, słowa) i dokładamy
 * dwa fakty, które decydują o starcie, a nie wchodzą do wyniku: region i skala
 * zamówienia. Te dwa są oznaczone jako `informacja`, a nie jako ocena — udawanie,
 * że wpłynęły na wynik, byłoby kłamstwem o działaniu silnika.
 */

/** Powyżej tej zgodności kodów CPV mówimy „mocny", niżej „częściowy". */
const CPV_MOCNY = 0.6;

function sygnal(typ, sila, etykieta, szczegol, { wartosci = [], podpowiedz = null } = {}) {
  return { typ, sila, etykieta, szczegol, wartosci, podpowiedz };
}

function sygnalCpv(profil, tender) {
  const etykieta = { pl: 'Kody CPV', en: 'CPV codes' };
  const moje = profil?.cpv_codes ?? [];

  if (!moje.length) {
    return sygnal('cpv', 'brak', etykieta, {
      pl: 'Twój profil nie ma żadnego kodu CPV, więc ten sygnał w ogóle nie brał udziału w ocenie.',
      en: 'Your profile has no CPV code, so this signal played no part in the score.',
    }, {
      podpowiedz: {
        pl: 'Dodaj kody CPV swojej branży — to najmocniejszy pojedynczy sygnał dopasowania.',
        en: 'Add the CPV codes of your trade — it is the strongest single matching signal.',
      },
    });
  }

  const para = bestPair(moje, tender?.cpv_main);
  if (!para.affinity) {
    return sygnal('cpv', 'brak', etykieta, {
      pl: 'Żaden z Twoich kodów CPV nie pokrywa się z kodami tego ogłoszenia.',
      en: 'None of your CPV codes overlaps the codes in this notice.',
    });
  }

  const wartosci = [para.companyCode, para.tenderCode];
  if (para.affinity === 1) {
    return sygnal('cpv', 'mocny', etykieta, {
      pl: `Ogłoszenie ma dokładnie ten sam kod CPV co Twój profil: ${para.tenderCode}.`,
      en: `The notice carries exactly the same CPV code as your profile: ${para.tenderCode}.`,
    }, { wartosci });
  }

  const mocny = para.affinity >= CPV_MOCNY;
  return sygnal('cpv', mocny ? 'mocny' : 'czesciowy', etykieta, {
    pl: mocny
      ? `Twój kod ${para.companyCode} obejmuje kod ogłoszenia ${para.tenderCode}.`
      : `Zgodność na poziomie działu CPV: Twój ${para.companyCode} wobec ${para.tenderCode} w ogłoszeniu.`,
    en: mocny
      ? `Your code ${para.companyCode} covers the notice code ${para.tenderCode}.`
      : `Match at CPV division level: your ${para.companyCode} against ${para.tenderCode} in the notice.`,
  }, { wartosci });
}

function sygnalSlow(profil, tender) {
  const etykieta = { pl: 'Słowa z profilu', en: 'Profile keywords' };
  const slowa = profil?.keywords ?? [];

  if (!slowa.length) {
    return sygnal('slowa', 'brak', etykieta, {
      pl: 'Twój profil nie ma słów kluczowych, więc tytuł ogłoszenia nie był z czym porównany.',
      en: 'Your profile has no keywords, so there was nothing to compare the notice title against.',
    }, {
      podpowiedz: {
        pl: 'Dopisz słowa, którymi opisujesz swoje roboty — porównujemy rdzenie, więc odmiany też trafiają.',
        en: 'Add the words you use for your work — we compare word stems, so inflected forms match too.',
      },
    });
  }

  const trafione = matchKeywords(slowa, tender?.title ?? '');
  if (!trafione.length) {
    return sygnal('slowa', 'brak', etykieta, {
      pl: 'Żadne z Twoich słów kluczowych nie pada w tytule tego ogłoszenia.',
      en: 'None of your keywords appears in this notice title.',
    });
  }

  return sygnal('slowa', trafione.length >= 2 ? 'mocny' : 'czesciowy', etykieta, {
    pl: `Tytuł ogłoszenia trafia w ${trafione.length === 1 ? 'słowo' : 'słowa'} z profilu: ${trafione.join(', ')}.`,
    en: `The notice title hits your profile ${trafione.length === 1 ? 'keyword' : 'keywords'}: ${trafione.join(', ')}.`,
  }, { wartosci: trafione });
}

function sygnalRegionu(profil, tender) {
  const etykieta = { pl: 'Region', en: 'Region' };
  const kod = kodWojewodztwa(tender?.wojewodztwo);
  const nazwa = kod ? WOJEWODZTWA[kod] : null;
  const moje = (profil?.regiony ?? []).map(kodWojewodztwa).filter(Boolean);

  if (!kod) {
    return sygnal('region', 'informacja', etykieta, {
      pl: 'Rejestr nie podaje województwa tego ogłoszenia.',
      en: 'The register does not state the region for this notice.',
    });
  }

  if (!moje.length) {
    return sygnal('region', 'informacja', etykieta, {
      pl: `Ogłoszenie z województwa ${nazwa}. Twój profil nie ma zapisanych województw, więc region nie zawęża feedu.`,
      en: `Notice from the ${nazwa} voivodeship. Your profile lists no regions, so region does not narrow the feed.`,
    }, {
      podpowiedz: {
        pl: 'Zaznacz województwa, w których realnie pracujesz — odsiejesz ogłoszenia z drugiego końca kraju.',
        en: 'Pick the voivodeships you actually work in — it filters out notices from the other end of the country.',
      },
    });
  }

  if (moje.includes(kod)) {
    return sygnal('region', 'mocny', etykieta, {
      pl: `Województwo ${nazwa} jest wśród wybranych w Twoim profilu.`,
      en: `The ${nazwa} voivodeship is among those selected in your profile.`,
    }, { wartosci: [kod] });
  }

  return sygnal('region', 'brak', etykieta, {
    pl: `Województwo ${nazwa} jest poza obszarem wybranym w Twoim profilu.`,
    en: `The ${nazwa} voivodeship lies outside the area selected in your profile.`,
  }, { wartosci: [kod] });
}

/** Kwota po polsku, bez groszy — te liczby są orientacyjne, nie księgowe. */
function zl(kwota) {
  return `${Math.round(kwota).toLocaleString('pl-PL')} zł`;
}

function sygnalWartosci(profil, tender) {
  const etykieta = { pl: 'Skala zamówienia', en: 'Contract size' };
  const budzet = typeof tender?.budget === 'number' ? tender.budget : null;
  const maks = typeof profil?.wartosc_max === 'number' ? profil.wartosc_max : null;

  if (budzet === null) {
    const wadium = typeof tender?.wadium_kwota === 'number' ? tender.wadium_kwota : null;
    return sygnal('wartosc', 'informacja', etykieta, {
      pl: wadium
        ? `Rejestr nie podaje wartości zamówienia. Wadium ${zl(wadium)} to jedyna wskazówka co do skali.`
        : 'Rejestr nie podaje wartości zamówienia — skalę poznasz dopiero z dokumentacji.',
      en: wadium
        ? `The register does not state the contract value. A bid bond of ${zl(wadium)} is the only hint of scale.`
        : 'The register does not state the contract value — scale becomes clear only from the documents.',
    });
  }

  if (maks === null) {
    return sygnal('wartosc', 'informacja', etykieta, {
      pl: `Wartość zamówienia: ${zl(budzet)}. Twój profil nie ma zadeklarowanej największej obsługiwanej wartości.`,
      en: `Contract value: ${zl(budzet)}. Your profile declares no maximum contract size.`,
    }, {
      podpowiedz: {
        pl: 'Podaj największy kontrakt, jaki udźwigniesz — oznaczymy zamówienia ponad Twoją skalę.',
        en: 'State the largest contract you can handle — we will flag notices beyond your scale.',
      },
    });
  }

  if (budzet > maks) {
    return sygnal('wartosc', 'brak', etykieta, {
      pl: `Wartość ${zl(budzet)} jest powyżej zadeklarowanej skali Twojej firmy (${zl(maks)}) — rozważ konsorcjum.`,
      en: `The value of ${zl(budzet)} is above your declared capacity (${zl(maks)}) — consider a consortium.`,
    });
  }

  return sygnal('wartosc', 'mocny', etykieta, {
    pl: `Wartość ${zl(budzet)} mieści się w skali Twojej firmy (do ${zl(maks)}).`,
    en: `The value of ${zl(budzet)} fits your declared capacity (up to ${zl(maks)}).`,
  });
}

/**
 * Cztery sygnały + jedno zdanie podsumowania, w PL i EN.
 * @param {{keywords?: string[], cpv_codes?: string[], regiony?: string[], wartosc_max?: number}} profil
 * @param {{title?: string, cpv_main?: string, wojewodztwo?: string, budget?: number, wadium_kwota?: number}} tender
 */
export function wyjasnijDopasowanie(profil, tender) {
  const sygnaly = [
    sygnalCpv(profil, tender),
    sygnalSlow(profil, tender),
    sygnalRegionu(profil, tender),
    sygnalWartosci(profil, tender),
  ];

  const mocne = sygnaly.filter((s) => s.sila === 'mocny' || s.sila === 'czesciowy');
  const dopasowujace = mocne.filter((s) => s.typ === 'cpv' || s.typ === 'slowa');

  const podsumowanie = dopasowujace.length
    ? {
      pl: `Dopasowane przez: ${dopasowujace.map((s) => s.szczegol.pl).join(' ')}`,
      en: `Matched by: ${dopasowujace.map((s) => s.szczegol.en).join(' ')}`,
    }
    : {
      pl: 'Brak wyraźnego sygnału z profilu — to ogłoszenie trafiło tu na słabej poszlace. Uzupełnij profil, żeby feed był ostrzejszy.',
      en: 'No clear signal from your profile — this notice came in on a weak hint. Fill in your profile to sharpen the feed.',
    };

  return {
    // Zawsze heurystyka: ten moduł nie wywołuje AI i nie wolno mu zacząć.
    zrodlo: 'heurystyka',
    sygnaly,
    podsumowanie,
  };
}

/** Ile słów kluczowych uznajemy za profil „opisany", a nie „zaczęty". */
const MIN_SLOW = 3;

/**
 * Jeden konkretny następny krok, gdy feed jest pusty.
 *
 * „Brak dopasowanych przetargów — zajrzyj później" było ślepą uliczką: nie mówiło
 * ani dlaczego jest pusto, ani co zrobić. Kolejność kroków jest taka, jak siła
 * sygnału w silniku — najpierw to, co realnie odblokuje feed.
 *
 * @returns {{kod, tytul, opis, pole}|null} null = feed ma treść, nie ma po co zagadywać
 */
export function nastepnyKrokProfilu(profil, { liczbaDopasowan = 0 } = {}) {
  const slowa = profil?.keywords ?? [];
  const cpv = profil?.cpv_codes ?? [];
  const regiony = profil?.regiony ?? [];

  if (!slowa.length && !cpv.length) {
    return {
      kod: 'uzupelnij_profil',
      pole: 'keywords',
      tytul: { pl: 'Opisz, czym się zajmujesz', en: 'Describe what you do' },
      opis: {
        pl: 'Twój profil jest pusty, więc silnik nie ma czego szukać. Dopisz kilka słów, którymi opisujesz swoje roboty — feed ruszy przy najbliższym pobraniu.',
        en: 'Your profile is empty, so the engine has nothing to look for. Add a few words describing your work — the feed starts at the next fetch.',
      },
    };
  }

  if (!cpv.length) {
    return {
      kod: 'dodaj_cpv',
      pole: 'cpv_codes',
      tytul: { pl: 'Dodaj kody CPV swojej branży', en: 'Add your trade’s CPV codes' },
      opis: {
        pl: 'Profil opiera się dziś wyłącznie na słowach z tytułu. Kod CPV to twarda deklaracja przedmiotu zamówienia i sam w sobie tworzy dopasowanie.',
        en: 'Your profile relies on title keywords alone. A CPV code is a hard statement of subject matter and creates a match on its own.',
      },
    };
  }

  if (slowa.length < MIN_SLOW) {
    return {
      kod: 'dodaj_slowa',
      pole: 'keywords',
      tytul: { pl: 'Dopisz więcej słów kluczowych', en: 'Add more keywords' },
      opis: {
        pl: `Masz ${slowa.length} ${slowa.length === 1 ? 'słowo' : 'słowa'}. Dodanie kolejnych NIE obniża wyniku pozostałych — nietrafione słowa nic nie kosztują.`,
        en: `You have ${slowa.length} ${slowa.length === 1 ? 'keyword' : 'keywords'}. Adding more does NOT lower the score of the rest — unmatched words cost nothing.`,
      },
    };
  }

  if (!regiony.length) {
    return {
      kod: 'dodaj_regiony',
      pole: 'regiony',
      tytul: { pl: 'Zaznacz województwa, w których pracujesz', en: 'Pick the voivodeships you work in' },
      opis: {
        pl: 'Bez regionu feed miesza roboty spod Twojego biura z ogłoszeniami z drugiego końca kraju.',
        en: 'Without regions the feed mixes work near your office with notices from the other end of the country.',
      },
    };
  }

  if (liczbaDopasowan === 0) {
    return {
      kod: 'obejrzyj_wszystkie',
      pole: null,
      tytul: { pl: 'Zajrzyj do zakładki „Wszystkie"', en: 'Check the “All” tab' },
      opis: {
        pl: 'Profil jest kompletny, a mimo to nic nie pasuje — to normalne w spokojnym tygodniu. Zakładka „Wszystkie" pokazuje cały rynek bez filtra profilu.',
        en: 'Your profile is complete yet nothing matches — normal in a quiet week. The “All” tab shows the whole market with no profile filter.',
      },
    };
  }

  return null;
}
