import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { authRequired } from '../middleware/auth.js';
import { umowyMonitorowane } from '../db/repos.js';
import { ekstrahuj_i_normalizuj } from '../lib/umowaEkstrakcja.js';
import { zbuduj_flagi_umowy } from '../lib/umowaAnaliza.js';
import { generujWniosekWaloryzacyjny, wniosekDoPliku } from '../lib/waloryzacjaWniosek.js';

/*
 * Analiza projektu UMOWY przed podpisem (ulepszenie „pilnowanie waloryzacji
 * i pułapek w umowie"). Klient wysyła treść umowy jako surowy `tekst` ALBO
 * `pdf_base64` (plik PDF zakodowany w base64) — i dostaje listę flag: klauzula
 * waloryzacyjna, kary umowne i ich limit, zapisy o odbiorach i podwykonawcach.
 *
 * KONTRAKT ODPOWIEDZI (jednolity, podzadanie 7/12): { tekst, flagi } gdzie
 * `flagi` to lista `[{ typ, kolor, tytul, opis }]` — po jednej fladze na obszar
 * umowy (waloryzacja / kary / odbiory / podwykonawcy), w stałej kolejności,
 * `kolor` ∈ { zielony, pomarańczowy, czerwony }. Scaleniem detektorów w tę listę
 * zajmuje się `zbuduj_flagi_umowy` (lib/umowaAnaliza.js); `tekst` to znormalizowana
 * treść umowy (przydatna np. do podglądu tego, co wyjęto z PDF-a).
 */

const router = Router();

// `tekst`/`pdf_base64` opcjonalne w schemacie — regułę „co najmniej jedno niesie
// treść" egzekwujemy niżej (maTresc), żeby dać czytelny komunikat 400 zamiast
// surowego błędu walidacji struktury. `miesiace` (szacowany czas trwania umowy)
// jest opcjonalny i steruje flagą braku obowiązkowej klauzuli waloryzacyjnej.
const analizaSchema = z.object({
  tekst: z.string().optional(),
  pdf_base64: z.string().optional(),
  miesiace: z.number().optional(),
});

/** Czy żądanie w ogóle niesie treść umowy do analizy (tekst lub plik PDF). */
function maTresc(data) {
  return Boolean(data.tekst?.trim()) || Boolean(data.pdf_base64?.trim());
}

router.post('/analiza', ah(async (req, res) => {
  const parsed = analizaSchema.safeParse(req.body ?? {});
  if (!parsed.success || !maTresc(parsed.data)) {
    throw badRequest('Podaj treść umowy: pole "tekst" (umowa jako tekst) albo "pdf_base64" (plik PDF w base64).');
  }

  // Sprowadzamy wejście (surowy `tekst` albo `pdf_base64`) do jednego,
  // znormalizowanego łańcucha. Zeskanowany/uszkodzony PDF => pusty tekst
  // (nie błąd) — silnik reguł dostanie po prostu pustkę i zwróci flagi „brak
  // zapisów / do weryfikacji", zamiast się wywrócić.
  const tekst = await ekstrahuj_i_normalizuj(parsed.data);
  const flagi = zbuduj_flagi_umowy(tekst, parsed.data.miesiace);
  res.json({ tekst, flagi });
}));

/*
 * Wzięcie podpisanej umowy pod monitoring waloryzacji (podzadanie 10/12). Zapisujemy
 * dwa fakty z chwili podpisania: BRANŻĘ kontraktu (po niej dobierany jest właściwy
 * wskaźnik cen GUS) i WSKAŹNIK BAZOWY GUS (punkt odniesienia — kolejne podzadania
 * liczą wzrost cen jako stosunek późniejszego wskaźnika do tej bazy i alarmują po
 * przekroczeniu progu). Rekord należy do zalogowanego użytkownika, bo to jego
 * będziemy alarmować — stąd `authRequired`.
 *
 * Schemat jest luźny (typy), a semantykę (branża niepusta, wskaźnik dodatni, data
 * poprawna) egzekwujemy niżej z czytelnymi komunikatami — spójnie z trasą /analiza.
 */
const monitorujSchema = z.object({
  branza: z.string().max(120),
  wskaznik_bazowy: z.number(),
  wskaznik_okres: z.string().max(40).optional(),
  data_podpisania: z.string().optional(),
  // Próg waloryzacji z umowy (%) — opcjonalny. Zapisany, staje się progiem, z
  // którym cykliczny job porównuje późniejszy wzrost cen (podzadanie 11/12). Bez
  // niego umowa jest monitorowana, ale nie alarmuje (nie ma czego przekroczyć).
  prog: z.number().optional(),
});

router.post('/monitoruj', authRequired, ah(async (req, res) => {
  const parsed = monitorujSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj "branza" (branża kontraktu) i "wskaznik_bazowy" (liczba — wskaźnik GUS z chwili podpisania).');
  }

  const branza = parsed.data.branza.trim();
  if (!branza) throw badRequest('Pole "branza" nie może być puste.');
  // Wskaźnik cen jest zawsze dodatni (baza porównania); 0/ujemny nie ma sensu.
  if (!(parsed.data.wskaznik_bazowy > 0)) throw badRequest('"wskaznik_bazowy" musi być liczbą dodatnią.');

  // Próg waloryzacji (jeśli podany) to procent w zakresie (0, 100] — spójnie z
  // tym, jak czyta go detektor klauzuli (lib/umowaWaloryzacja.js). Poza zakresem
  // => 400, żeby nie zapisać progu, którego alarm i tak nigdy sensownie nie użyje.
  let prog = null;
  if (parsed.data.prog !== undefined) {
    prog = parsed.data.prog;
    if (!(Number.isFinite(prog) && prog > 0 && prog <= 100)) {
      throw badRequest('"prog" musi być liczbą z zakresu (0, 100] — procentem progu waloryzacji z umowy.');
    }
  }

  // Data podpisania opcjonalna — domyślnie stemplujemy chwilę zapisu. Podaną
  // normalizujemy do ISO 8601, żeby porównania czasu nie zależały od formatu wejścia.
  let dataPodpisania = null;
  if (parsed.data.data_podpisania !== undefined) {
    const d = new Date(parsed.data.data_podpisania);
    if (Number.isNaN(d.getTime())) throw badRequest('"data_podpisania" musi być poprawną datą (ISO 8601).');
    dataPodpisania = d.toISOString();
  }

  const umowa = umowyMonitorowane.create({
    userId: req.user.id,
    branza,
    wskaznikBazowy: parsed.data.wskaznik_bazowy,
    wskaznikOkres: parsed.data.wskaznik_okres?.trim() || null,
    dataPodpisania,
    prog,
  });
  res.status(201).json({ umowa });
}));

/** Umowy wzięte pod monitoring przez zalogowanego użytkownika (najnowsze pierwsze). */
router.get('/monitoruj', authRequired, ah(async (req, res) => {
  res.json({ umowy: umowyMonitorowane.listForUser(req.user.id) });
}));

/*
 * Generator WNIOSKU O WALORYZACJĘ (podzadanie 12/12 — domknięcie ulepszenia).
 * Z różnicy wskaźników GUS liczy kwotę waloryzacji, dobiera podstawę prawną
 * (klauzula z umowy — art. 439 Pzp, a gdy niewystarczająca — art. 455 Pzp) i
 * zwraca gotowe pismo. `?pobierz=1` EKSPORTUJE treść do pliku (.txt jako załącznik).
 *
 * Dane można podać wprost w body ALBO wskazać `umowa_id` monitorowanej umowy —
 * wtedy branża, wskaźnik bazowy i próg są zaciągane z rekordu (należącego do usera),
 * a body je uzupełnia/nadpisuje (m.in. wartość kontraktu i limit, których w rekordzie
 * nie ma). Kwotę liczy czysta funkcja `generujWniosekWaloryzacyjny` (lib) — tą samą
 * regułą wzrostu co alarm, więc pismo nie rozjedzie się z tym, co uruchomiło alert.
 */
const wniosekSchema = z.object({
  umowa_id: z.string().optional(),
  wartosc_kontraktu: z.number().optional(),
  wskaznik_bazowy: z.number().optional(),
  wskaznik_aktualny: z.number().optional(),
  prog: z.number().optional(),
  limit: z.number().optional(),
  klauzula_obecna: z.boolean().optional(),
  branza: z.string().max(120).optional(),
  numer_umowy: z.string().max(120).optional(),
  przedmiot: z.string().max(300).optional(),
  wykonawca: z.string().max(300).optional(),
  zamawiajacy: z.string().max(300).optional(),
  miejscowosc: z.string().max(120).optional(),
  data_pisma: z.string().max(40).optional(),
  okres_bazowy: z.string().max(40).optional(),
  okres_aktualny: z.string().max(40).optional(),
  waluta: z.string().max(10).optional(),
});

router.post('/wniosek', authRequired, ah(async (req, res) => {
  const parsed = wniosekSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Niepoprawne dane wniosku o waloryzację.');
  const d = parsed.data;

  // Uzupełnienie z monitorowanej umowy (jeśli wskazano). Odczyt skopowany do
  // właściciela — cudza/nieistniejąca umowa => 404 (bez wycieku danych).
  let rec = null;
  if (d.umowa_id) {
    rec = umowyMonitorowane.findByIdForUser(d.umowa_id, req.user.id);
    if (!rec) throw notFound('Nie znaleziono monitorowanej umowy o podanym id.');
  }

  const wskaznikBazowy = d.wskaznik_bazowy ?? rec?.wskaznik_bazowy;
  const wskaznikAktualny = d.wskaznik_aktualny ?? rec?.wskaznik_aktualny;
  const prog = d.prog ?? rec?.prog ?? null;
  const branza = d.branza ?? rec?.branza ?? null;
  const okresBazowy = d.okres_bazowy ?? rec?.wskaznik_okres ?? null;
  const okresAktualny = d.okres_aktualny ?? rec?.wskaznik_aktualny_okres ?? null;

  // Walidacja wejścia z czytelnym 400 (spójnie z /monitoruj) — zanim policzymy kwotę.
  if (!(Number.isFinite(d.wartosc_kontraktu) && d.wartosc_kontraktu > 0)) {
    throw badRequest('Podaj "wartosc_kontraktu" — wartość (netto) wynagrodzenia jako liczbę dodatnią.');
  }
  if (!(Number.isFinite(wskaznikBazowy) && wskaznikBazowy > 0)
    || !(Number.isFinite(wskaznikAktualny) && wskaznikAktualny > 0)) {
    throw badRequest('Podaj "wskaznik_bazowy" i "wskaznik_aktualny" (liczby dodatnie) — wprost albo przez "umowa_id".');
  }

  const wynik = generujWniosekWaloryzacyjny({
    wartoscKontraktu: d.wartosc_kontraktu,
    wskaznikBazowy,
    wskaznikAktualny,
    prog,
    limit: d.limit ?? null,
    klauzulaObecna: d.klauzula_obecna,
    branza,
    okresBazowy,
    okresAktualny,
    numerUmowy: d.numer_umowy ?? null,
    przedmiot: d.przedmiot ?? null,
    wykonawca: d.wykonawca ?? null,
    zamawiajacy: d.zamawiajacy ?? null,
    miejscowosc: d.miejscowosc ?? null,
    dataPisma: d.data_pisma ?? null,
    waluta: d.waluta ?? 'PLN',
  });

  // „Brak podstawy" (spadek cen, wzrost poniżej progu, brak danych) to nie błąd
  // wejścia, lecz orzeczenie merytoryczne — 422, żeby klient odróżnił je od 400.
  if (!wynik.mozliwy) throw new AppError(422, 'BRAK_PODSTAWY', wynik.powod);

  // Eksport do pliku: ?pobierz=1 => treść pisma jako załącznik .txt do pobrania.
  if (String(req.query.pobierz ?? '') === '1') {
    const plik = wniosekDoPliku(wynik);
    res.setHeader('Content-Type', plik.typ);
    res.setHeader('Content-Disposition', `attachment; filename="${plik.nazwa}"`);
    return res.send(plik.zawartosc);
  }

  return res.json({
    wniosek: {
      mozliwy: wynik.mozliwy,
      wzrost: wynik.wzrost,
      kwota: wynik.kwota,
      kwota_z_klauzuli: wynik.kwotaZKlauzuli,
      kwota_ponad_limit: wynik.kwotaPonadLimit,
      waluta: wynik.waluta,
      podstawa: wynik.podstawa,
      nazwa_pliku: wynik.nazwaPliku,
      tresc: wynik.tresc,
    },
  });
}));

export default router;
