# Design Spec — OpenOrmus Design System Preview Page

**Date:** 2026-05-14  
**Status:** Approved  
**Branch:** `worktree-feature-preview-design-system`

---

## Context

`OpenOrmus/` contains a complete standalone design system (tokens, ~13 primitives, composite patterns) built as a browser-only Babel/React prototype — no build, no TypeScript, no shadcn. The `frontend/` workspace uses shadcn `base-nova` style (on `@base-ui/react`) but only has the default neutral palette and a single generated `Button` component.

The goal is to:
1. Unify OpenOrmus tokens as the **single source of truth** for shadcn's semantic CSS variables, so every shadcn component inherits the OpenOrmus look without per-component overrides.
2. Port all 13+ primitives as proper TypeScript/shadcn components in `components/ui/`.
3. Ship a `/preview` route that acts as the living design system reference for the entire app.

---

## Architecture

### Token Layer (globals.css)

One CSS file, three ordered `:root` blocks:

```
:root (1) — raw OpenOrmus tokens
  --bg, --ink, --accent-oo, --signal-*, --shadow-*, --glass-*, --t-*, --d-*, …

:root (2) — shadcn semantic mapping
  --background   → var(--bg)
  --primary      → var(--ink-panel)
  --accent       → var(--accent-oo)
  … (full mapping table below)

@theme inline — Tailwind v4 bridge
  --color-background → var(--background)
  --color-ink-panel  → var(--ink-panel)   ← extra OO-only utilities
  --font-sans        → var(--font-geist-sans)  ← fixes existing bug
  --font-editorial   → var(--font-instrument-serif)
```

This order is required for Tailwind v4: raw tokens must be declared before the semantic layer references them, which must be declared before `@theme inline` parses them.

**Naming decision:** OpenOrmus's `--accent` (oklch 262°) is stored as `--accent-oo` to avoid shadowing shadcn's semantic `--accent`. The semantic var `--accent` then points to `--accent-oo`. Both names coexist cleanly.

### Semantic Mapping Table

| shadcn var | OpenOrmus source | Rationale |
|---|---|---|
| `--background` | `--bg` `oklch(0.965 0.006 85)` | Warm off-white app background |
| `--foreground` | `--ink` `oklch(0.175 0.012 270)` | Default text |
| `--card` | `--surface-1` `oklch(0.990 0.004 85)` | Card paper surface |
| `--card-foreground` | `--ink` | |
| `--popover` | `--surface-2` `oklch(1.000 0.002 85)` | Brighter for floating panels |
| `--popover-foreground` | `--ink` | |
| `--primary` | `--ink-panel` `oklch(0.165 0.012 270)` | Dark ink CTA (OpenOrmus primary action) |
| `--primary-foreground` | `--on-ink` `oklch(0.97 0.004 85)` | Warm white on dark |
| `--secondary` | `--surface-1` | Light-surface button |
| `--secondary-foreground` | `--ink` | |
| `--muted` | `--bg-tinted` `oklch(0.955 0.008 85)` | Row stripes, muted areas |
| `--muted-foreground` | `--ink-mute` `oklch(0.58 0.010 270)` | Placeholder, secondary labels |
| `--accent` | `--accent-oo` `oklch(0.52 0.20 262)` | Electric ultramarine |
| `--accent-foreground` | `oklch(1 0 0)` | Pure white on accent |
| `--destructive` | `--signal-flag` `oklch(0.56 0.20 25)` | Reddish danger signal |
| `--destructive-foreground` | `oklch(1 0 0)` | |
| `--border` | `--hair` `oklch(0.92 0.005 85)` | Default border |
| `--input` | `--hair-strong` `oklch(0.86 0.005 85)` | Form input border |
| `--ring` | `--accent-oo` | Focus ring is ultramarine |
| `--radius` | `12px` (= `--r-md`) | Drives all `--radius-*` scale |

`sidebar-*` and `chart-*` vars are left untouched (neutral palette) — they are unused in the preview and aligning them is out of scope.

### Font Setup (layout.tsx)

Three fonts via `next/font/google`:
- `Geist` → `--font-geist-sans` (already loaded, but `--font-sans` Tailwind bridge was broken → fix)
- `Geist_Mono` → `--font-geist-mono` (already loaded)
- `Instrument_Serif` → `--font-instrument-serif` (new — italic weight 400 only; used exclusively for "Ormus" wordmark, scene markers, stage directions, quoted text — **never** for UI controls)

All three vars attached to `<html>` className.

### Component Layer

Three tiers:

| Tier | Method | Files |
|---|---|---|
| shadcn standard primitives | `bunx shadcn@latest add` | `card`, `input`, `textarea`, `label`, `badge`, `separator` |
| Custom primitives (OpenOrmus-specific) | Hand-written, same `cva + @base-ui/react + cn` pattern as `button.tsx` | `monogram`, `ring`, `chip`, `segmented`, `tag`, `kbd`, `icon-button`, `field-label` |
| Domain composite demos | Pure display, mock data, colocated in `app/preview/_components/` | character-card-demo, screenplay-block, emotion-dots, sheet-field, cast-state, session-row, app-nav-demo |

### Route Structure

```
frontend/app/preview/
├── page.tsx                      ← server component, no auth gating
└── _components/
    ├── preview-nav.tsx           ← "use client" — sticky TOC with anchor scroll
    ├── section.tsx               ← shared section wrapper (kicker + hairline separator)
    ├── color-section.tsx
    ├── typography-section.tsx
    ├── spacing-section.tsx
    ├── radii-section.tsx
    ├── elevation-section.tsx
    ├── motion-section.tsx
    ├── buttons-section.tsx
    ├── inputs-section.tsx        ← "use client" (Segmented/Chip state)
    ├── badges-section.tsx
    ├── monogram-showcase.tsx
    ├── character-card-demo.tsx
    ├── screenplay-block.tsx
    ├── emotion-dots.tsx
    ├── sheet-field.tsx
    ├── cast-state.tsx
    ├── session-row.tsx
    └── app-nav-demo.tsx
```

Page layout: 2-column grid (220px sticky TOC | 1fr content), max-w-1280px, no auth check.

Hero: `Open` (Geist regular) + `Ormus` (`<em class="font-editorial">`) + meta chip "DESIGN SYSTEM".

Sections numbered: 01 Colors → 02 Typography → 03 Spacing → 04 Radii → 05 Elevation → 06 Motion → [prism hairline] → 07 Buttons → 08 Inputs → 09 Badges & Tags → 10 Monograms → [prism hairline] → 11 Character Card → 12 Screenplay → 13 Sheet Field → 14 Cast State → 15 Emotion Dots → 16 Session Row → 17 App Nav.

---

## Component Designs

### Primitives

**Monogram** — `<Monogram name size? shape? status? ring? flat? />`
- `hashHue(name)` ported verbatim from `OpenOrmus/components.jsx:110-114` — deterministic, collision-safe.
- 6 shapes: `rounded | circle | squircle | hexagon | shield | diamond` via `clip-path` constants.
- Inline `style` is the **one sanctioned exception** to the no-inline-colors rule because `background` is a per-instance computed gradient (not a static token).
- Everything else (status dot, ring shadow, grid overlay) uses Tailwind utilities.

**Ring** — `<Ring value size? stroke? color? track? />` — stateless SVG. `color` defaults to `var(--accent-oo)`.

**Chip** — `<Chip active? icon? />` — `<button type="button">` with `aria-pressed` + `data-state="on|off"`. CVA handles active state via `data-[state=on]:bg-ink-panel data-[state=on]:text-on-ink`.

**Segmented** — `<Segmented<T> value onValueChange options size? />` — controlled generic component. No external dep.

**Tag** — `<Tag tone? />` — read-only mono pill. Tones: `neutral | accent | on-ink`.

**Kbd** — minimal wrapper, font-mono 10.5px, inset shadow. No CVA needed.

**IconButton** — uses `@base-ui/react/button`, CVA variants `ghost | bordered | on-ink`, `aria-label` required.

**FieldLabel** — `<FieldLabel htmlFor? hint?>` — renders `<label>` with `.t-meta` class; hint right-aligned.

### Anti-redundancy Rules (enforced)

1. Colors from CSS vars only — no `oklch(...)` in `.tsx` files.
2. One exception: `Monogram` computed gradient (dynamic per-instance value).
3. All custom utilities (`.t-meta`, `.hair-prism`, `.glass`, `.grid-field`, `.scan-field`, `.shadow-glow`, `.shadow-glow-strong`, `.shadow-inset`) defined **once** in `@layer utilities` in `globals.css`.
4. Component variants live in `cva()` inside each component's `.tsx`. No `.module.css`. No `.oo-*` classes in TSX.
5. Radii via Tailwind `rounded-*` — resolves through `--radius` scale.
6. Fonts via Tailwind utilities (`font-sans`, `font-mono`, `font-editorial`) — no `style={{ fontFamily }}`.
7. No barrel `index.ts` in `components/ui/` — named imports per file (matches existing `button.tsx`).

---

## Data Flow

The `/preview` page is purely **static + display**. No database queries, no authentication, no network calls at runtime.

- `page.tsx` is a Next.js server component that renders the full page tree.
- Only the sections that need user interaction (`inputs-section.tsx` for Segmented/Chip, `preview-nav.tsx` for anchor scroll) are client components (`"use client"`).
- All composite demo components receive mock data as inline constants (no props from page).
- No `useState` except inside the two client components above.

---

## Error Handling

- `/preview` has no auth gate — no redirect logic, no `supabase.auth.getUser()`.
- The `Monogram` component handles empty `name` gracefully: if split produces no segments, it renders "?" as initials.
- `Ring` clamps `value` to `[0, 100]` before computing dash offset to prevent NaN in SVG path.
- `Segmented` requires at least 2 options — validated by prop type (array min enforced by usage, not runtime guard).
- TypeScript `exactOptionalPropertyTypes: true` enforced throughout: all optional props use `prop?: T`, spread with conditional object when forwarding.

---

## Testing

### Automated (baseline, must pass)

```bash
bun run typecheck    # zero new errors introduced
bun run --cwd frontend lint
```

Note: 4 pre-existing typecheck errors in `app/api/characters/route.ts`, `components/characters/ImportStep.tsx`, and `lib/prompts/__tests__/` exist in the baseline and are out of scope.

### Visual (manual)

1. `bun run dev:frontend` → open `http://localhost:3000/preview`
2. **Background** is warm off-white — not pure white, not zinc.
3. **Hero wordmark**: "Open" in Geist regular, "Ormus" in Instrument Serif italic.
4. **Button default**: ink-panel dark bg + warm off-white text.
5. **Button destructive**: signal-flag red tone.
6. **Input focus**: ultramarine 2px ring + 2px offset.
7. **Monogram**: hue varies by name; all 6 shapes clip correctly.
8. **Console**: zero errors, zero React hydration warnings.

### Visual diff against source

Open `OpenOrmus/OpenOrmus Design System.html` side-by-side with `/preview`:
- Surface warmth must match.
- Accent hue must match (electric ultramarine — not too cyan, not too violet).
- `hashHue("Sherlock Holmes")` must produce the same gradient in both (proves port correctness).

### Smoke test existing routes

`/`, `/chat`, `/conversations` must **not crash** after token swap. These pages use hardcoded `bg-zinc-*` classes (not semantic tokens) so they continue to compile and render — they will look visually misaligned with the new system, but fixing them is a separate task.

---

## Risks

| Risk | Mitigation |
|---|---|
| `bunx shadcn add` may fall back to `default` (Radix) for some primitives | Acceptable — Radix and Base UI don't conflict. Review generated files, don't manually "fix" |
| `exactOptionalPropertyTypes` rejections on new components | Use `prop?: T` throughout; use conditional spread `{...(x ? { x } : {})}` when forwarding |
| `@theme inline` requires tokens in `:root` before referencing them | Enforced by ordering: raw tokens → semantic mapping → `@theme inline` |
| Existing pages (`/`, `/chat`) use `bg-zinc-*` hardcoded → visual mismatch after token swap | Known, documented, out of scope. Pages will still render. |
| `lucide-react@^1.14` — real package, not a fork | Standard named imports. Override `strokeWidth={1.5}` per icon for visual fidelity with OO design |

---

## Out of Scope

- Migrating existing pages (`/`, `/chat`, `/conversations`) to semantic tokens.
- Dark mode toggle — design system is intentionally light-only.
- Aligning `sidebar-*` / `chart-*` vars to OpenOrmus palette.
- Any changes to `mcp_server/` or Prisma schema.
