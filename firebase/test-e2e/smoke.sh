#!/bin/bash
# E2E na emulatorze Functions+Firestore. Sprawdza, czy trasy naprawdę wstają
# (node --check nie rozwiązuje importów) i czy kontrakt API się nie zmienił.
# Port 5002 = konfiguracja testowa (firebase.test.json) — nie koliduje
# z devowym emulatorem na 5001. Nadpisywalny przez SMOKE_BASE.
B="${SMOKE_BASE:-http://127.0.0.1:5002/przetargai/europe-central2/api}"
fail=0
chk() { # nazwa, oczekiwany_kod, faktyczny_kod
  if [ "$2" = "$3" ]; then echo "  OK   $1 ($3)"; else echo "  FAIL $1: oczekiwano $2, jest $3"; fail=$((fail+1)); fi
}

echo "== 1. /health"
code=$(curl -s -o ./h.json -w "%{http_code}" "$B/health"); chk "health" 200 "$code"
grep -q '"platform":"firebase"' ./h.json && echo "  OK   platform=firebase" || { echo "  FAIL brak platform=firebase"; fail=$((fail+1)); }

echo "== 2. rejestracja bez NIP (D-023)"
code=$(curl -s -o ./r.json -w "%{http_code}" -X POST "$B/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"e2e@test.pl","password":"haslo12345","keywords":["droga","chodnik"]}'); chk "register" 201 "$code"
TOKEN=$(node -pe "try{JSON.parse(require('fs').readFileSync('./r.json')).token}catch(e){''}")
[ -n "$TOKEN" ] && echo "  OK   token wydany" || { echo "  FAIL brak tokenu"; fail=$((fail+1)); }

echo "== 3. duplikat e-maila => 409"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"e2e@test.pl","password":"haslo12345"}'); chk "duplikat" 409 "$code"

echo "== 4. logowanie + zle haslo"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"e2e@test.pl","password":"haslo12345"}'); chk "login" 200 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"e2e@test.pl","password":"zlehaslo1"}'); chk "zle haslo" 401 "$code"

echo "== 5. /auth/me z tokenem i bez"
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/auth/me" -H "Authorization: Bearer $TOKEN"); chk "me+token" 200 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/auth/me"); chk "me bez tokenu" 401 "$code"

echo "== 6. feed dopasowan (pusty, ale kontrakt + kursor paginacji)"
code=$(curl -s -o ./m.json -w "%{http_code}" "$B/matches" -H "Authorization: Bearer $TOKEN"); chk "matches" 200 "$code"
node -pe "const d=JSON.parse(require('fs').readFileSync('./m.json')); ('matches' in d && 'count' in d && 'next_before' in d)?'  OK   ksztalt {matches,count,next_before}':'  FAIL zly ksztalt feedu'"
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/matches?limit=5&before=2026-01-01T00:00:00.000Z" -H "Authorization: Bearer $TOKEN"); chk "matches z kursorem" 200 "$code"

echo "== 7. PATCH profilu"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$B/auth/me" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"keywords":["droga","chodnik","asfalt"]}'); chk "patch me" 200 "$code"

echo "== 8. IDOR: cudze dopasowanie => 404"
T2=$(curl -s -X POST "$B/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"e2e-b@test.pl","password":"haslo12345"}' | node -pe "try{JSON.parse(require('fs').readFileSync(0)).token}catch(e){''}")
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/matches/nieistniejacy" -H "Authorization: Bearer $T2"); chk "IDOR/404" 404 "$code"

echo "== 9. admin bez klucza => 403"
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/admin/stats"); chk "admin bez klucza" 403 "$code"
echo "== 10. admin z kluczem"
code=$(curl -s -o ./a.json -w "%{http_code}" "$B/admin/stats" -H "X-Admin-Key: emulator-admin-key"); chk "admin stats" 200 "$code"

echo "== 10b. /admin/users NIE wycieka hasel ani ID Stripe"
code=$(curl -s -o ./u.json -w "%{http_code}" "$B/admin/users" -H "X-Admin-Key: emulator-admin-key"); chk "admin users" 200 "$code"
if grep -qiE 'password_hash|stripe_customer_id' ./u.json; then
  echo "  FAIL /admin/users wycieka dane wrazliwe"; fail=$((fail+1))
else
  echo "  OK   brak password_hash / stripe_customer_id"
fi

echo "== 10c. /auth/me NIE wycieka hasla"
curl -s "$B/auth/me" -H "Authorization: Bearer $TOKEN" -o ./me.json
if grep -qi "password" ./me.json; then echo "  FAIL /auth/me wycieka haslo"; fail=$((fail+1)); else echo "  OK   brak pola password"; fi

echo "== 11. webhook Stripe bez podpisu => 400"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/webhooks/stripe" -H "Content-Type: application/json" -d '{}'); chk "webhook bez podpisu" 400 "$code"

echo "== 10d. RODO: usuniecie konta"
TDEL=$(curl -s -X POST "$B/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"do-usuniecia@test.pl","password":"haslo12345","keywords":["droga"]}' | node -pe "try{JSON.parse(require('fs').readFileSync(0)).token}catch(e){''}")
code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$B/auth/me" -H "Authorization: Bearer $TDEL" \
  -H "Content-Type: application/json" -d '{"password":"zle-haslo"}'); chk "usuniecie ze zlym haslem => 403 (nie 401, bo apka by wylogowala)" 403 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$B/auth/me" -H "Authorization: Bearer $TDEL" \
  -H "Content-Type: application/json" -d '{"password":"haslo12345"}'); chk "usuniecie konta" 200 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/auth/me" -H "Authorization: Bearer $TDEL"); chk "token usunietego konta => 401" 401 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"do-usuniecia@test.pl","password":"haslo12345"}'); chk "ponowna rejestracja tego emaila" 201 "$code"

echo "== 11b. strony prawne (App Store / Google Play)"
code=$(curl -s -o ./pp.html -w "%{http_code}" "$B/polityka-prywatnosci"); chk "polityka" 200 "$code"
grep -q "Google (Firebase" ./pp.html && echo "  OK   polityka wymienia aktualny hosting" || { echo "  FAIL polityka nie wymienia Firebase"; fail=$((fail+1)); }
code=$(curl -s -o ./reg.html -w "%{http_code}" "$B/regulamin"); chk "regulamin" 200 "$code"
grep -q "wystarczy adres e-mail" ./reg.html && echo "  OK   regulamin zgodny z rejestracja bez NIP" || { echo "  FAIL regulamin wciaz wymaga NIP"; fail=$((fail+1)); }

echo "== 12. nieznana trasa => 404"
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/nie-ma-takiej"); chk "404" 404 "$code"

echo ""
[ "$fail" = "0" ] && echo "WSZYSTKO PRZESZLO" || echo "NIEPOWODZEN: $fail"
exit $fail
