import { randomUUID, randomBytes } from 'node:crypto';

/** Identyfikator zasobu (UUID v4). */
export const newId = () => randomUUID();

/** Losowy token hex (np. magic link). Domyślnie 24 bajty => 48 znaków hex. */
export const newToken = (bytes = 24) => randomBytes(bytes).toString('hex');

/** Bieżący znacznik czasu w ISO 8601 (UTC). */
export const nowIso = () => new Date().toISOString();

/** Początek dzisiejszej doby (UTC) w ISO — do limitów dziennych. */
export const startOfTodayIso = () =>
  `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
