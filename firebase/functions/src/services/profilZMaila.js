import { env } from '../config.js';
import { magicLinks } from '../db/repos.js';
import { esc } from '../lib/html.js';
import { NAZWY_CPV } from '../lib/cpvNazwy.js';

/*
 * PROPOZYCJA PROFILU MAILEM (2026-11-02). Konto bez dopasowań od miesiąca dostaje propozycję w panelu apki
 * (lib/sugestiaProfilu.js), ale takie konto nie dostaje żadnych maili (nie ma czego wysłać) i zwykle nie otwiera
 * apki — propozycja leżałaby niewidziana. Jeden mail na sugestię (najwyżej raz na 14 dni), jednorazowy link
 * (cel `profil_z_maila`, 14 dni) do strony z przyciskiem „Dopisz do profilu” — bez logowania (routes/profilZMaila.js).
 * Klient z wyłączonymi mailami (`powiadomienia_pracownik_email: false`) nie dostaje nic.
 */
export const CEL_PROFIL = 'profil_z_maila';
export const PROFIL_TTL_MIN = 14 * 24 * 60;

export async function linkProfilu(userId, { linki = magicLinks } = {}) {
  const { token } = await linki.create({ userId, purpose: CEL_PROFIL, ttlMinutes: PROFIL_TTL_MIN });
  return `${env.APP_URL}/maile/profil?token=${token}`;
}

const lista = (s) => [
  ...(s.keywords ?? []).map((k) => `słowo „${k}”`),
  ...(s.cpv ?? []).map((k) => `kod CPV ${k} (${NAZWY_CPV[k] ?? 'CPV'})`),
];

export function mailSugestii({ sugestia, link }) {
  const co = lista(sugestia);
  const n = sugestia.w_puli ?? 0;
  const przyklady = (sugestia.przyklady ?? []).slice(0, 3);
  return {
    subject: 'PrzetargAI: nie było przetargów dla Twojego profilu — mamy propozycję',
    text: `Dzień dobry,\n\nod miesiąca żaden przetarg nie pasował do Twojego profilu w PrzetargAI. Proponujemy dopisać:\n`
      + `${co.map((x) => `• ${x}`).join('\n')}\n\nZ tym profilem wstępnie pasuje dziś ${n} otwartych przetargów, np.:\n`
      + `${przyklady.map((t) => `• ${t}`).join('\n')}\n\nDopisz jednym kliknięciem (bez logowania): ${link}\n\n`
      + 'Możesz też przyjąć propozycję w aplikacji — jest na górze listy przetargów.\n\nZespół PrzetargAI',
    html: '<p>Dzień dobry,</p><p>od miesiąca żaden przetarg nie pasował do Twojego profilu w PrzetargAI. Proponujemy dopisać:</p>'
      + `<ul>${co.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      + `<p>Z tym profilem wstępnie pasuje dziś <b>${n}</b> otwartych przetargów, np.:</p><ul>${przyklady.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
      + `<p><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;border-radius:8px;text-decoration:none">Dopisz do profilu</a></p>`
      + '<p style="color:#667085">Bez logowania. Możesz też przyjąć propozycję w aplikacji — jest na górze listy przetargów.</p><p>Zespół PrzetargAI</p>',
  };
}
