# Landing v2 — PrzetargAI

Nowa warstwa wizualna landingu, zbudowana na design systemie wygenerowanym przez skill
`ui-ux-pro-max` (globalny, `~/.claude/skills/ui-ux-pro-max`). **Landing v1 (`../index.html`)
jest nietknięty i wciąż działa** — v2 to alternatywa do podmiany.

## Design system (źródło prawdy)

Pełny opis: `design-system/przetargai/MASTER.md` (wygenerowany, nie edytować ręcznie —
przegenerować poleceniem niżej). Skrót:

| | |
|---|---|
| Wzorzec strony | **Trust & Authority + Conversion** — hero (wiarygodność) → dowód/liczby → rozwiązanie → jawny cennik |
| Styl | Enterprise SaaS (granat + jeden akcent) |
| Kolory | primary `#0f172a`, accent/CTA `#0369a1`, tło `#f8fafc` |
| Typografia | Space Grotesk (nagłówki) / DM Sans (tekst) |
| **Anty-wzorce** | **fioletowo-różowe gradienty „AI"** (obniżają wiarygodność produktu urzędowo-finansowego), zabawny ton, ukryty cennik |

Przegenerowanie / nowa podstrona:

```bash
python ~/.claude/skills/ui-ux-pro-max/scripts/search.py \
  "B2B SaaS public tender monitoring AI tool for small construction companies, trust professional" \
  --design-system --persist -p "PrzetargAI" --variance 5 --motion 4 --density 4
```

## Czym różni się od v1

- **Ikony wektorowe (SVG, styl Lucide) zamiast emoji** 🎯🔔📊⚡ — emoji renderują się różnie
  na każdej platformie i nie da się nimi sterować tokenami. To reguła #1 skilla.
- **Wyeksponowana funkcja „Wyjaśnij ten przetarg"** (D-052) — największa luka konkurencji
  wg `reference_przetargai_konkurencja`, a w v1 nie było o niej ani słowa.
- Dodane: TED (przetargi unijne), przypomnienia o terminie, Zapisane, wyszukiwarka.
- **Tryb ciemny** (`prefers-color-scheme`) — spójny z aplikacją mobilną (D-037).
- Cennik: na mobile plan płatny wyświetla się pierwszy (`order: -1`).

## Zweryfikowane Playwrightem

0 błędów konsoli · 1× H1 · brak martwych kotwic · brak poziomego overflow (375/1280) ·
menu mobilne (aria-expanded, Escape, klik poza) · wszystkie CTA ≥44 px ·
kontrast AA w obu motywach.

**Pułapki złapane przy budowie (nie regresować):**
- `.btn--primary` musi używać `--color-on-accent`, NIE `#fff` — biały tekst na jasnym błękicie
  trybu ciemnego daje **2,14:1** (próg AA = 4,5). Z tokenem: 5,93 jasny / 8,74 ciemny.
- Hero na mobile: podgląd aplikacji **pod** nagłówkiem. `order: -1` na `.hero__visual`
  spychał H1 i CTA poniżej pierwszego ekranu.
- Blok `FAQPage` w JSON-LD jest ręczną kopią sekcji FAQ — przy zmianie pytań **zmień oba miejsca**
  (ta sama pułapka co w v1).

## Podmiana v2 → produkcja

```bash
cd landing
mv index.html index-v1.html.bak && mv styles.css styles-v1.css.bak
cp v2/index.html . && cp v2/styles.css .
```

Uwaga: v2 ma własny hamburger w `<script>` inline, więc `nav.js` z v1 nie jest potrzebny.
Zachowaj `og-image.png`, `robots.txt`, `sitemap.xml`, `404.html`, `pobierz.html`,
`regulamin.html`, `polityka-prywatnosci.html`, `upgrade*` i `config.js` — v2 ich nie zmienia
i linkuje do nich tak samo.

**NIE usuwać** z stopki zastrzeżenia o braku powiązania z instytucją państwową (wymóg Google Play,
„twierdzenia wprowadzające w błąd") ani linków do oficjalnych źródeł BZP/TED.
