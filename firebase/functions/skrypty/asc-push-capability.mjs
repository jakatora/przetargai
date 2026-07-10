/*
 * Rejestracja bundle ID pl.przetargai.app + capability PUSH_NOTIFICATIONS
 * przez App Store Connect API (klucz W9Z5F63UJP, rola App Manager).
 * Idempotentne: istniejący bundleId/capability nie jest duplikowany.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/Startklaar/Documents/przetarg-ai/firebase/functions/');
const jwt = require('jsonwebtoken');

const ISSUER = '9ebc5189-2dc4-4c65-b697-bf149c3aa156';
const KEY_ID = 'W9Z5F63UJP';
const P8 = readFileSync('C:/Users/Startklaar/.api-keys/AuthKey_W9Z5F63UJP.p8', 'utf8');
const BUNDLE = 'pl.przetargai.app';

const token = jwt.sign({}, P8, {
  algorithm: 'ES256',
  issuer: ISSUER,
  audience: 'appstoreconnect-v1',
  expiresIn: '15m',
  keyid: KEY_ID,
});

const api = async (path, opts = {}) => {
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
};

// 1. Czy bundle ID już istnieje?
const szukaj = await api(`/bundleIds?filter[identifier]=${BUNDLE}`);
let bundle = (szukaj.body?.data ?? []).find((b) => b.attributes.identifier === BUNDLE);

if (!bundle) {
  const nowy = await api('/bundleIds', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'bundleIds',
        attributes: { identifier: BUNDLE, name: 'PrzetargAI', platform: 'IOS' },
      },
    }),
  });
  if (nowy.status !== 201) {
    console.log('BLAD rejestracji bundleId:', nowy.status, JSON.stringify(nowy.body?.errors ?? nowy.body).slice(0, 400));
    process.exit(1);
  }
  bundle = nowy.body.data;
  console.log('bundleId ZAREJESTROWANY:', bundle.id, BUNDLE);
} else {
  console.log('bundleId istnieje:', bundle.id, BUNDLE);
}

// 2. Capability PUSH_NOTIFICATIONS
const cap = await api('/bundleIdCapabilities', {
  method: 'POST',
  body: JSON.stringify({
    data: {
      type: 'bundleIdCapabilities',
      attributes: { capabilityType: 'PUSH_NOTIFICATIONS' },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } },
    },
  }),
});
if (cap.status === 201) console.log('PUSH_NOTIFICATIONS: WLACZONE');
else if (cap.status === 409) console.log('PUSH_NOTIFICATIONS: bylo juz wlaczone (409)');
else console.log('capability status:', cap.status, JSON.stringify(cap.body?.errors ?? cap.body).slice(0, 300));
