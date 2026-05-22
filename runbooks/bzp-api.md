# Runbook — API BZP

## Kontekst

PrzetargAI pobiera ogłoszenia o przetargach z publicznego API Biuletynu
Zamówień Publicznych (e-Zamówienia). Czytanie ogłoszeń krajowych BZP **nie
wymaga uwierzytelniania** ani procedury integracyjnej.

Klient: `backend/src/services/bzp.js`. Job pobierający: `backend/src/jobs/fetchTenders.js`.

## Zweryfikowany kontrakt API (2026-05-20)

```
GET https://ezamowienia.gov.pl/mo-board/api/v1/notice
```

Parametry zapytania (wszystkie wymagane):

| Parametr | Wartość | Uwagi |
|----------|---------|-------|
| `NoticeType` | `ContractNotice` | typ ogłoszenia (`BZP_NOTICE_TYPE`) |
| `PublicationDateFrom` | `YYYY-MM-DD` | data publikacji od |
| `PublicationDateTo` | `YYYY-MM-DD` | data publikacji do |
| `PageSize` | liczba > 0 | rozmiar strony |
| `PageNumber` | liczba ≥ 1 | numeracja stron **od 1** |

Odpowiedź: tablica JSON ogłoszeń. Kluczowe pola mapowane w `normalizeNotice()`:
`bzpNumber`/`noticeNumber` → identyfikator, `orderObject` → tytuł,
`organizationName` → zamawiający, `cpvCode` → CPV,
`submittingOffersDate` → termin, `publicationDate` → data publikacji,
`tenderId` → URL ogłoszenia. Pole `htmlBody` (duże) jest usuwane przed zapisem.

Konfiguracja w `.env`: `BZP_API_BASE_URL`, `BZP_SEARCH_PATH`, `BZP_NOTICE_TYPE`,
`BZP_LOOKBACK_DAYS` — zmiana ścieżki/typu nie wymaga zmiany kodu.

## Diagnostyka

- Test łączności: `node src/services/bzp.js --ping` (pobiera 3 ogłoszenia).
- Pełny cykl (pobranie + matching): `npm run fetch-tenders`.
- Ręcznie przez API: `POST /admin/fetch-tenders` z nagłówkiem `x-admin-key`.
- Logi: konsola (`npm run dev`) oraz `backend/logs/`.

## Eskalacja

Zmiana kontraktu lub trwała niedostępność API BZP = scenariusz eskalacji #1.
Klient `bzp.js` ma defensywne mapowanie pól (wiele wariantów nazw), więc drobne
zmiany przejdą bezszwowo. Przy większej zmianie: zaktualizować `normalizeNotice()`
i parametry w `searchNotices()`, zapisać `[BLOCKER: HUMAN]` w `blockers.md`,
kontynuować inne, niezależne etapy.
