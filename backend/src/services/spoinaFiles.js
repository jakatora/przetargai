import crypto from 'node:crypto';
import path from 'node:path';
import { db } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import { badRequest, notFound } from '../lib/errors.js';
import { katalogWolumenu, utworzMagazynNaDysku } from '../lib/magazynPlikow.js';
import { contextFor } from './spoinaStore.js';

/**
 * Spoina — zdjęcia wgrywane z telefonu (karta godzin podpisana na budowie).
 *
 * Plik leży na trwałym wolumenie obok bazy, w bazie jest tylko jego metryka. Zdjęcie widzi
 * biuro, osoba, która je wgrała, i brygadzista jej ekipy — nikt inny, także z tej samej firmy.
 * Telefon zmniejsza zdjęcie przed wysyłką; limity niżej chronią wolumen wspólny dla kilku aplikacji.
 */

const MAX_BYTES = 1_200_000;
const MAX_COMPANY_BYTES = 300_000_000;

const TYPES = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

/** Magazyn na wolumenie; katalog z `SPOINA_STORAGE_DIR`, domyślnie `<katalog bazy>/spoina`. */
function magazyn() {
  return utworzMagazynNaDysku(process.env.SPOINA_STORAGE_DIR || path.join(katalogWolumenu(), 'spoina'));
}

const row = (id) => db.prepare('SELECT * FROM spoina_files WHERE id = ?').get(id);

/**
 * Zapisuje zdjęcie wgrane przez osobę.
 * @param {{companyId:string, workerId:string}} member
 * @param {{mime:string, data:string}} input  `data` = treść pliku w base64
 * @returns {Promise<{id:string, bytes:number}>}
 */
export async function saveFile(member, { mime, data }) {
  const type = TYPES[mime];
  if (!type) throw badRequest('Można wgrać tylko zdjęcie (JPEG, PNG albo WebP)');
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(data)) throw badRequest('Niepoprawna treść pliku');
  const buf = Buffer.from(data, 'base64');
  if (buf.length < 16) throw badRequest('Plik jest pusty');
  if (buf.length > MAX_BYTES) throw badRequest('Zdjęcie jest za duże. Zrób je jeszcze raz w mniejszej rozdzielczości.');
  // Typ sprawdzamy po treści, nie po deklaracji — pod „image/jpeg" nie wejdzie inny plik.
  if (!type.magic(buf)) throw badRequest('Plik nie jest zdjęciem w podanym formacie');

  const used = db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM spoina_files WHERE company_id = ?').get(member.companyId).n;
  if (used + buf.length > MAX_COMPANY_BYTES) throw badRequest('Firma wykorzystała miejsce na zdjęcia. Usuń stare karty.');

  const id = newId();
  await magazyn().zapisz(id, type.ext, buf);
  db.prepare('INSERT INTO spoina_files (id, company_id, owner_id, mime, bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, member.companyId, member.workerId, mime, buf.length, crypto.createHash('sha256').update(buf).digest('hex'), nowIso());
  return { id, bytes: buf.length };
}

/** Wiersz pliku, jeśli ta osoba może go zobaczyć; inaczej 404 (nie zdradzamy, że plik istnieje). */
function allowed(member, id) {
  const f = /^[0-9a-f-]{36}$/.test(String(id)) ? row(id) : null;
  if (!f || f.company_id !== member.companyId) throw notFound('Nie ma takiego zdjęcia');
  if (f.owner_id !== member.workerId) {
    const ctx = contextFor(member);
    if (!ctx.office && !ctx.team.has(f.owner_id)) throw notFound('Nie ma takiego zdjęcia');
  }
  return f;
}

/** @returns {Promise<{mime:string, body:Buffer}>} */
export async function readFile(member, id) {
  const f = allowed(member, id);
  try {
    return { mime: f.mime, body: await magazyn().czytaj(f.id, TYPES[f.mime].ext) };
  } catch {
    throw notFound('Nie ma takiego zdjęcia');
  }
}

/** Usuwa zdjęcie: ten, kto je wgrał, albo biuro. */
export function deleteFile(member, id) {
  const f = allowed(member, id);
  if (f.owner_id !== member.workerId && !contextFor(member).office) throw notFound('Nie ma takiego zdjęcia');
  db.prepare('DELETE FROM spoina_files WHERE id = ?').run(f.id);
  magazyn().usun(`${f.id}.${TYPES[f.mime].ext}`);
}
