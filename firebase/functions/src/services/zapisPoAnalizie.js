import { logger } from '../lib/logger.js';
import { skrotKryteriow } from '../lib/ogloszenieMeta.js';
import { matches, saved } from '../db/repos.js';

/*
 * ZAPIS PO ANALIZIE SWZ (2026-11-01). Kto sam pyta o SWZ („Zapytaj SWZ”), podpina analizę z Radaru, wypełnia
 * formularz zamawiającego swoimi danymi albo sprawdza pliki oferty przed wysłaniem, ten szykuje ofertę — a 1.11 na 30 kont było 8 zapisów: użytkownik nie klika „zapisz”, więc nie dostaje
 * przypomnień o terminie (7/3/1 dni). Robimy to za niego: zapis + włączone przypomnienie. Gdy już był
 * zapisany, zostawiamy jego ustawienia (świadomie wyłączone przypomnienie zostaje wyłączone).
 * Automatyczna analiza (job auto-SWZ) tego nie robi — tam konto niczego nie kliknęło.
 */

/** Wpis „Zapisanych” z samego przetargu — gdy ogłoszenie otwarto z katalogu, a nie z dopasowań. */
function wpisZPrzetargu(tender) {
  return {
    tender_id: tender.id,
    tender_title: tender.title ?? null,
    tender_organization: tender.organization ?? null,
    tender_budget: tender.budget ?? null,
    tender_currency: tender.currency ?? 'PLN',
    tender_deadline: tender.deadline ?? null,
    tender_url: tender.url ?? null,
    tender_cpv: tender.cpv_main ?? null,
    tender_source: tender.source ?? 'bzp',
    tender_wadium_wymagane: tender.wadium_wymagane ?? null,
    tender_wadium_kwota: tender.wadium_kwota ?? null,
    tender_wadium_wiele_czesci: tender.wadium_wiele_czesci ?? false,
    tender_kryterium_oceny: tender.kryterium_oceny ?? null,
    tender_kryteria_skrot: skrotKryteriow(tender),
    tender_liczba_czesci: tender.liczba_czesci ?? null,
  };
}

/**
 * @returns {Promise<{zapisany: boolean, przypomnienie: boolean}>} `zapisany` = powstał NOWY wpis
 */
export async function zapiszPoAnalizieSwz(userId, tender, { dopasowania = matches, zapisane = saved } = {}) {
  if (!userId || !tender?.id) return { zapisany: false, przypomnienie: false };
  try {
    const wpis = (await dopasowania.detail(userId, tender.id)) ?? wpisZPrzetargu(tender);
    const nowy = await zapisane.add(userId, wpis);
    if (!nowy) return { zapisany: false, przypomnienie: false };
    const stan = await zapisane.setReminder(userId, tender.id, true);
    return { zapisany: true, przypomnienie: stan.reminder_enabled === true };
  } catch (err) {
    // Odpowiedź o SWZ jest ważniejsza niż zakładka — błąd zapisu tylko w logu.
    logger.warn({ err: err.message, userId, tenderId: tender.id }, 'Zapis po analizie SWZ nie powiódł się');
    return { zapisany: false, przypomnienie: false };
  }
}
