import crypto from 'node:crypto';
import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';

const B2_API = 'https://api.backblazeb2.com/b2api/v2';

async function b2Authorize() {
  const credentials = Buffer.from(`${env.B2_ACCOUNT_ID}:${env.B2_APP_KEY}`).toString('base64');
  const res = await fetch(`${B2_API}/b2_authorize_account`, {
    headers: { Authorization: `Basic ${credentials}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`B2 authorize ${res.status}`);
  return res.json();
}

async function resolveBucketId(auth) {
  if (auth.allowed?.bucketId) return auth.allowed.bucketId;
  // Klucz nie jest ograniczony do bucketa — szukamy po nazwie.
  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: auth.accountId, bucketName: env.B2_BUCKET }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`B2 list_buckets ${res.status}`);
  const data = await res.json();
  const bucket = data.buckets?.[0];
  if (!bucket) throw new Error(`B2: bucket „${env.B2_BUCKET}" nie znaleziony`);
  return bucket.bucketId;
}

/**
 * Wysyła plik do Backblaze B2 (natywne API v2).
 * @returns {Promise<boolean>} true gdy wysłano, false gdy B2 nieskonfigurowane.
 */
export async function uploadToB2(fileName, data) {
  if (!features.backups) {
    logger.warn('B2 nieskonfigurowane — kopia zapasowa zapisana tylko lokalnie');
    return false;
  }

  const auth = await b2Authorize();
  const bucketId = await resolveBucketId(auth);

  const urlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId }),
    signal: AbortSignal.timeout(20000),
  });
  if (!urlRes.ok) throw new Error(`B2 get_upload_url ${urlRes.status}`);
  const { uploadUrl, authorizationToken } = await urlRes.json();

  const sha1 = crypto.createHash('sha1').update(data).digest('hex');
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: authorizationToken,
      'X-Bz-File-Name': encodeURIComponent(`przetargai/${fileName}`),
      'Content-Type': 'application/octet-stream',
      'X-Bz-Content-Sha1': sha1,
    },
    body: data,
    signal: AbortSignal.timeout(60000),
  });
  if (!upRes.ok) {
    const body = await upRes.text().catch(() => '');
    throw new Error(`B2 upload ${upRes.status} ${body.slice(0, 150)}`);
  }
  logger.info({ fileName }, 'B2: kopia zapasowa wysłana');
  return true;
}
