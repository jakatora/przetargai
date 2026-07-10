/*
 * Uprząż do PEŁNEGO testu płatności w trybie TESTOWYM Stripe (weryfikacja wydania).
 *
 * Uruchamia API (ten sam createApp co produkcyjna funkcja) na porcie 3199
 * z PRAWDZIWYMI kluczami testowymi Stripe z backend/.env, na współdzielonym
 * emulatorze Firestore (:8081) — aktywowany plan widać od razu w podglądzie apki.
 *
 * Pełna pętla wymaga forwardera webhooków w drugim terminalu:
 *   stripe listen --api-key sk_test_… --forward-to http://127.0.0.1:3199/webhooks/stripe
 * i podania jego sekretu w env HARNESS_WEBHOOK_SECRET (whsec_… z wyjścia listen).
 *
 * Świadomie PUSTE: FAKTUROWNIA (tryb degradacji — bez prawdziwych faktur),
 * RESEND (bez maili), ANTHROPIC (bez kosztów AI).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function zEnvPliku(sciezka, klucz) {
  const linia = readFileSync(sciezka, 'utf8').split(/\r?\n/)
    .find((l) => l.startsWith(`${klucz}=`));
  return linia ? linia.slice(klucz.length + 1).trim() : '';
}

const backendEnv = path.resolve(__dirname, '../../../backend/.env');

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'harness-platnosci-tylko-lokalnie';
process.env.APP_URL = 'http://127.0.0.1:3199';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8081';
process.env.GOOGLE_CLOUD_PROJECT = 'przetargai';
process.env.STRIPE_SECRET_KEY = zEnvPliku(backendEnv, 'STRIPE_SECRET_KEY');
process.env.STRIPE_PRICE_STANDARD = zEnvPliku(backendEnv, 'STRIPE_PRICE_STANDARD');
process.env.STRIPE_WEBHOOK_SECRET = process.env.HARNESS_WEBHOOK_SECRET || '';
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';
process.env.FAKTUROWNIA_API_KEY = '';
process.env.FAKTUROWNIA_DOMAIN = '';

if (!process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
  console.error('BEZPIECZNIK: uprząż działa wyłącznie na kluczu sk_test_… (żywych pieniędzy nie dotykamy)');
  process.exit(1);
}

const { initializeApp } = await import('firebase-admin/app');
initializeApp({ projectId: 'przetargai' });
const { createApp } = await import('../src/app.js');
const { default: express } = await import('express');

/*
 * Cloud Functions dostarczają `req.rawBody` natywnie i webhooks.js na tym polega.
 * Goły Express — nie („No webhook payload was provided" przy weryfikacji podpisu).
 * Zewnętrzna powłoka przechwytuje surowe body WYŁĄCZNIE dla trasy webhooka,
 * zanim wewnętrzny parser JSON by je skonsumował.
 */
const app = createApp();
const powloka = express();
powloka.use('/webhooks/stripe', express.raw({ type: '*/*' }), (req, _res, next) => {
  req.rawBody = req.body;
  next();
});
powloka.use(app);
powloka.listen(3199, () => console.log('Uprząż płatności: http://127.0.0.1:3199 (Firestore: emulator 8081)'));
