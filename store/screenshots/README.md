# Zdjęcia promocyjne — App Store i Google Play

Wygenerowane 2026-07-10 dla wersji **1.0.1**. Prawdziwe zrzuty aplikacji
(konto demo na produkcji, feed BZP + TED, oceny AI) oprawione w marketingowe
kadry z polskimi hasłami.

## App Store Connect — `appstore/`
Pięć zrzutów **1284×2778** (6,5") — wgraj w kolejności 1→5:

1. `1-feed.png` — Tylko trafne przetargi (feed z filtrem)
2. `2-ocena.png` — Wiesz, dlaczego to pasuje (szczegóły + uzasadnienie AI)
3. `3-cpv.png` — Nie znasz kodów? Wybierz branżę (ściąga CPV)
4. `4-filtr.png` — Filtruj po trafności (ciemny motyw)
5. `5-plany.png` — 5 dopasowań dziennie za 0 zł (konto/plany)

> Gdyby App Store Connect zażądał rozmiaru 6,9" (1290×2796), zmień `FORMATY`
> w `zrodla/render.mjs` na `{ nazwa:'appstore', w:1290, h:2796 }` i uruchom ponownie.

## Google Play Console — `playstore/`
- `1-feed.png … 5-plany.png` — pięć zrzutów telefonu **1080×1920** (9:16)
- `feature-graphic-1024x500.png` — **grafika promocyjna** (wymagana, 1024×500)
- `icon-512.png` — **ikona aplikacji** 512×512, PNG, bez alfy, 153 KB (limit 1 MB)

## Jak wygenerować ponownie (narzędzia)
Źródła w `zrodla/`:
- `frame.html` — responsywny szablon kadru (parametry przez URL: theme/img/eyebrow/title/sub)
- `feature.html` — szablon grafiki promocyjnej Play
- `*.png` — surowe zrzuty aplikacji (804×1748, zrobione przez przeglądarkę z zoomem 2×)
- `render.mjs` / `feature.mjs` — skrypty renderujące (Playwright + cache Chromium)

Kroki: `python -m http.server 8091` w `zrodla/`, potem `node render.mjs` i `node feature.mjs`.
Nowe zrzuty aplikacji: uruchom podgląd web wskazany na produkcję, ustaw
`document.documentElement.style.zoom='2'` przed zrzutem (daje 2× gęstość).
