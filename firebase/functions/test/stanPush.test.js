import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sladWysylki, ocenStanPush } from '../src/lib/stanPush.js';

/*
 * 20–28.10.2026 każdy push padał na „InvalidCredentials” (projekt Expo bez klucza FCM v1 / APNs),
 * a widać to było wyłącznie w logach. Ślad dostarczania + blok `push` w /health mają to pokazać
 * od pierwszej nieudanej próby.
 */
const T = '2026-10-28T19:00:00.000Z';

test('sladWysylki: InvalidCredentials = błąd po naszej stronie; DeviceNotRegistered nie; sukces zapisuje datę', () => {
  assert.deepEqual(sladWysylki({ sent: 0, failed: 1, bledy: { InvalidCredentials: 1 } }, T), {
    ostatnia_proba_o: T, ostatni_wynik: { sent: 0, failed: 1, bledy: { InvalidCredentials: 1 } }, ostatni_blad_o: T, ostatni_blad: 'InvalidCredentials',
  });
  const martwy = sladWysylki({ sent: 0, failed: 1, bledy: { DeviceNotRegistered: 1 } }, T);
  assert.equal(martwy.ostatni_blad_o, undefined, 'martwy token to stan telefonu, nie awaria');
  const ok = sladWysylki({ sent: 2, failed: 0, bledy: {} }, T);
  assert.equal(ok.ostatni_sukces_o, T);
  assert.equal(ok.ostatni_blad_o, undefined);
  assert.equal(sladWysylki({ sent: 0, failed: 1 }, T).ostatni_blad, 'Nieznany', 'porażka bez kodu biletu też jest błędem');
  assert.equal(sladWysylki({ sent: 0, failed: 0 }, T), null, 'brak prób = brak śladu');
  assert.equal(sladWysylki({ sent: 0, failed: 1, bledy: { PushWylaczonyLokalnie: 1 } }, T), null, 'emulator nie zostawia śladu');
});

test('ocenStanPush: null bez prób, false gdy błąd nowszy niż ostatni sukces, true po sukcesie', () => {
  assert.equal(ocenStanPush(null), null);
  assert.equal(ocenStanPush({ ostatnia_proba_o: T }), true);
  assert.equal(ocenStanPush({ ostatnia_proba_o: T, ostatni_blad_o: T }), false, 'nigdy nie dostarczono, jest błąd');
  assert.equal(ocenStanPush({ ostatnia_proba_o: T, ostatni_blad_o: '2026-10-28T10:00:00Z', ostatni_sukces_o: '2026-10-28T12:00:00Z' }), true);
  assert.equal(ocenStanPush({ ostatnia_proba_o: T, ostatni_blad_o: '2026-10-28T12:00:00Z', ostatni_sukces_o: '2026-10-28T10:00:00Z' }), false);
});
