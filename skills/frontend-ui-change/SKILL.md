---
name: frontend-ui-change
description: "Conventions and checklist for changing the Svitlo React/Vite/Tailwind PWA (apps/web): Tailwind v4 CSS-first semantic tokens (bg-card, text-muted-foreground) defined in globals.css @theme (no tailwind.config.ts), api/client.ts as the single HTTP path, TanStack Query hooks, i18n uk/ru, navigation lists, charts (ECharts), map (Leaflet), PWA/service-worker behaviour, localStorage hooks, accessibility and bundle size. Use for any page/component/style change, 'element has no background/text invisible', empty Contacts page, timeline/graph bugs, language strings. Триггеры: компонент, страница, стили, tailwind, тема, прозрачный фон, перевод, i18n, график, таймлайн, PWA, кэш, Контакти."
---

# Frontend change (apps/web)

## Before you edit

1. Read the page and every component it renders; read `api/queries.ts` for the data it uses.
2. Run the token check: `python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .` — it lists semantic Tailwind classes that will silently generate **no CSS**.
   Missing tokens were the real cause of the transparent address dropdown and are the **first suspect** for "text invisible / no border / no background" (including the empty Contacts page).
3. Check git status / back up (`agent-discipline`).

## Rules

**Styling**
- Use semantic classes (`bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, …).
- Tailwind **v4, CSS-first**: tokens live in exactly **one** place — `src/styles/globals.css`:
  `@theme inline { --color-card: hsl(var(--card)); }` gives the classes, `:root` / `.dark` give the values.
  There is no `tailwind.config.*` and no `postcss.config.js` (the plugin is `@tailwindcss/vite`).
  A new token = one `--color-*` line in `@theme inline` + one `--*` value in `:root` **and** `.dark`.
  Verify with `check_tailwind_tokens.py` (it parses the `@theme` block).
- The palette is not invented here: it is a port of `grok-workspace/src/styles.css` (warm "paper" light
  theme + deep-green accent, green-tinted near-black dark theme). Values are HSL triplets converted from
  those HEX codes; both themes were checked against WCAG AA. Change kit colours in `globals.css` only.
- `@theme inline` also carries aliases of raw Tailwind shades (`--color-emerald-*`, `-lime-*`, `-amber-*`,
  `-red-*`, `-blue-*`) that point at theme tokens. They exist **only** because 8 status components still use
  those classes (`text-emerald-600 dark:text-emerald-400` now resolves to one token). New code uses semantic
  classes; delete the alias block once those components are migrated — it is debt, not a convention.
- v4 renamed v3 utilities: `shadow-sm`→`shadow-xs` (v3 `shadow`→v4 `shadow-sm`), `outline-none`→`outline-hidden`,
  `rounded-sm`→`rounded-xs`. The v4 default border colour is `currentColor`; `globals.css` restores
  `hsl(var(--border))` in `@layer base`.
- No inline colours or magic z-index as a workaround for a missing token. Fix the token.
  `container` and `z-60` are v4 `@utility` definitions in `globals.css` (v4 has no theme namespace for them).
- Test both themes (`class="dark"`) and 360 px width: this is a phone-first PWA used when the lights are out, often with a bad connection and low battery.
  If this session has no browser, take real screenshots instead of guessing:
  `node skills/frontend-ui-change/scripts/screenshot.mjs --mobile --mock-schedule --out /tmp/shots`
  (headless Chromium from the playwright cache via CDP, no dependencies; `--mock-schedule` intercepts
  `/api/v1/schedules` in the browser so a realistic graph can be checked without touching the DB or
  `SCHEDULE_DEMO`). It prints a DOM probe (hero colour/size, card bg/border) — compare those numbers with
  `globals.css`, do not eyeball-only.

**Data**
- Browser HTTP only through `src/api/client.ts` → hooks in `src/api/queries.ts`. No bare `fetch('/api/v1/…')` in pages (HomePage and ScheduleImportPage currently violate this; fix when you touch them).
- Query keys stable and filter-aware; `staleTime` 30–60 s for outage data (the backend refreshes every ~30 min).
- Business rules (category emergency/repair/regime, "is active", reliability) are computed by the **API**. Do not add regexes over reason texts in the UI. Use fields the API returns.
- Never keep `ADMIN_TOKEN` in `localStorage`/`sessionStorage`; admin screens should not be in the public navigation.

**Structure**
- Navigation items live in one array used by both `Sidebar` and `BottomNav` (today they are duplicated — change both, or better, extract `NAV_ITEMS`).
- Prefer `components/ui/Tabs` over hand-made tab switchers (keyboard + `role="tab"`).
- Lists/timelines use the entity **id** as React key and as row identity, never a display label.
- Relative imports keep the `.js` extension; alias `@/` → `src/`.
- Format with Prettier (`.prettierrc`: singleQuote, printWidth 100, trailingComma all, semi). Do not leave one-line "minified" source files.

**i18n**
- User-visible strings via `t('namespace.key')`; add the key to **both** `i18n/uk.json` and `i18n/ru.json`. No new hardcoded Ukrainian in JSX. Namespaces: `nav, status, outages, incidents, contacts, myAddress, common, charts, streets`.
- Server-provided texts (reasons, grid messages) are Ukrainian only; do not pretend they are translated.

**PWA**
- `vite-plugin-pwa`; API uses `NetworkFirst` (5 s timeout). After a rebuild users may see an old bundle: hard reload / `docker compose up -d --force-recreate web`. Never "fix" this in code.
- Always show data freshness (`LastUpdated`, `dataStale`) — stale data presented as live is the worst failure for this product.
- Show `demo:true` data with an unmistakable badge, or better, not at all in production.

**Performance**
- Import ECharts modules from `echarts/core` (tree-shake), lazy-load the map and chart tabs with `React.lazy`. Budget: first-screen JS ≲ 250 KB gzip.

**Accessibility**
- Interactive elements are `button`/`a`; combobox follows the ARIA combobox pattern (`role="combobox"`, `aria-expanded`, `aria-activedescendant`); colour is not the only signal for outage state (add text/icon); touch targets ≥ 44 px.

## Verify

```bash
pnpm --filter @svitlo/web lint
pnpm --filter @svitlo/web test
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .
pnpm --filter @svitlo/web build      # check bundle size in the output
```
Then open the page after a hard reload (Ctrl+Shift+R) in light and dark mode at phone width and describe what you actually saw.

## Known traps in this codebase

- Timeline row labels like `дд.мм · причина` can collide; use `event.id`.
- `useMyQueues.addQueue` supports only `'2/2'`.
- `AddressCombobox` contains inline-colour/z-index workarounds from before the tokens existed; remove them after confirming the tokens work.
- `lib/outage-location.ts` has a hardcoded city-coordinates table: map points are approximate, label them so.
