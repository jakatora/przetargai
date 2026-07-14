# Landing v3 — PrzetargAI (design system + 21st.dev)

Próba połączenia dwóch nowych narzędzi: **skilla `ui-ux-pro-max`** (design system) i **MCP `21st`**
(katalog komponentów React/shadcn). Nadal czysty HTML+CSS, zero build stepu — **v1 i v2 nietknięte**.

## Podział ról

| Narzędzie | Co dało |
|---|---|
| `ui-ux-pro-max` (skill) | Fundament: wzorzec **Trust & Authority**, tokeny (granat `#0f172a` + akcent `#0369a1`), typografia Space Grotesk / DM Sans, tryb ciemny, anty-wzorce (zakaz fioletowo-różowych gradientów „AI"). |
| `21st` (MCP) | Konkretne **układy sekcji**: cennik i CTA hero. |

## Co konkretnie wzięte z 21st

**Cennik — @rlzee „Pricing Section" (demo id 2740).** Kluczowy pomysł: oba plany w **jednym
kontenerze**, plan płatny na wypełnionej powierzchni i szerszy (`1fr 1.15fr`), a zamiast powtarzania
pozycji z darmowego — separator **„Wszystko z planu Free, plus:"** i siatka funkcji 2-kolumnowa.
Plany przestają konkurować jak dwie równorzędne karty; czytają się jako „podstawa" → „pełna wersja".
To jedyna rzecz, która realnie poprawiła v2.

**Hero — @uniquesonu „HeroSection Enterprise Dual CTAs" (demo id 8156).** Wzięta strzałka na
głównym CTA (mikroruch przy hoverze, wyłączany przez `prefers-reduced-motion`).

### Czego z 21st NIE wzięto (świadomie)

- **„Trusted by teams at Fortune 500 companies"** z hero — PrzetargAI nie ma takich klientów.
  Zmyślony dowód społeczny to fabrykacja, nie design. Wróci, gdy będą prawdziwe referencje.
- **Wyśrodkowany hero** — nasz układ dwukolumnowy z podglądem feedu pokazuje produkt, co dla
  narzędzia B2B jest silniejsze niż sam nagłówek.
- Kod React/shadcn 1:1 — landing jest statyczny, więc przeniesiono **układ i hierarchię**, nie kod.

## Limit 21st (ważne)

Plan free = **2 pobrania kodu komponentu (`get_component`) na dobę**. `search` i `get_theme`
są darmowe. Te 2 pobrania zostały tu zużyte (2026-07-12). Katalog **motywów** jest ubogi —
na zapytania o granat/niebieski nie zwrócił nic sensownego, więc tokeny zostają ze skilla.

## Zweryfikowane Playwrightem

0 błędów konsoli · 1× H1 · brak martwych kotwic · brak overflow (375/1280) · na mobile plan płatny
pierwszy, siatka funkcji składa się do 1 kolumny · kontrast AA w obu motywach
(najgorszy wynik: 6,05:1 w ciemnym).

Pułapki odziedziczone z v2 (nie regresować): `--color-on-accent` zamiast `#fff` na CTA;
`FAQPage` w JSON-LD to ręczna kopia sekcji FAQ. Szczegóły w `../v2/README.md`.

## Podmiana na produkcję

Jak w v2 (`../v2/README.md` §Podmiana), tylko ze ścieżką `v3/`.
**NIE usuwać** ze stopki zastrzeżenia o braku powiązania z instytucją państwową (wymóg Google Play).
