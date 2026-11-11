import { env } from '../config/env.js';

/**
 * Spoina — wysyłka kodu logowania SMS-em przez SMSAPI.pl.
 * Brak `SPOINA_SMSAPI_TOKEN` = wysyłka wyłączona (firmy logują się wtedy stałym kodem
 * ustawionym przy zakładaniu). Treść bez polskich znaków — mieści się w jednym SMS-ie.
 */

export const smsEnabled = () => Boolean(env.SPOINA_SMSAPI_TOKEN);

/**
 * @param {string} phone  same cyfry z kierunkowym, np. 48601204118
 * @param {string} code   kod logowania
 * @param {{fetchImpl?: typeof fetch, token?: string, from?: string}} [opts]
 * @throws gdy bramka odrzuci wiadomość albo nie odpowie w 8 s
 */
export async function sendLoginCode(phone, code, opts = {}) {
  const token = opts.token ?? env.SPOINA_SMSAPI_TOKEN;
  if (!token) throw new Error('Wysyłka SMS jest wyłączona');
  const body = new URLSearchParams({
    to: phone,
    message: `Spoina: kod logowania ${code}. Wazny 10 minut. Nie podawaj go nikomu.`,
    format: 'json',
  });
  const from = opts.from ?? env.SPOINA_SMS_FROM;
  if (from) body.set('from', from);

  const res = await (opts.fetchImpl ?? fetch)('https://api.smsapi.pl/sms.do', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    throw new Error(`SMSAPI odrzuciło wiadomość (HTTP ${res.status}${data?.error ? `, błąd ${data.error}: ${data.message}` : ''})`);
  }
}
