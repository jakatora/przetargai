-- Rejestr obsłużonych zdarzeń Stripe (audyt 2026-07-09).
-- Stripe ponawia dostawę przy każdym nie-2xx i przy niepewności sieciowej.
-- Bez tego rejestru powtórka wystawiała klientowi DRUGĄ FAKTURĘ i słała drugi
-- e-mail. `id` = event.id ze Stripe; INSERT na istniejącym kluczu zawodzi,
-- co jest naszym testem „czy to pierwsza obsługa".
CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed ON stripe_events(processed_at);
