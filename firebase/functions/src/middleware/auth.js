import jwt from 'jsonwebtoken';
import { env } from '../config.js';
import { users } from '../db/repos.js';
import { unauthorized } from '../lib/errors.js';

/**
 * Podpisuje token JWT dla użytkownika (ważność z JWT_TTL_DAYS).
 * `tv` = token_version konta w chwili wydania. Zmiana hasła zwiększa token_version
 * w bazie, więc wszystkie wcześniej wydane tokeny (z niższym `tv`) przestają działać
 * — bez tego skradziona/pozostawiona sesja żyła do 30 dni mimo zmiany hasła.
 */
export function signToken(userId, tokenVersion = 0) {
  return jwt.sign({ sub: userId, tv: tokenVersion }, env.JWT_SECRET, { expiresIn: `${env.JWT_TTL_DAYS}d` });
}

/** Middleware: wymaga ważnego tokenu Bearer; dołącza req.user. */
export async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return next(unauthorized('Brak tokenu uwierzytelniającego'));

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    return next(unauthorized('Nieprawidłowy lub wygasły token'));
  }

  try {
    const user = await users.findById(payload.sub);
    if (!user) return next(unauthorized('Konto nie istnieje'));
    // Token wydany PRZED ostatnią zmianą hasła jest nieważny (niższy `tv`).
    // Brak `tv`/`token_version` = 0 (zgodność wsteczna ze starymi tokenami/kontami).
    if ((user.token_version ?? 0) !== (payload.tv ?? 0)) {
      return next(unauthorized('Sesja wygasła — zaloguj się ponownie'));
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
