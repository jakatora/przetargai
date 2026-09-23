import { Router } from 'express';
import { env, features } from '../config.js';
import { logger } from '../lib/logger.js';
import { authRequired } from '../middleware/auth.js';
import { idRailwayDlaUzytkownika, przekaz, tozsamoscPrzepadla } from '../services/mostRailway.js';

/*
 * MOST `/api/przetarg/*` → Railway (P0-4).
 *
 * To jest GŁUPIA RURA na bajtach, z JEDNYM wyjątkiem: tłumaczy tożsamość.
 * Nie parsuje ciała, nie zna kontraktu modułów, nie zmienia kształtu odpowiedzi.
 * Dzięki temu publiczny kontrakt aplikacji się NIE zmienia — ekrany Sejfu,
 * Radarów, Symulatora i Czarnej skrzynki dostają dokładnie to, co dotąd dostawały
 * w trybie deweloperskim, wskazującym wprost na Railway.
 *
 * Uwaga o ciele żądania: aplikacja wysyła do Sejfu pliki jako base64 w JSON-ie,
 * a Railway montuje tę trasę z limitem 10 MB. Globalny parser Cloud Functions ma
 * 1 MB — dlatego most montuje się PRZED nim, z własnym parserem bajtowym
 * (patrz app.js). Przekazujemy bajty bez interpretacji.
 */

const router = Router();

router.use(authRequired);

router.use(async (req, res, next) => {
  if (!features.most) {
    return res.status(503).json({
      error: { code: 'MOST_WYLACZONY', message: 'Most do modułów przetargowych jest chwilowo wyłączony' },
    });
  }

  try {
    let idRailway = await idRailwayDlaUzytkownika(req.user);
    let odpowiedz = await przekaz({
      metoda: req.method,
      sciezka: req.url,
      naglowki: req.headers,
      cialo: req.body,
      idRailway,
    });

    /*
     * Jedno ponowienie po przemapowaniu tożsamości. Wolumen SQLite Railway może
     * zostać odtworzony z kopii — wtedy zapamiętany identyfikator wskazuje na
     * konto, którego już nie ma, i użytkownik widziałby 401 aż do ręcznej
     * interwencji. Ponawiamy DOKŁADNIE raz, żeby błędne 401 nie zapętliło mostu.
     */
    if (tozsamoscPrzepadla({ status: odpowiedz.status, cialo: odpowiedz.cialo })) {
      logger.warn({ uid: req.user.id }, 'Most: tożsamość na Railway przepadła — mapuję ponownie');
      idRailway = await idRailwayDlaUzytkownika(req.user, { wymusOdnowienie: true });
      odpowiedz = await przekaz({
        metoda: req.method,
        sciezka: req.url,
        naglowki: req.headers,
        cialo: req.body,
        idRailway,
      });
    }

    const typ = odpowiedz.naglowki.get('content-type');
    if (typ) res.set('Content-Type', typ);
    return res.status(odpowiedz.status).send(odpowiedz.cialo);
  } catch (err) {
    /*
     * Awaria mostu MUSI być odróżnialna od awarii modułu. 502 mówi wprost:
     * „nie ja, tylko to, do czego przekazuję" — a aplikacja pokazuje stan błędu
     * z możliwością ponowienia zamiast wyrzucać użytkownika z konta (401).
     */
    logger.error({ err: err.message, sciezka: req.url, uid: req.user?.id },
      'Most: przekazanie do Railway nie powiodło się');
    return res.status(502).json({
      error: {
        code: 'MOST_NIEDOSTEPNY',
        message: 'Moduł przetargowy jest chwilowo niedostępny. Spróbuj za chwilę.',
        szczegoly: env.NODE_ENV === 'production' ? undefined : err.message,
      },
    });
  }
});

export default router;
