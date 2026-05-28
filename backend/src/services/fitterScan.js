import Anthropic from '@anthropic-ai/sdk';
import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { costUsd } from '../lib/pricing.js';
import { aiUsage } from '../db/repos.js';

// Vision-based ISO drawing scanner. Takes a photographed/scanned iso sketch
// (base64 JPEG/PNG) and asks Claude to extract a structured envelope matching
// the Flutter client's AiScanResult schema: title block, segments, components,
// BOM, needs-input questions.
//
// We use Sonnet (vision) instead of Haiku — the visual layout of an iso is
// dense (line numbers, dimensions, weld bubbles) and Haiku misses too much
// for routine fab use. Cost per scan is ~$0.01-0.03 depending on image size,
// tracked through aiUsage so the user's monthly budget covers it.

const client = features.ai ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
const SCAN_MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = [
  'Jesteś AI analizatorem rysunków izometrycznych rurociągów przemysłowych.',
  'Otrzymujesz zdjęcie ISO i zwracasz STRUKTURALNY JSON zgodny ze schematem.',
  'Wyciągasz wszystkie elementy: title block, wymiary segmentów, fittingi, spoiny, BOM.',
  'Gdy czegoś NIE jesteś pewien — wpisz to do needsUserInput zamiast zgadywać liczby.',
  'Confidence pole: "high" gdy widzisz wartość wyraźnie, "low" gdy musisz wnioskować.',
  'Wszystkie wymiary w mm. NPS w calach (3", 6", 12") z opcjonalnym DN.',
  'NIE pisz prozy poza JSON — odpowiedź to TYLKO obiekt JSON, nic więcej.',
].join(' ');

const SCHEMA_HINT = `
Zwróć obiekt JSON z polami:
{
  "drawingStandard": "ASME" | "ISO" | "unknown",
  "sizeNotation": "NPS" | "DN" | "OD" | "unknown",
  "isHygienic": boolean,
  "titleBlock": {
    "drawingNumber": string?, "sheet": string?, "revision": string?,
    "lineNumber": string?, "pipeClass": string?,
    "designPressure": string?, "designTemperature": string?,
    "fluidService": string?, "material": string?, "schedule": string?,
    "insulationType": string?, "insulationThickness": string?,
    "paintCode": string?, "fromEquipment": string?, "toEquipment": string?,
    "hydrotestPressure": string?, "pwht": string?, "units": "mm" | "in"
  },
  "northArrow": string?,
  "scale": string?,
  "segments": [{
    "id": string, "dimensionMm": number?, "rawDimension": string?,
    "fromId": string?, "toId": string?,
    "auxiliary": boolean, "confidence": "high"|"medium"|"low"
  }],
  "components": [{
    "id": string,
    "type": "elbow90"|"elbow45"|"tee"|"reducer"|"flange"|"blindFlange"|"cap"
          |"valve"|"weld"|"fieldWeld"|"support"|"instrument"|"other",
    "valveType": "gate"|"ball"|"check"|"globe"|"butterfly"|"needle"?,
    "supportType": "shoe"|"hanger"|"guide"|"anchor"?,
    "label": string?, "weldNo": string?, "weldType": "BW"|"SW"|"FW"?,
    "weldNde": "RT"|"UT"|"MT"|"PT"|"VT"?, "weldPwht": boolean?,
    "weldPosition": "PA"|"PB"|"PC"|"PD"|"PE"|"PF"|"PG"|"PH"|"PJ"?,
    "throatA": string?, "isField": boolean?,
    "instrumentTag": string?, "confidence": "high"|"medium"|"low"
  }],
  "elevations": [{ "atId": string, "value": string }],
  "billOfMaterials": [{
    "item": string, "quantity": number, "description": string,
    "material": string?, "size": string?, "schedule": string?, "standard": string?
  }],
  "needsUserInput": [{
    "ask": string, "componentId": string?, "hint": string?,
    "type": "takeout"|"schedule"|"material"|"weldPosition"|"other"
  }],
  "uncertainty": [string],
  "warnings": [string]
}

JEŚLI zdjęcie nie jest rysunkiem izometrycznym (np. zwykłe zdjęcie, P&ID,
twarz, niejasna mazia), zwróć obiekt z warnings = ["not_an_isometric"] i
pustymi tablicami pozostałych pól.`;

/** Strip code fences / prose around the JSON envelope. */
function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    logger.warn({ err: err.message }, 'fitterScan: JSON parse failed');
    return null;
  }
}

/**
 * Run the vision scan. [imageBase64] is the raw base64 (no data: prefix).
 * [mediaType] should be image/jpeg or image/png.
 * Returns the envelope: { result, tookMs, model }.
 */
export async function scanFitterIso({ imageBase64, mediaType = 'image/jpeg', deviceId }) {
  if (!client) {
    throw new Error('AI niedostępne — brak konfiguracji Anthropic');
  }
  const startedAt = Date.now();
  const resp = await client.messages.create({
    model: SCAN_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: SCHEMA_HINT + '\n\nZeskanuj powyższy rysunek izometryczny i zwróć JSON.',
          },
        ],
      },
    ],
  });
  const tookMs = Date.now() - startedAt;

  // Track usage for the cost budget.
  const usage = resp.usage || {};
  try {
    const dollars = costUsd({
      model: SCAN_MODEL,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
    });
    aiUsage.record({
      operation: 'fitter_scan',
      model: SCAN_MODEL,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      costUsd: dollars,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'fitterScan: cost tracking failed');
  }

  // Extract assistant text.
  let assistantText = '';
  for (const block of resp.content || []) {
    if (block.type === 'text') assistantText += block.text;
  }
  const parsed = extractJson(assistantText);
  if (!parsed) {
    return {
      result: {
        drawingStandard: 'unknown',
        sizeNotation: 'unknown',
        isHygienic: false,
        titleBlock: { units: 'mm' },
        segments: [],
        components: [],
        elevations: [],
        billOfMaterials: [],
        needsUserInput: [],
        uncertainty: [],
        warnings: ['parse_failed'],
        error: 'Model nie zwrócił prawidłowego JSON',
      },
      tookMs,
      model: SCAN_MODEL,
    };
  }
  return {
    result: parsed,
    tookMs,
    model: SCAN_MODEL,
  };
}
