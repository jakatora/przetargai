import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { chatFitter } from '../services/fitterAi.js';
import { badRequest, serviceUnavailable, tooMany } from '../lib/errors.js';
import { features } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { aiQuotaDevice } from '../db/repos.js';

// AI chat endpoint dla Fitter Welder Pro. Proxy do Claude Haiku 4.5 z
// retrievalem nad piping_knowledge.md. Klient mobilny woła z message + history;
// odpowiada {text, citations}.

const router = Router();

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    text: z.string().max(4000),
  })).max(20).default([]),
  lang: z.enum(['pl', 'en']).default('pl'),
  // MVP: brak weryfikacji subskrypcji — Phase 6b doda Bearer token z premium status.
  device_id: z.string().min(8).max(128).optional(),
});

router.post('/chat', ah(async (req, res) => {
  if (!features.ai) throw serviceUnavailable('AI offline (brak klucza Anthropic)');
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest(`Niepoprawne dane: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
  }
  const { message, history, lang, device_id } = parsed.data;

  /*
   * Dobowy limit na urządzenie (audyt 2026-07-10). Trasa jest nieuwierzytelniona,
   * a każde pytanie to płatne wywołanie modelu.
   *
   * `device_id` pozostaje opcjonalne — wymaganie go zepsułoby starsze wersje apki.
   * Brak identyfikatora traktujemy jako urządzenie anonimowe, kluczowane adresem:
   * inaczej wystarczyłoby pominąć pole, żeby ominąć limit.
   */
  const kluczUrzadzenia = device_id ?? `anon:${req.ip ?? 'nieznany'}`;
  if (!aiQuotaDevice.reserve(kluczUrzadzenia, 'fitter_chat')) {
    const limit = aiQuotaDevice.limitDlaUrzadzenia(kluczUrzadzenia, 'fitter_chat');
    logger.warn({ deviceId: kluczUrzadzenia, limit }, 'Fitter chat: dobowy limit urządzenia wyczerpany');
    throw tooMany(`Dzienny limit pytań (${limit}) wyczerpany. Spróbuj jutro albo aktywuj Premium.`);
  }

  const t0 = Date.now();
  const reply = await chatFitter({ message, history, lang });
  logger.info({ deviceId: device_id, ms: Date.now() - t0, citations: reply.citations.length },
    'fitter ai chat');
  res.json(reply);
}));

export default router;
