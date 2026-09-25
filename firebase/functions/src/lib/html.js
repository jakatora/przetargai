/**
 * Ucieczka znaków HTML dla treści wstawianych do szablonów e-maili.
 *
 * Wspólna dla wszystkich szablonów (2026-09-25): `company_name` podaje sam
 * użytkownik, tytuły przetargów — zewnętrzne rejestry. Bez ucieczki nazwa firmy
 * `<a href="...">` renderowała się w mailu jako działający link wysłany naszą
 * zweryfikowaną domeną. Apostrof też, bo atrybut może być w pojedynczych cudzysłowach.
 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
