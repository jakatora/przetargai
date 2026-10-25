import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pricingRuntime from '../services/remont-pricing.cjs';

const initialObservations = JSON.parse(readFileSync(new URL('../data/remont-verified-offers.json', import.meta.url), 'utf8'));
export const remontService = pricingRuntime.createRemontService({
  initialObservations,
  cachePath: process.env.REMONT_PRICE_CACHE_PATH ?? join(dirname(process.env.DATABASE_PATH ?? '/data/przetargai.db'), 'remont-prices.json'),
  background: process.env.NODE_ENV !== 'test',
});
export default remontService.router;
