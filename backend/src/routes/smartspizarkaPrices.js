import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ah } from '../lib/asyncHandler.js';
import { badRequest, notFound } from '../lib/errors.js';

/*
 * SmartSpiżarka — publiczny endpoint cen produktów.
 *
 *   GET /api/smartspizarka/prices?productId=<ingredientName>
 *     → { store, unit, price, currency, quantity, checkedAt, sourceUrl, validUntil }
 *
 * Kontrakt jest DOKŁADNIE tym, czego oczekuje klient Flutter (`PriceApiDto.fromJson`
 * w `lib/data/price_api_dto.dart`): RDZEŃ `store`/`unit`/`price` + WALUTA `currency`
 * (kod ISO, na start tylko PLN) i BAZA ILOŚCIOWA `quantity` (za ile jednostek jest
 * `price`, np. 1 dla „1 kg") + `checkedAt` + POCHODZENIE `sourceUrl` (URL konkretnej
 * oferty) i `validUntil` (realny termin).
 *
 * REGUŁA ŚCIEŻKI PIENIĘDZY (money-path) — nigdy nie fabrykuj ceny, waluty, ilości
 * ani daty. Oferta jest WIARYGODNA (publikujemy kwotę) WYŁĄCZNIE gdy jednocześnie:
 *   `price > 0` && `quantity > 0` && `currency ∈ obsługiwane` && `unit` niepuste &&
 *   realny `sourceUrl` && `validUntil` w przyszłości.
 * Inaczej cała PIĄTKA money — `price`, `currency`, `quantity`, `sourceUrl`,
 * `validUntil` = null (cena nieznana). `store`/`unit`/`checkedAt` zostają
 * (informacyjnie). Klient traktuje `price:null` jako `priceKnown=false` i trzyma
 * taką pozycję POZA pewnym kosztem — dokładnie to, czego chcemy, gdy oferty nie da
 * się potwierdzić.
 *
 * Świadomie BEZSTANOWY i PUBLICZNY (bez auth): tylko odczyt statycznego katalogu,
 * ZERO DB, ZERO płatnego AI, ZERO ruchu pieniędzy w dół → brak denial-of-wallet;
 * wspólny `apiLimiter` (120/min/IP) w app.js wystarcza. Źródło danych = mirror
 * ręcznie zweryfikowanego `smartspizarka/assets/data/seed_prices.json` (klucz =
 * `ingredientName` = `productId` wysyłany przez klienta).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const KATALOG = JSON.parse(
  readFileSync(join(__dirname, '../data/smartspizarka_prices.json'), 'utf8'),
);
const CENY = KATALOG.prices ?? {};

/** Waluty, dla których wolno publikować cenę. Na start tylko złoty polski. */
const WALUTY_OBSLUGIWANE = new Set(['PLN']);

/** Realny, parsowalny i NIEwygasły termin → zwraca string ISO; inaczej null (bez fabrykacji). */
function terminWazny(validUntil, teraz) {
  if (typeof validUntil !== 'string' || validUntil.trim() === '') return null;
  const t = new Date(validUntil.trim());
  if (Number.isNaN(t.getTime())) return null; // nieparsowalna data — NIE zgaduj
  if (t.getTime() < teraz.getTime()) return null; // oferta wygasła
  return validUntil.trim();
}

/** Kanoniczny kod waluty (trim + UPPER), jeśli jest na liście obsługiwanych; inaczej null. */
function walutaObslugiwana(currency) {
  if (typeof currency !== 'string') return null;
  const kod = currency.trim().toUpperCase();
  return WALUTY_OBSLUGIWANE.has(kod) ? kod : null;
}

/**
 * Buduje publiczną odpowiedź cenową z rekordu katalogu, egzekwując regułę money-path.
 * `teraz` wstrzykiwalne (domyślnie zegar serwera) → deterministyczne testy, bez pułapki czasowej.
 */
export function zbudujOfertePubliczna(rekord, teraz = new Date()) {
  const store = rekord?.store ?? null;
  const unit = rekord?.unit ?? null;
  const checkedAt = rekord?.checkedAt ?? null;

  const sourceUrl = typeof rekord?.sourceUrl === 'string' && rekord.sourceUrl.trim() !== ''
    ? rekord.sourceUrl.trim()
    : null;
  const validUntil = terminWazny(rekord?.validUntil, teraz);
  const currency = walutaObslugiwana(rekord?.currency);

  const cenaOk = Number.isFinite(rekord?.price) && rekord.price > 0;
  const quantityOk = Number.isFinite(rekord?.quantity) && rekord.quantity > 0;
  const unitOk = typeof rekord?.unit === 'string' && rekord.unit.trim() !== '';

  const potwierdzone = sourceUrl !== null && validUntil !== null && cenaOk
    && quantityOk && currency !== null && unitOk;

  // Bez KOMPLETU (źródło + termin + kwota + ilość + obsługiwana waluta + jednostka)
  // — cała PIĄTKA money NIEZNANA (cena/waluta/ilość/źródło/termin), reszta informacyjnie.
  if (!potwierdzone) {
    return {
      store, unit,
      price: null, currency: null, quantity: null,
      checkedAt, sourceUrl: null, validUntil: null,
    };
  }
  return {
    store, unit,
    price: rekord.price, currency, quantity: rekord.quantity,
    checkedAt, sourceUrl, validUntil,
  };
}

const router = Router();

// GET /api/smartspizarka/prices?productId=<ingredientName>
router.get('/', ah(async (req, res) => {
  const surowy = req.query.productId;
  const productId = typeof surowy === 'string' ? surowy.trim() : '';
  if (!productId) {
    throw badRequest('Podaj "productId" (nazwa produktu) w query.');
  }

  const rekord = CENY[productId];
  if (!rekord) {
    throw notFound(`Brak ceny dla produktu "${productId}".`);
  }

  res.json(zbudujOfertePubliczna(rekord));
}));

export default router;
