import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { AppError, badRequest } from '../lib/errors.js';
import { generujZobowiazanie, zobowiazanieDoPliku } from '../lib/zobowiazanieGenerator.js';

/*
 * EKSPORT dokumentu „zobowiązanie podmiotu udostępniającego zasoby" (art. 118 Pzp)
 * — podzadanie 8/12 ulepszenia „Pożycz doświadczenie: kreator polegania na zasobach
 * podmiotu trzeciego". Trasa SPINA generator (7/12, `generujZobowiazanie`) z eksportem
 * do pliku (`zobowiazanieDoPliku`) i wystawia je przez HTTP dokładnie tym samym
 * wzorcem, co eksport wniosku o waloryzację (/api/przetarg/umowa/wniosek?pobierz=1):
 *   • domyślnie JSON — podgląd pisma (`tresc`), lista braków i ostrzeżeń, nazwa pliku;
 *   • przy `?pobierz=1` — treść pisma jako załącznik .txt do pobrania/wydruku.
 *
 * Trasa NIE wymaga logowania i nie dotyka bazy — to czysta transformacja danych z
 * żądania w pismo (spójnie z /analiza). Model i meta przychodzą w całości w body:
 *   { zobowiazanie: <model 4/12>, meta: <kontekst postępowania> }.
 *
 * NIEZMIENNIK EKSPORTU (z generatora 7/12): dokument NIEKOMPLETNY (brak pola
 * wymaganego orzecznictwem — np. zakres podwykonawstwa) NIE jest gotowy do podpisu.
 * `?pobierz=1` na takim modelu daje 422 z listą braków, zamiast podać jak gotowe
 * pismo z pułapką fikcyjności udostępnienia w środku — to dokładnie ta pułapka,
 * którą cały kreator zwalcza. Sam podgląd (JSON) niekompletnego pisma jest dozwolony
 * (z widocznym markerem `[UZUPEŁNIJ: …]`), by kreator mógł pokazać, czego brakuje.
 */

const router = Router();

const danePodmiotuSchema = z.object({
  nazwa: z.string().max(300).optional(),
  identyfikator: z.string().max(120).optional(),
  adres: z.string().max(300).optional(),
  reprezentant: z.string().max(300).optional(),
}).optional();

const zobowiazanieSchema = z.object({
  dane_podmiotu: danePodmiotuSchema,
  zakres_doswiadczenia: z.string().max(4000).optional(),
  sposob_udostepnienia: z.string().max(4000).optional(),
  okres_udostepnienia: z.string().max(2000).optional(),
  zakres_podwykonawstwa: z.string().max(4000).optional(),
});

const metaSchema = z.object({
  wykonawca: z.string().max(300).optional(),
  zamawiajacy: z.string().max(300).optional(),
  przedmiot_zamowienia: z.string().max(300).optional(),
  numer_postepowania: z.string().max(120).optional(),
  miejscowosc: z.string().max(120).optional(),
  data_pisma: z.string().max(40).optional(),
}).optional();

const eksportSchema = z.object({
  zobowiazanie: zobowiazanieSchema,
  meta: metaSchema,
});

router.post('/', ah(async (req, res) => {
  const parsed = eksportSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj "zobowiazanie" — model pól pisma z kreatora art. 118 Pzp (dane podmiotu, zakres, sposób, okres, podwykonawstwo).');
  }

  const wynik = generujZobowiazanie(parsed.data.zobowiazanie, parsed.data.meta ?? {});

  // Eksport do pliku: ?pobierz=1 => treść pisma jako załącznik .txt.
  // Niekompletnego pisma NIE eksportujemy (niezmiennik generatora) — 422 z brakami,
  // żeby klient wiedział, które pola wymagane orzecznictwem trzeba jeszcze uzupełnić.
  if (String(req.query.pobierz ?? '') === '1') {
    if (!wynik.kompletne) {
      throw new AppError(
        422,
        'ZOBOWIAZANIE_NIEKOMPLETNE',
        'Nie można wyeksportować niekompletnego zobowiązania — uzupełnij pola wymagane orzecznictwem, zanim pismo będzie gotowe do podpisu.',
        { braki: wynik.braki },
      );
    }
    const plik = zobowiazanieDoPliku(wynik);
    res.setHeader('Content-Type', plik.typ);
    res.setHeader('Content-Disposition', `attachment; filename="${plik.nazwa}"`);
    return res.send(plik.zawartosc);
  }

  return res.json({
    zobowiazanie: {
      kompletne: wynik.kompletne,
      braki: wynik.braki,
      ostrzezenia: wynik.ostrzezenia,
      nazwa_pliku: wynik.nazwaPliku,
      tresc: wynik.tresc,
    },
  });
}));

export default router;
