import crypto from 'node:crypto';

/**
 * FCM HTTP v1 dla ATLAS Pilota bez dodatkowych zależności.
 * Konto usługi w zmiennej `ATLAS_PILOT_FCM_JSON` (cały JSON). Brak lub błędny JSON → null
 * (trasa zgłasza wtedy `push: "unconfigured"` i niczego nie oznacza jako powiadomionego).
 */
export function fcmSenderFromEnv(env = process.env) {
  let account;
  try {
    account = env.ATLAS_PILOT_FCM_JSON ? JSON.parse(env.ATLAS_PILOT_FCM_JSON) : null;
  } catch {
    return null;
  }
  if (!account?.client_email || !account?.private_key || !account?.project_id) return null;
  let cached = null;
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

  async function accessToken() {
    if (cached && cached.expires > Date.now() + 60_000) return cached.value;
    const issued = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: issued,
      exp: issued + 3600,
    })}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
    if (!res.ok) throw new Error(`FCM OAuth ${res.status}`);
    const json = await res.json();
    cached = { value: json.access_token, expires: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
    return cached.value;
  }

  return async function send(tokens, message) {
    const token = await accessToken();
    let sent = 0;
    for (const target of tokens) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { ...message, token: target } }),
      });
      if (res.ok) sent += 1;
    }
    return sent;
  };
}
