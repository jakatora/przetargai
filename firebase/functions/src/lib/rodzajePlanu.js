/**
 * Rodzaje ogłoszeń planowania eForms. `skracaTermin` — WOI, które pozwala
 * zamawiającemu SKRÓCIĆ termin składania ofert (dyrektywa 2014/24/UE art. 27 ust. 2:
 * w przetargu nieograniczonym nawet do 15 dni zamiast 35). Na samo ogłoszenie
 * trzeba być gotowym wcześniej, bo czasu będzie mniej niż zwykle.
 */
export const RODZAJE_PLANU = Object.freeze({
  'pin-rtl': {
    pl: 'Wstępne ogłoszenie informacyjne — zamawiający może skrócić termin składania ofert',
    en: 'Prior information notice — the buyer may shorten the tender deadline',
    skracaTermin: true,
  },
  'pin-only': {
    pl: 'Wstępne ogłoszenie informacyjne',
    en: 'Prior information notice',
    skracaTermin: false,
  },
  'pin-buyer': {
    pl: 'Wstępne ogłoszenie informacyjne na profilu nabywcy',
    en: 'Prior information notice on the buyer profile',
    skracaTermin: false,
  },
  'pin-tran': {
    pl: 'Zamiar zawarcia umowy o transport publiczny (rozp. 1370/2007)',
    en: 'Intended public transport service contract (Reg. 1370/2007)',
    skracaTermin: false,
  },
  'pin-cfc-standard': {
    pl: 'Wstępne ogłoszenie informacyjne jako zaproszenie do ubiegania się',
    en: 'Prior information notice as a call for competition',
    skracaTermin: false,
  },
  'pin-cfc-social': {
    pl: 'Wstępne ogłoszenie informacyjne (usługi społeczne) jako zaproszenie',
    en: 'Prior information notice (social services) as a call for competition',
    skracaTermin: false,
  },
});

export const RODZAJ_NIEZNANY = { pl: 'Ogłoszenie planowania', en: 'Planning notice', skracaTermin: false };
