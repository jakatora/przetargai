import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { users } from '../db/repos.js';
import { unauthorized } from '../lib/errors.js';
import { uruchomJakoUzytkownik } from '../lib/kontekstZadania.js';

/** Podpisuje token JWT dla użytkownika (ważność z JWT_TTL_DAYS). */
export function signToken(userId) {
  const user = users.findById(userId);
  if (!user || !Number.isSafeInteger(user.session_version) || user.session_version < 0) {
    throw unauthorized('Konto nie jest dostępne');
  }
  return jwt.sign({ sub: userId, ver: user.session_version }, env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${env.JWT_TTL_DAYS}d` });
}

/**
 * `sub` z tokenu Bearer — WYŁĄCZNIE gdy podpis i ważność się zgadzają; inaczej null.
 * Nie sięga do bazy (tanie, wołane przez limiter przed routerem). Sfałszować klucza się
 * nie da bez JWT_SECRET, więc niezweryfikowany token zawsze wraca do kubełka IP.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function zweryfikowanySub(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const { sub } = jwt.verify(header.slice(7).trim(), env.JWT_SECRET, { algorithms: ['HS256'] });
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}

/** Middleware: wymaga ważnego tokenu Bearer; dołącza req.user. */
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return next(unauthorized('Brak tokenu uwierzytelniającego'));

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return next(unauthorized('Nieprawidłowy lub wygasły token'));
  }

  if (typeof payload.sub !== 'string' || !payload.sub) return next(unauthorized('Nieprawidłowa sesja'));
  const user = users.findById(payload.sub);
  if (!user) return next(unauthorized('Konto nie istnieje'));
  // Pre-migration tokens lack ver and represent version 0. A password reset
  // increments the stored version, revoking those and every older session.
  const version = Object.hasOwn(payload, 'ver') ? payload.ver : 0;
  if (!Number.isSafeInteger(version) || version < 0 || version !== user.session_version) {
    return next(unauthorized('Sesja wygasła. Zaloguj się ponownie.'));
  }
  req.user = user;
  // Reszta łańcucha żądania biegnie w kontekście użytkownika — warstwa płatnego AI
  // liczy z niego dobowy limit per użytkownik także tam, gdzie wołający nie przekazuje
  // `userId` (orkiestratory, radar podprogowy). Patrz lib/kontekstZadania.js (2026-09-25).
  uruchomJakoUzytkownik(user.id, next);
}
