import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/errors.js';
import { authRequired } from '../middleware/auth.js';
import { umowyMonitorowane } from '../db/repos.js';
import { ekstrahuj_i_normalizuj } from '../lib/umowaEkstrakcja.js';
import { zbuduj_flagi_umowy } from '../lib/umowaAnaliza.js';

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
  });
  res.status(201).json({ umowa });
}));

/** Umowy wzięte pod monitoring przez zalogowanego użytkownika (najnowsze pierwsze). */
router.get('/monitoruj', authRequired, ah(async (req, res) => {
  res.json({ umowy: umowyMonitorowane.listForUser(req.user.id) });
}));

export default router;
