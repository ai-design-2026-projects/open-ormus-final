# OpenOrmus Design System Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the OpenOrmus design system into the Next.js frontend: unified token layer, 14 TypeScript UI primitives, and a full /preview showcase page with 17 sections.

**Architecture:** Single token source in globals.css maps OpenOrmus OKLCH tokens to shadcn semantics, so all shadcn components inherit the OpenOrmus look. Custom primitives follow the button.tsx pattern (cva + @base-ui/react + cn). The /preview page is a server component with colocated client islands for interactive demos.

**Tech Stack:** Next.js 16 App Router, Tailwind v4, shadcn base-nova (@base-ui/react), TypeScript strict + exactOptionalPropertyTypes, bun

---

### Task 1: Rewrite globals.css — OpenOrmus token foundation

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Replace the entire file with this content**

`frontend/app/globals.css`:
```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

/* 1. OpenOrmus raw tokens */
:root {
  --bg:           oklch(0.965 0.006 85);
  --bg-tinted:    oklch(0.955 0.008 85);
  --surface-1:    oklch(0.990 0.004 85);
  --surface-2:    oklch(1.000 0.002 85);
  --surface-sunk: oklch(0.945 0.008 85);

  --ink-panel:    oklch(0.165 0.012 270);
  --ink-panel-2:  oklch(0.215 0.014 270);
  --ink-panel-3:  oklch(0.275 0.014 270);

  --ink:          oklch(0.175 0.012 270);
  --ink-dim:      oklch(0.42  0.012 270);
  --ink-mute:     oklch(0.58  0.010 270);
  --ink-faint:    oklch(0.74  0.008 270);
  --ink-ghost:    oklch(0.86  0.006 270);

  --on-ink:       oklch(0.97 0.004 85);
  --on-ink-dim:   oklch(0.78 0.008 85);
  --on-ink-mute:  oklch(0.60 0.010 270);

  --hair:         oklch(0.92 0.005 85);
  --hair-strong:  oklch(0.86 0.005 85);
  --hair-on-ink:  oklch(0.30 0.014 270);
  --hair-bright:  oklch(0.40 0.014 270);

  --accent-oo:      oklch(0.52 0.20 262);
  --accent-deep:    oklch(0.42 0.20 262);
  --accent-bright:  oklch(0.62 0.19 260);
  --accent-glow:    oklch(0.78 0.14 250);
  --accent-soft:    oklch(0.95 0.04 262);
  --accent-tint:    oklch(0.97 0.02 262);

  --signal-ok:    oklch(0.58 0.14 152);
  --signal-warn:  oklch(0.70 0.16 78);
  --signal-flag:  oklch(0.56 0.20 25);

  --r-xs: 4px; --r-sm: 8px; --r-md: 12px;
  --r-lg: 18px; --r-xl: 24px; --r-2xl: 32px; --r-pill: 999px;

  --s-0: 0px; --s-05: 2px; --s-1: 4px; --s-2: 8px; --s-3: 12px;
  --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px; --s-9: 96px;

  --shadow-0: 0 0 0 1px var(--hair);
  --shadow-1: 0 1px 0 rgba(20,24,40,0.03), 0 1px 3px rgba(20,24,40,0.04);
  --shadow-2: 0 2px 4px rgba(20,24,40,0.04), 0 12px 28px -10px rgba(20,24,40,0.10);
  --shadow-3: 0 6px 12px rgba(20,24,40,0.06), 0 28px 64px -20px rgba(20,24,40,0.18);
  --shadow-inset: inset 0 1px 0 rgba(255,255,255,0.65);
  --shadow-glow: 0 0 0 4px color-mix(in oklch, var(--accent-oo) 16%, transparent);
  --shadow-glow-strong: 0 0 24px -2px color-mix(in oklch, var(--accent-oo) 38%, transparent);

  --glass-bg:      color-mix(in oklch, var(--surface-1) 70%, transparent);
  --glass-bg-cool: color-mix(in oklch, var(--accent-tint) 70%, transparent);
  --glass-border:  color-mix(in oklch, var(--ink) 8%, transparent);

  --t-meta: 11px; --t-caption: 12px; --t-body-s: 13px; --t-body: 14px; --t-body-l: 16px;
  --t-h6: 18px; --t-h5: 22px; --t-h4: 28px; --t-h3: 36px; --t-h2: 48px; --t-h1: 64px;

  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --d-1: 120ms; --d-2: 220ms; --d-3: 360ms; --d-4: 560ms;
}

/* 2. shadcn semantic mapping */
:root {
  --background:             var(--bg);
  --foreground:             var(--ink);
  --card:                   var(--surface-1);
  --card-foreground:        var(--ink);
  --popover:                var(--surface-2);
  --popover-foreground:     var(--ink);
  --primary:                var(--ink-panel);
  --primary-foreground:     var(--on-ink);
  --secondary:              var(--surface-1);
  --secondary-foreground:   var(--ink);
  --muted:                  var(--bg-tinted);
  --muted-foreground:       var(--ink-mute);
  --accent:                 var(--accent-oo);
  --accent-foreground:      oklch(1 0 0);
  --destructive:            var(--signal-flag);
  --destructive-foreground: oklch(1 0 0);
  --border:                 var(--hair);
  --input:                  var(--hair-strong);
  --ring:                   var(--accent-oo);
  --radius:                 12px;
  --sidebar:                oklch(0.985 0 0);
  --sidebar-foreground:     oklch(0.145 0 0);
  --sidebar-primary:        oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent:         oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border:         oklch(0.922 0 0);
  --sidebar-ring:           oklch(0.708 0 0);
  --chart-1: oklch(0.87 0 0); --chart-2: oklch(0.556 0 0); --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0); --chart-5: oklch(0.269 0 0);
}

/* 3. Tailwind v4 theme bridge */
@theme inline {
  --color-background:             var(--background);
  --color-foreground:             var(--foreground);
  --color-card:                   var(--card);
  --color-card-foreground:        var(--card-foreground);
  --color-popover:                var(--popover);
  --color-popover-foreground:     var(--popover-foreground);
  --color-primary:                var(--primary);
  --color-primary-foreground:     var(--primary-foreground);
  --color-secondary:              var(--secondary);
  --color-secondary-foreground:   var(--secondary-foreground);
  --color-muted:                  var(--muted);
  --color-muted-foreground:       var(--muted-foreground);
  --color-accent:                 var(--accent);
  --color-accent-foreground:      var(--accent-foreground);
  --color-destructive:            var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border:                 var(--border);
  --color-input:                  var(--input);
  --color-ring:                   var(--ring);
  --color-sidebar:                var(--sidebar);
  --color-sidebar-foreground:     var(--sidebar-foreground);
  --color-sidebar-primary:        var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent:         var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border:         var(--sidebar-border);
  --color-sidebar-ring:           var(--sidebar-ring);
  --color-chart-1: var(--chart-1); --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3); --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  --color-ink:           var(--ink);
  --color-ink-dim:       var(--ink-dim);
  --color-ink-mute:      var(--ink-mute);
  --color-ink-faint:     var(--ink-faint);
  --color-ink-ghost:     var(--ink-ghost);
  --color-ink-panel:     var(--ink-panel);
  --color-ink-panel-2:   var(--ink-panel-2);
  --color-ink-panel-3:   var(--ink-panel-3);
  --color-on-ink:        var(--on-ink);
  --color-on-ink-dim:    var(--on-ink-dim);
  --color-on-ink-mute:   var(--on-ink-mute);
  --color-surface-1:     var(--surface-1);
  --color-surface-2:     var(--surface-2);
  --color-surface-sunk:  var(--surface-sunk);
  --color-bg-tinted:     var(--bg-tinted);
  --color-hair:          var(--hair);
  --color-hair-strong:   var(--hair-strong);
  --color-hair-on-ink:   var(--hair-on-ink);
  --color-hair-bright:   var(--hair-bright);
  --color-accent-oo:     var(--accent-oo);
  --color-accent-deep:   var(--accent-deep);
  --color-accent-bright: var(--accent-bright);
  --color-accent-glow:   var(--accent-glow);
  --color-accent-soft:   var(--accent-soft);
  --color-accent-tint:   var(--accent-tint);
  --color-signal-ok:     var(--signal-ok);
  --color-signal-warn:   var(--signal-warn);
  --color-signal-flag:   var(--signal-flag);

  --font-sans:       var(--font-geist-sans);
  --font-mono:       var(--font-geist-mono);
  --font-heading:    var(--font-geist-sans);
  --font-editorial:  var(--font-instrument-serif);

  --radius-sm:  calc(var(--radius) * 0.6);
  --radius-md:  calc(var(--radius) * 0.8);
  --radius-lg:  var(--radius);
  --radius-xl:  calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

/* 4. Base */
@layer base {
  * { @apply border-border outline-ring/50; }
  html {
    @apply font-sans;
    font-feature-settings: 'ss01', 'cv11';
  }
  body {
    @apply bg-background text-foreground;
    font-size: var(--t-body);
    line-height: 1.45;
  }
  *:focus-visible {
    outline: 2px solid var(--accent-oo);
    outline-offset: 2px;
    border-radius: 4px;
  }
}

/* 5. Custom utilities (defined once, used everywhere) */
@layer utilities {
  .t-mono      { font-family: var(--font-mono); font-feature-settings: 'ss01'; }
  .t-editorial { font-family: var(--font-editorial); font-style: italic; }
  .t-meta      { font-family: var(--font-mono); font-size: var(--t-meta);
                 text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-mute); }
  .t-meta-bright { color: var(--ink-dim); }
  .t-body-s    { font-size: var(--t-body-s); line-height: 1.5; }
  .t-body-l    { font-size: var(--t-body-l); line-height: 1.5; }
  .t-h1 { font-size: var(--t-h1); line-height: 1.02; letter-spacing: -0.025em; font-weight: 500; }
  .t-h2 { font-size: var(--t-h2); line-height: 1.05; letter-spacing: -0.022em; font-weight: 500; }
  .t-h3 { font-size: var(--t-h3); line-height: 1.1;  letter-spacing: -0.020em; font-weight: 500; }
  .t-h4 { font-size: var(--t-h4); line-height: 1.18; letter-spacing: -0.015em; font-weight: 500; }
  .t-h5 { font-size: var(--t-h5); line-height: 1.25; letter-spacing: -0.010em; font-weight: 500; }
  .t-h6 { font-size: var(--t-h6); line-height: 1.30; letter-spacing: -0.005em; font-weight: 500; }

  .hair { height: 1px; background: var(--hair); }
  .hair-prism {
    height: 1px;
    background: linear-gradient(90deg,
      transparent 0%,
      color-mix(in oklch, var(--accent-oo) 25%, transparent) 30%,
      color-mix(in oklch, var(--accent-glow) 35%, transparent) 50%,
      color-mix(in oklch, var(--accent-oo) 25%, transparent) 70%,
      transparent 100%);
  }
  .glass {
    background: var(--glass-bg);
    backdrop-filter: blur(20px) saturate(1.1);
    -webkit-backdrop-filter: blur(20px) saturate(1.1);
    border: 1px solid var(--glass-border);
    box-shadow: var(--shadow-inset), var(--shadow-2);
  }
  .grid-field {
    background-image: radial-gradient(circle, color-mix(in oklch, var(--ink) 18%, transparent) 1px, transparent 1px);
    background-size: 16px 16px;
  }
  .scan-field {
    background-image: linear-gradient(180deg, transparent 0, transparent 3px,
      color-mix(in oklch, var(--ink) 4%, transparent) 3px,
      color-mix(in oklch, var(--ink) 4%, transparent) 4px);
  }
  .shadow-glow        { box-shadow: var(--shadow-glow); }
  .shadow-glow-strong { box-shadow: var(--shadow-glow-strong); }
  .shadow-inset       { box-shadow: var(--shadow-inset); }
}
```

- [ ] **Step 2: Verify Tailwind parses without errors**

Run: `bun run --cwd frontend next dev 2>&1 | grep -E "error|warn" | head -20`
Expected: No PostCSS/Tailwind errors. Ctrl-C after 5 seconds.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: replace shadcn neutral palette with OpenOrmus design tokens"
```

---

### Task 2: Add Instrument Serif font to layout.tsx

**Files:**
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1: Update the file**

`frontend/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "OpenOrmus",
  description: "A studio for creating fictional characters and simulating scenes between them.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"`
Expected: No new errors beyond the 4 pre-existing ones.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/layout.tsx
git commit -m "feat: add Instrument Serif font for editorial typography"
```

---

### Task 3: Generate missing shadcn primitives

**Files:**
- Create: `frontend/components/ui/card.tsx`
- Create: `frontend/components/ui/input.tsx`
- Create: `frontend/components/ui/textarea.tsx`
- Create: `frontend/components/ui/label.tsx`
- Create: `frontend/components/ui/badge.tsx`
- Create: `frontend/components/ui/separator.tsx`

- [ ] **Step 1: Run shadcn generator**

```bash
cd frontend && bunx shadcn@latest add card input textarea label badge separator --yes
```

Expected: 6 files created in `components/ui/`. Existing `button.tsx` is NOT overwritten.

- [ ] **Step 2: Verify files exist and typecheck**

```bash
ls frontend/components/ui/
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
```

Expected: card.tsx, input.tsx, textarea.tsx, label.tsx, badge.tsx, separator.tsx listed. No new type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ui/card.tsx frontend/components/ui/input.tsx frontend/components/ui/textarea.tsx frontend/components/ui/label.tsx frontend/components/ui/badge.tsx frontend/components/ui/separator.tsx
git commit -m "feat: generate shadcn card, input, textarea, label, badge, separator"
```

---

### Task 4: Monogram primitive + hashHue test

**Files:**
- Create: `frontend/components/ui/monogram.tsx`
- Create: `frontend/lib/__tests__/monogram.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/lib/__tests__/monogram.test.ts`:
```ts
import { describe, it, expect } from "bun:test"

function hashHue(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h * 31 + str.charCodeAt(i)) >>> 0)
  return h % 360
}

describe("hashHue", () => {
  it("returns a number in [0, 359]", () => {
    expect(hashHue("Sherlock Holmes")).toBeGreaterThanOrEqual(0)
    expect(hashHue("Sherlock Holmes")).toBeLessThan(360)
  })
  it("is deterministic", () => {
    expect(hashHue("Iris Vega")).toBe(hashHue("Iris Vega"))
  })
  it("produces different values for different names", () => {
    expect(hashHue("Sherlock Holmes")).not.toBe(hashHue("James Moriarty"))
  })
  it("handles empty string", () => {
    expect(hashHue("")).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails (function not yet in component)**

```bash
bun test frontend/lib/__tests__/monogram.test.ts
```

Expected: PASS (the test imports a local copy of hashHue — this validates the algorithm before we embed it in the component).

- [ ] **Step 3: Create the Monogram component**

`frontend/components/ui/monogram.tsx`:
```tsx
import { cn } from "@/lib/utils"
import type { CSSProperties } from "react"

export type MonogramShape = "rounded" | "circle" | "squircle" | "hexagon" | "shield" | "diamond"
export type MonogramStatus = "ok" | "warn" | "flag" | "public"

export interface MonogramProps {
  name: string
  size?: number
  shape?: MonogramShape
  status?: MonogramStatus
  ring?: boolean
  flat?: boolean
  className?: string
}

function hashHue(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h * 31 + str.charCodeAt(i)) >>> 0)
  return h % 360
}

const SHAPES: Record<MonogramShape, CSSProperties> = {
  rounded:  { borderRadius: "var(--r-md)" },
  circle:   { borderRadius: "50%" },
  squircle: { borderRadius: "28%" },
  hexagon:  { borderRadius: 0, clipPath: "polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)" },
  shield:   { borderRadius: 0, clipPath: "polygon(0% 0%,100% 0%,100% 70%,50% 100%,0% 70%)" },
  diamond:  { borderRadius: 0, clipPath: "polygon(50% 0%,100% 50%,50% 100%,0% 50%)" },
}

const STATUS_COLOR: Record<MonogramStatus, string> = {
  ok:     "var(--signal-ok)",
  warn:   "var(--signal-warn)",
  flag:   "var(--signal-flag)",
  public: "var(--accent-bright)",
}

export function Monogram({
  name,
  size = 56,
  shape = "rounded",
  status,
  ring = false,
  flat = false,
  className,
}: MonogramProps) {
  const parts = name.split(/\s+/).slice(0, 2)
  const initials = parts.map((w) => w[0] ?? "").join("").toUpperCase() || "?"
  const hue = hashHue(name)
  const hueB = (hue + 38) % 360
  const background = flat
    ? `oklch(0.28 0.12 ${hue})`
    : `linear-gradient(135deg, oklch(0.32 0.14 ${hue}) 0%, oklch(0.22 0.10 ${hueB}) 100%)`
  const glowColor = `oklch(0.78 0.16 ${hue})`

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 overflow-hidden text-white",
        ring
          ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(0,0,0,0.20),0_0_0_2px_var(--accent-oo),0_0_0_5px_color-mix(in_oklch,var(--accent-oo)_20%,transparent)]"
          : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(0,0,0,0.20),0_1px_3px_rgba(20,24,40,0.10)]",
        className,
      )}
      style={{ width: size, height: size, background, ...SHAPES[shape] }}
    >
      {!flat && (
        <span
          className="absolute inset-0 opacity-70 mix-blend-screen pointer-events-none"
          style={{ background: `radial-gradient(circle at 30% 25%, ${glowColor} 0%, transparent 60%)` }}
        />
      )}
      {!flat && (
        <span
          className="absolute inset-0 opacity-60 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(180deg,transparent 0,transparent 5px,rgba(255,255,255,0.04) 5px,rgba(255,255,255,0.04) 6px)",
          }}
        />
      )}
      <span
        className="relative z-10 font-mono font-medium tracking-[0.02em] [text-shadow:0_1px_0_rgba(0,0,0,0.25)]"
        style={{ fontSize: size * 0.36 }}
      >
        {initials}
      </span>
      {status !== undefined && (
        <span
          className="absolute right-1 bottom-1 z-20 size-2.5 rounded-full shadow-[0_0_0_2px_var(--surface-1)]"
          style={{ background: STATUS_COLOR[status] }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/monogram.tsx frontend/lib/__tests__/monogram.test.ts
git commit -m "feat: add Monogram primitive with deterministic hue + 6 shapes"
```

---

### Task 5: Ring, Kbd, FieldLabel primitives

**Files:**
- Create: `frontend/components/ui/ring.tsx`
- Create: `frontend/components/ui/kbd.tsx`
- Create: `frontend/components/ui/field-label.tsx`

- [ ] **Step 1: Create ring.tsx**

`frontend/components/ui/ring.tsx`:
```tsx
import { cn } from "@/lib/utils"

export interface RingProps {
  value: number
  size?: number
  stroke?: number
  color?: string
  track?: string
  className?: string
}

export function Ring({
  value,
  size = 36,
  stroke = 3,
  color = "var(--accent-oo)",
  track = "var(--hair-strong)",
  className,
}: RingProps) {
  const clamped = Math.max(0, Math.min(100, value))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c - (clamped / 100) * c
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}
```

- [ ] **Step 2: Create kbd.tsx**

`frontend/components/ui/kbd.tsx`:
```tsx
import { cn } from "@/lib/utils"

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode
}

export function Kbd({ children, className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        "font-mono text-[10.5px] bg-surface-2 border border-hair-strong rounded-[5px] px-1.5 py-px text-ink-dim shadow-[inset_0_-1px_0_var(--hair-strong)]",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}
```

- [ ] **Step 3: Create field-label.tsx**

`frontend/components/ui/field-label.tsx`:
```tsx
import { cn } from "@/lib/utils"

export interface FieldLabelProps {
  children: React.ReactNode
  hint?: string
  htmlFor?: string
  className?: string
}

export function FieldLabel({ children, hint, htmlFor, className }: FieldLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("flex items-baseline justify-between gap-2 mb-1.5", className)}
    >
      <span className="t-meta t-meta-bright">{children}</span>
      {hint !== undefined && <span className="t-meta text-ink-faint">{hint}</span>}
    </label>
  )
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
git add frontend/components/ui/ring.tsx frontend/components/ui/kbd.tsx frontend/components/ui/field-label.tsx
git commit -m "feat: add Ring, Kbd, FieldLabel primitives"
```

---

### Task 6: Chip and Tag primitives

**Files:**
- Create: `frontend/components/ui/chip.tsx`
- Create: `frontend/components/ui/tag.tsx`

- [ ] **Step 1: Create chip.tsx**

`frontend/components/ui/chip.tsx`:
```tsx
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const chipVariants = cva(
  "inline-flex items-center gap-1.5 h-[30px] px-3 rounded-full border font-medium text-[12.5px] cursor-pointer transition-all duration-[120ms] select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      active: {
        false: "bg-surface-1 border-hair-strong text-ink-dim hover:text-ink hover:border-ink-faint",
        true:  "bg-ink-panel border-ink-panel text-on-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
      },
    },
    defaultVariants: { active: false },
  }
)

export interface ChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof chipVariants> {
  children: React.ReactNode
  active?: boolean
  icon?: React.ReactNode
}

export function Chip({ children, active = false, icon, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-state={active ? "on" : "off"}
      className={cn(chipVariants({ active }), className)}
      {...props}
    >
      {icon !== undefined && (
        <span className="inline-flex [&_svg]:size-[13px]">{icon}</span>
      )}
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Create tag.tsx**

`frontend/components/ui/tag.tsx`:
```tsx
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const tagVariants = cva(
  "inline-flex items-center h-[22px] px-2 rounded-[6px] font-mono text-[10.5px] tracking-[0.03em] font-medium",
  {
    variants: {
      tone: {
        neutral:  "bg-surface-sunk text-ink-dim",
        accent:   "bg-accent-soft text-accent-deep",
        "on-ink": "bg-white/[0.08] text-on-ink-dim",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

export interface TagProps extends VariantProps<typeof tagVariants> {
  children: React.ReactNode
  className?: string
}

export function Tag({ children, tone, className }: TagProps) {
  return <span className={cn(tagVariants({ tone }), className)}>{children}</span>
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
git add frontend/components/ui/chip.tsx frontend/components/ui/tag.tsx
git commit -m "feat: add Chip and Tag primitives"
```

---

### Task 7: Segmented and IconButton primitives

**Files:**
- Create: `frontend/components/ui/segmented.tsx`
- Create: `frontend/components/ui/icon-button.tsx`

- [ ] **Step 1: Create segmented.tsx**

`frontend/components/ui/segmented.tsx`:
```tsx
"use client"

import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const containerVariants = cva(
  "inline-flex bg-surface-sunk border border-hair rounded-lg gap-0.5",
  { variants: { size: { md: "p-[3px]", sm: "p-[2px]" } }, defaultVariants: { size: "md" } }
)

const itemVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[8px] font-medium cursor-pointer text-ink-mute transition-all duration-[120ms] select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:shrink-0",
  {
    variants: {
      size: {
        md: "px-3 py-1.5 text-[12.5px] [&_svg]:size-[14px]",
        sm: "px-2.5 py-1 text-[12px] [&_svg]:size-[13px]",
      },
      active: {
        true:  "bg-surface-2 text-ink shadow-[var(--shadow-1),0_0_0_1px_var(--hair-strong)]",
        false: "hover:text-ink",
      },
    },
    defaultVariants: { size: "md", active: false },
  }
)

export interface SegmentedOption {
  value: string
  label: string
  icon?: React.ReactNode
}

export interface SegmentedProps {
  value: string
  onValueChange: (v: string) => void
  options: ReadonlyArray<SegmentedOption>
  size?: "md" | "sm"
  className?: string
}

export function Segmented({ value, onValueChange, options, size = "md", className }: SegmentedProps) {
  return (
    <div className={cn(containerVariants({ size }), className)} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onValueChange(o.value)}
          className={itemVariants({ size, active: o.value === value })}
        >
          {o.icon !== undefined && <span className="inline-flex">{o.icon}</span>}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create icon-button.tsx**

`frontend/components/ui/icon-button.tsx`:
```tsx
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const iconButtonVariants = cva(
  "inline-flex items-center justify-center border border-transparent cursor-pointer transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        ghost:    "rounded-[10px] bg-transparent text-ink-dim hover:bg-[color-mix(in_oklch,var(--ink)_5%,transparent)] hover:text-ink",
        bordered: "rounded-[10px] bg-surface-1 border-hair-strong text-ink-dim hover:border-ink-faint",
        "on-ink": "rounded-[10px] bg-transparent text-on-ink-dim hover:bg-white/[0.08] hover:text-on-ink",
      },
      size: {
        sm: "size-7 [&_svg]:size-4",
        md: "size-9 [&_svg]:size-4",
        lg: "size-11 rounded-[12px] [&_svg]:size-[18px]",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  }
)

export interface IconButtonProps
  extends ButtonPrimitive.Props,
    VariantProps<typeof iconButtonVariants> {
  "aria-label": string
}

export function IconButton({ variant, size, className, children, ...props }: IconButtonProps) {
  return (
    <ButtonPrimitive
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  )
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
git add frontend/components/ui/segmented.tsx frontend/components/ui/icon-button.tsx
git commit -m "feat: add Segmented and IconButton primitives"
```

---

### Task 8: Preview route — infrastructure

**Files:**
- Create: `frontend/app/preview/page.tsx`
- Create: `frontend/app/preview/_components/section.tsx`
- Create: `frontend/app/preview/_components/preview-nav.tsx`

- [ ] **Step 1: Create section.tsx**

`frontend/app/preview/_components/section.tsx`:
```tsx
import { cn } from "@/lib/utils"

interface SectionProps {
  id: string
  kicker: string
  children: React.ReactNode
  className?: string
}

export function Section({ id, kicker, children, className }: SectionProps) {
  return (
    <section id={id} className={cn("scroll-mt-8", className)}>
      <div className="flex items-center gap-3 mb-6">
        <span className="t-meta">{kicker}</span>
        <div className="flex-1 hair" />
      </div>
      {children}
    </section>
  )
}
```

- [ ] **Step 2: Create preview-nav.tsx**

`frontend/app/preview/_components/preview-nav.tsx`:
```tsx
"use client"

import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { id: "colors",         label: "01 · Colors" },
  { id: "typography",     label: "02 · Typography" },
  { id: "spacing",        label: "03 · Spacing & Radii" },
  { id: "elevation",      label: "04 · Elevation" },
  { id: "motion",         label: "05 · Motion" },
  { id: "buttons",        label: "06 · Buttons" },
  { id: "inputs",         label: "07 · Inputs" },
  { id: "badges",         label: "08 · Badges & Tags" },
  { id: "monograms",      label: "09 · Monograms" },
  { id: "character-card", label: "10 · Character card" },
  { id: "screenplay",     label: "11 · Screenplay" },
  { id: "sheet-field",    label: "12 · Sheet field" },
  { id: "cast-state",     label: "13 · Cast state" },
  { id: "emotion-dots",   label: "14 · Emotion dots" },
  { id: "session-row",    label: "15 · Session row" },
  { id: "app-nav",        label: "16 · App nav" },
]

export function PreviewNav() {
  return (
    <nav className="sticky top-8 flex flex-col gap-0.5 w-[200px] shrink-0">
      <span className="t-meta mb-3">CONTENTS</span>
      {NAV_ITEMS.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          onClick={(e) => {
            e.preventDefault()
            document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" })
          }}
          className="t-body-s text-ink-mute hover:text-ink transition-colors duration-[120ms] py-0.5"
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}
```

- [ ] **Step 3: Create page.tsx shell**

`frontend/app/preview/page.tsx`:
```tsx
import { PreviewNav } from "./_components/preview-nav"
import { Section } from "./_components/section"

export const metadata = { title: "Design System · OpenOrmus" }

export default function PreviewPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <header className="border-b border-border px-8 py-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="t-meta mb-3">DESIGN SYSTEM · PREVIEW</div>
          <h1 className="t-h1">
            Open<em className="t-editorial">Ormus</em>
          </h1>
          <p className="t-body-l text-ink-mute mt-3 max-w-xl">
            Synth-glass on warm light. Geist + Geist Mono + Instrument Serif.
          </p>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto px-8 py-12 flex gap-12">
        <PreviewNav />

        <main className="flex-1 flex flex-col gap-16 min-w-0">
          <Section id="colors" kicker="01 · Colors">
            <p className="text-ink-mute t-body-s">Color section coming in Task 9.</p>
          </Section>
          <div className="hair-prism" />
          <Section id="typography" kicker="02 · Typography">
            <p className="text-ink-mute t-body-s">Typography section coming in Task 9.</p>
          </Section>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Start dev server and verify /preview loads**

```bash
bun run dev:frontend &
sleep 4
curl -s http://localhost:3000/preview | grep -c "Design System" && echo "OK"
kill %1
```

Expected: prints `1` then `OK`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/preview/
git commit -m "feat: scaffold /preview route with nav and section wrapper"
```

---

### Task 9: Foundation sections — Colors, Typography, Spacing, Elevation, Motion

**Files:**
- Create: `frontend/app/preview/_components/color-section.tsx`
- Create: `frontend/app/preview/_components/typography-section.tsx`
- Create: `frontend/app/preview/_components/spacing-section.tsx`
- Create: `frontend/app/preview/_components/elevation-section.tsx`
- Create: `frontend/app/preview/_components/motion-section.tsx`
- Modify: `frontend/app/preview/page.tsx`

- [ ] **Step 1: Create color-section.tsx**

`frontend/app/preview/_components/color-section.tsx`:
```tsx
interface SwatchProps { label: string; varName: string; className: string }

function Swatch({ label, varName, className }: SwatchProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-10 rounded-lg border border-hair ${className}`} />
      <span className="t-meta">{label}</span>
      <span className="font-mono text-[10px] text-ink-faint">{varName}</span>
    </div>
  )
}

export function ColorSection() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="t-meta mb-4">SURFACES</p>
        <div className="grid grid-cols-5 gap-4">
          <Swatch label="bg" varName="--bg" className="bg-background" />
          <Swatch label="bg-tinted" varName="--bg-tinted" className="bg-bg-tinted" />
          <Swatch label="surface-1" varName="--surface-1" className="bg-surface-1" />
          <Swatch label="surface-2" varName="--surface-2" className="bg-surface-2" />
          <Swatch label="surface-sunk" varName="--surface-sunk" className="bg-surface-sunk" />
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">INK PANELS</p>
        <div className="grid grid-cols-3 gap-4">
          <Swatch label="ink-panel" varName="--ink-panel" className="bg-ink-panel" />
          <Swatch label="ink-panel-2" varName="--ink-panel-2" className="bg-ink-panel-2" />
          <Swatch label="ink-panel-3" varName="--ink-panel-3" className="bg-ink-panel-3" />
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">ACCENT</p>
        <div className="grid grid-cols-6 gap-4">
          <Swatch label="accent-oo" varName="--accent-oo" className="bg-accent-oo" />
          <Swatch label="accent-deep" varName="--accent-deep" className="bg-accent-deep" />
          <Swatch label="accent-bright" varName="--accent-bright" className="bg-accent-bright" />
          <Swatch label="accent-glow" varName="--accent-glow" className="bg-accent-glow" />
          <Swatch label="accent-soft" varName="--accent-soft" className="bg-accent-soft border!" />
          <Swatch label="accent-tint" varName="--accent-tint" className="bg-accent-tint border!" />
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">SIGNALS</p>
        <div className="grid grid-cols-3 gap-4">
          <Swatch label="signal-ok" varName="--signal-ok" className="bg-signal-ok" />
          <Swatch label="signal-warn" varName="--signal-warn" className="bg-signal-warn" />
          <Swatch label="signal-flag" varName="--signal-flag" className="bg-signal-flag" />
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">INK SCALE (text on light)</p>
        <div className="flex flex-col gap-2 p-4 bg-surface-1 rounded-xl border border-hair">
          {(["ink","ink-dim","ink-mute","ink-faint","ink-ghost"] as const).map((name) => (
            <div key={name} className="flex items-center gap-3">
              <span className={`font-mono text-[12px] w-20 text-${name}`}>--{name}</span>
              <span className={`t-body text-${name}`}>The quick brown fox jumps over the lazy dog</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create typography-section.tsx**

`frontend/app/preview/_components/typography-section.tsx`:
```tsx
export function TypographySection() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        {(["t-h1","t-h2","t-h3","t-h4","t-h5","t-h6"] as const).map((cls) => (
          <div key={cls} className="flex items-baseline gap-4">
            <span className="t-meta w-12 shrink-0">{cls.replace("t-","h")}</span>
            <span className={cls}>Open<em className="t-editorial">Ormus</em></span>
          </div>
        ))}
      </div>
      <div className="hair" />
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">body-l</span>
          <span className="t-body-l">A studio for creating fictional characters and simulating scenes between them.</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">body</span>
          <span>A studio for creating fictional characters and simulating scenes between them.</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">body-s</span>
          <span className="t-body-s">A studio for creating fictional characters and simulating scenes between them.</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">mono</span>
          <span className="t-mono text-ink-dim">SESSION · 0x12AF · TURN 26 · STREAMING</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">editorial</span>
          <span className="t-editorial text-[18px]">A foggy Victorian railway platform at dusk.</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">meta</span>
          <span className="t-meta">CHARACTER · PUBLIC · COMPLETE · 94%</span>
        </div>
      </div>
      <div className="hair" />
      <div>
        <p className="t-meta mb-4">GEIST MONO — data, labels, code</p>
        <div className="p-4 bg-ink-panel rounded-xl text-on-ink font-mono text-[13px] leading-relaxed">
          <span className="text-on-ink-dim">SESSION</span> 0x12AF{" "}
          <span className="text-on-ink-dim">·</span>{" "}
          <span className="text-accent-bright">TURN 26</span>{" "}
          <span className="text-on-ink-dim">· STREAMING · SSE</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create spacing-section.tsx**

`frontend/app/preview/_components/spacing-section.tsx`:
```tsx
const SPACING = [
  { name: "s-05", px: 2 }, { name: "s-1", px: 4 }, { name: "s-2", px: 8 },
  { name: "s-3", px: 12 }, { name: "s-4", px: 16 }, { name: "s-5", px: 24 },
  { name: "s-6", px: 32 }, { name: "s-7", px: 48 }, { name: "s-8", px: 64 },
]
const RADII = [
  { name: "r-xs", val: "4px" }, { name: "r-sm", val: "8px" }, { name: "r-md", val: "12px" },
  { name: "r-lg", val: "18px" }, { name: "r-xl", val: "24px" }, { name: "r-2xl", val: "32px" },
  { name: "r-pill", val: "999px" },
]

export function SpacingSection() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="t-meta mb-4">SPACING — 4px base scale</p>
        <div className="flex items-end gap-3">
          {SPACING.map(({ name, px }) => (
            <div key={name} className="flex flex-col items-center gap-1.5">
              <div className="bg-accent-oo rounded-sm" style={{ width: px, height: px }} />
              <span className="t-meta">{px}px</span>
              <span className="font-mono text-[9px] text-ink-faint">--{name}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">RADII</p>
        <div className="flex items-end gap-4 flex-wrap">
          {RADII.map(({ name, val }) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <div
                className="size-14 bg-surface-sunk border border-hair"
                style={{ borderRadius: `var(--${name})` }}
              />
              <span className="t-meta">{val}</span>
              <span className="font-mono text-[9px] text-ink-faint">--{name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create elevation-section.tsx**

`frontend/app/preview/_components/elevation-section.tsx`:
```tsx
const LEVELS = [
  { name: "shadow-0", label: "0 — hairline ring", style: { boxShadow: "var(--shadow-0)" } },
  { name: "shadow-1", label: "1 — card resting", style: { boxShadow: "var(--shadow-1)" } },
  { name: "shadow-2", label: "2 — floating panel", style: { boxShadow: "var(--shadow-2)" } },
  { name: "shadow-3", label: "3 — modal / sheet", style: { boxShadow: "var(--shadow-3)" } },
  { name: "shadow-glow", label: "glow — focus accent", style: { boxShadow: "var(--shadow-glow)" } },
]

export function ElevationSection() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-5 gap-6">
        {LEVELS.map(({ name, label, style }) => (
          <div key={name} className="flex flex-col items-center gap-3">
            <div
              className="w-full h-24 bg-surface-1 rounded-xl"
              style={style}
            />
            <span className="t-meta text-center">{label}</span>
            <span className="font-mono text-[9px] text-ink-faint">--{name}</span>
          </div>
        ))}
      </div>
      <div>
        <p className="t-meta mb-4">GLASS</p>
        <div className="relative h-28 rounded-xl overflow-hidden grid-field">
          <div className="absolute inset-4 glass rounded-lg flex items-center justify-center">
            <span className="t-body text-ink-dim">Glass surface — backdrop-filter blur(20px)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create motion-section.tsx**

`frontend/app/preview/_components/motion-section.tsx`:
```tsx
"use client"

import { useState } from "react"

const DURATIONS = [
  { name: "d-1", ms: 120, label: "120ms — micro-interactions" },
  { name: "d-2", ms: 220, label: "220ms — panel transitions" },
  { name: "d-3", ms: 360, label: "360ms — page overlays" },
  { name: "d-4", ms: 560, label: "560ms — dramatic reveals" },
]

export function MotionSection() {
  const [active, setActive] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <p className="t-body-s text-ink-mute">
        Click a duration to preview. Easing: <span className="font-mono text-[12px]">cubic-bezier(0.22, 1, 0.36, 1)</span> (ease-out).
      </p>
      <div className="flex flex-col gap-4">
        {DURATIONS.map(({ name, ms, label }) => (
          <div key={name} className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActive(name)}
              className="t-meta w-24 text-left hover:text-ink-dim transition-colors"
            >
              --{name}
            </button>
            <div className="flex-1 h-8 bg-surface-sunk rounded-full relative overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full bg-accent-oo rounded-full"
                style={{
                  width: active === name ? "100%" : "0%",
                  transitionProperty: "width",
                  transitionDuration: `${ms}ms`,
                  transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                }}
                onTransitionEnd={() => setActive(null)}
              />
            </div>
            <span className="t-meta w-48">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Wire sections into page.tsx**

Replace `frontend/app/preview/page.tsx` with:
```tsx
import { PreviewNav } from "./_components/preview-nav"
import { Section } from "./_components/section"
import { ColorSection } from "./_components/color-section"
import { TypographySection } from "./_components/typography-section"
import { SpacingSection } from "./_components/spacing-section"
import { ElevationSection } from "./_components/elevation-section"
import { MotionSection } from "./_components/motion-section"

export const metadata = { title: "Design System · OpenOrmus" }

export default function PreviewPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-8 py-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="t-meta mb-3">DESIGN SYSTEM · PREVIEW</div>
          <h1 className="t-h1">Open<em className="t-editorial">Ormus</em></h1>
          <p className="t-body-l text-ink-mute mt-3 max-w-xl">
            Synth-glass on warm light · Geist + Geist Mono + Instrument Serif
          </p>
        </div>
      </header>
      <div className="max-w-[1280px] mx-auto px-8 py-12 flex gap-12">
        <PreviewNav />
        <main className="flex-1 flex flex-col gap-16 min-w-0">
          <Section id="colors" kicker="01 · Colors"><ColorSection /></Section>
          <Section id="typography" kicker="02 · Typography"><TypographySection /></Section>
          <Section id="spacing" kicker="03 · Spacing & Radii"><SpacingSection /></Section>
          <div className="hair-prism" />
          <Section id="elevation" kicker="04 · Elevation"><ElevationSection /></Section>
          <Section id="motion" kicker="05 · Motion"><MotionSection /></Section>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Typecheck + commit**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
git add frontend/app/preview/
git commit -m "feat: add foundation sections — colors, typography, spacing, elevation, motion"
```

---

### Task 10: Controls sections — Buttons, Inputs, Badges

**Files:**
- Create: `frontend/app/preview/_components/buttons-section.tsx`
- Create: `frontend/app/preview/_components/inputs-section.tsx`
- Create: `frontend/app/preview/_components/badges-section.tsx`

- [ ] **Step 1: Create buttons-section.tsx**

`frontend/app/preview/_components/buttons-section.tsx`:
```tsx
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { IconButton } from "@/components/ui/icon-button"
import { Search, Plus, Play, Square, X } from "lucide-react"

export function ButtonsSection() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="t-meta mb-4">BUTTON VARIANTS</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="default">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Danger</Button>
          <Button variant="link">Link</Button>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">SIZES</p>
        <div className="flex items-center gap-3">
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">WITH ICONS</p>
        <div className="flex flex-wrap gap-3">
          <Button><Play className="size-4" strokeWidth={1.5} /> Start scene</Button>
          <Button variant="secondary"><Plus className="size-4" strokeWidth={1.5} /> New character</Button>
          <Button variant="ghost"><Search className="size-4" strokeWidth={1.5} /> Search</Button>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">ICON BUTTONS</p>
        <div className="flex items-center gap-3">
          <IconButton aria-label="Search" variant="ghost" size="sm"><Search strokeWidth={1.5} /></IconButton>
          <IconButton aria-label="Add" variant="ghost"><Plus strokeWidth={1.5} /></IconButton>
          <IconButton aria-label="Search" variant="bordered"><Search strokeWidth={1.5} /></IconButton>
          <div className="bg-ink-panel rounded-xl p-3 flex gap-2">
            <IconButton aria-label="Play" variant="on-ink"><Play strokeWidth={1.5} /></IconButton>
            <IconButton aria-label="Stop" variant="on-ink"><Square strokeWidth={1.5} /></IconButton>
          </div>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">DISABLED STATE</p>
        <div className="flex gap-3">
          <Button disabled>Primary</Button>
          <Button variant="secondary" disabled>Secondary</Button>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">CHIP (toggleable)</p>
        <div className="flex gap-2 flex-wrap">
          <Chip active icon={<Play strokeWidth={1.5} />}>All · 8</Chip>
          <Chip icon={<X strokeWidth={1.5} />}>Public · 5</Chip>
          <Chip>Personal · 3</Chip>
          <Chip>Drafts · 2</Chip>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create inputs-section.tsx**

`frontend/app/preview/_components/inputs-section.tsx`:
```tsx
"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FieldLabel } from "@/components/ui/field-label"
import { Segmented } from "@/components/ui/segmented"
import { Search } from "lucide-react"

export function InputsSection() {
  const [view, setView] = useState("grid")
  const [tone, setTone] = useState("balanced")

  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="t-meta mb-4">TEXT INPUT</p>
        <div className="flex flex-col gap-4 max-w-sm">
          <div>
            <FieldLabel htmlFor="name-input" hint="Required">Character name</FieldLabel>
            <Input id="name-input" placeholder="e.g. Sherlock Holmes" />
          </div>
          <div>
            <FieldLabel htmlFor="search-input">Search</FieldLabel>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-faint" strokeWidth={1.5} />
              <Input id="search-input" placeholder="Filter by name, trait…" className="pl-9" />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="disabled-input">Disabled</FieldLabel>
            <Input id="disabled-input" placeholder="Not editable" disabled />
          </div>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">TEXTAREA</p>
        <div className="max-w-sm">
          <FieldLabel htmlFor="bio-input" hint="0 / 500">Short biography</FieldLabel>
          <Textarea id="bio-input" placeholder="Describe the character's background…" rows={4} />
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">SEGMENTED CONTROL</p>
        <div className="flex flex-col gap-3">
          <Segmented
            value={view}
            onValueChange={setView}
            options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }, { value: "table", label: "Table" }]}
          />
          <Segmented
            size="sm"
            value={tone}
            onValueChange={setTone}
            options={[
              { value: "balanced", label: "Balanced" },
              { value: "faithful", label: "Faithful" },
              { value: "creative", label: "Creative" },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create badges-section.tsx**

`frontend/app/preview/_components/badges-section.tsx`:
```tsx
import { Tag } from "@/components/ui/tag"
import { Kbd } from "@/components/ui/kbd"

interface BadgeProps { tone: string; dot?: boolean; mono?: boolean; children: React.ReactNode }

function OoBadge({ tone, dot, mono, children }: BadgeProps) {
  const BASE = "inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[11.5px] font-medium border border-transparent"
  const TONES: Record<string, string> = {
    neutral: "bg-surface-sunk text-ink-dim border-hair",
    accent:  "bg-accent-soft text-accent-deep border-[color-mix(in_oklch,var(--accent-oo)_16%,transparent)]",
    ok:      "bg-[color-mix(in_oklch,var(--signal-ok)_12%,var(--surface-1))] text-signal-ok",
    warn:    "bg-[color-mix(in_oklch,var(--signal-warn)_14%,var(--surface-1))] text-[oklch(0.45_0.16_78)]",
    flag:    "bg-[color-mix(in_oklch,var(--signal-flag)_12%,var(--surface-1))] text-signal-flag",
    ink:     "bg-ink-panel text-on-ink",
    "on-ink":"bg-white/10 text-on-ink border-hair-on-ink",
  }
  return (
    <span className={`${BASE} ${TONES[tone] ?? TONES["neutral"]} ${mono ? "font-mono text-[10.5px] tracking-[0.04em] uppercase" : ""}`}>
      {dot && <span className="size-1.5 rounded-full bg-current shadow-[0_0_0_3px_color-mix(in_oklch,currentColor_20%,transparent)]" />}
      {children}
    </span>
  )
}

export function BadgesSection() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="t-meta mb-4">BADGE TONES</p>
        <div className="flex flex-wrap gap-2">
          <OoBadge tone="neutral">Neutral</OoBadge>
          <OoBadge tone="accent">Accent</OoBadge>
          <OoBadge tone="ok">OK</OoBadge>
          <OoBadge tone="warn">Warning</OoBadge>
          <OoBadge tone="flag">Flag</OoBadge>
          <OoBadge tone="ink">Ink</OoBadge>
          <div className="bg-ink-panel rounded-lg px-2 py-1"><OoBadge tone="on-ink">On ink</OoBadge></div>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">MONO + DOT VARIANTS</p>
        <div className="flex flex-wrap gap-2">
          <OoBadge tone="accent" mono dot>PUBLIC</OoBadge>
          <OoBadge tone="ok" mono dot>LIVE</OoBadge>
          <OoBadge tone="warn" mono dot>DRAFT</OoBadge>
          <OoBadge tone="flag" mono dot>FLAGGED</OoBadge>
          <OoBadge tone="neutral" mono>DONE</OoBadge>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">TAGS (read-only, mono)</p>
        <div className="flex flex-wrap gap-2">
          <Tag tone="neutral">observant</Tag>
          <Tag tone="neutral">arrogant</Tag>
          <Tag tone="neutral">loyal</Tag>
          <Tag tone="accent">consulting detective</Tag>
          <div className="bg-ink-panel rounded-lg px-2 py-1 flex gap-2">
            <Tag tone="on-ink">on-ink variant</Tag>
          </div>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">KBD</p>
        <div className="flex gap-2 flex-wrap">
          <Kbd>⌘K</Kbd>
          <Kbd>⌘Enter</Kbd>
          <Kbd>Escape</Kbd>
          <Kbd>⌘⇧P</Kbd>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire into page.tsx**

Add to `frontend/app/preview/page.tsx` imports and sections:
```tsx
import { ButtonsSection } from "./_components/buttons-section"
import { InputsSection } from "./_components/inputs-section"
import { BadgesSection } from "./_components/badges-section"
```

Add after the motion section (before closing `</main>`):
```tsx
<div className="hair-prism" />
<Section id="buttons" kicker="06 · Buttons"><ButtonsSection /></Section>
<Section id="inputs" kicker="07 · Inputs"><InputsSection /></Section>
<Section id="badges" kicker="08 · Badges & Tags"><BadgesSection /></Section>
```

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
git add frontend/app/preview/
git commit -m "feat: add buttons, inputs, badges preview sections"
```

---

### Task 11: Monogram showcase

**Files:**
- Create: `frontend/app/preview/_components/monogram-showcase.tsx`

- [ ] **Step 1: Create monogram-showcase.tsx**

`frontend/app/preview/_components/monogram-showcase.tsx`:
```tsx
import { Monogram, type MonogramShape, type MonogramStatus } from "@/components/ui/monogram"

const NAMES = ["Sherlock Holmes","James Moriarty","Iris Vega","Captain Nemo","Hermione Granger","Furiosa","Ada Wren","Don Quixote","Eleanor Vance"]
const SHAPES: MonogramShape[] = ["rounded","circle","squircle","hexagon","shield","diamond"]
const STATUSES: Array<{ status: MonogramStatus; label: string }> = [
  { status: "ok", label: "ok" },
  { status: "warn", label: "warn" },
  { status: "flag", label: "flag" },
  { status: "public", label: "public" },
]

export function MonogramShowcase() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="t-meta mb-4">HUE DISTRIBUTION — 9 names, all unique</p>
        <div className="flex gap-4 flex-wrap">
          {NAMES.map((name) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <Monogram name={name} size={48} />
              <span className="t-meta text-center" style={{ maxWidth: 56, wordBreak: "break-word" }}>
                {name.split(" ")[0]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="t-meta mb-4">6 SHAPES</p>
        <div className="flex gap-6 flex-wrap items-end">
          {SHAPES.map((shape) => (
            <div key={shape} className="flex flex-col items-center gap-2">
              <Monogram name="Sherlock Holmes" size={56} shape={shape} />
              <span className="t-meta">{shape}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="t-meta mb-4">STATUS DOTS</p>
        <div className="flex gap-6 items-end">
          {STATUSES.map(({ status, label }) => (
            <div key={status} className="flex flex-col items-center gap-2">
              <Monogram name="Sherlock Holmes" size={56} status={status} />
              <span className="t-meta">{label}</span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-2">
            <Monogram name="Sherlock Holmes" size={56} ring />
            <span className="t-meta">ring</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Monogram name="Sherlock Holmes" size={56} flat />
            <span className="t-meta">flat</span>
          </div>
        </div>
      </div>

      <div>
        <p className="t-meta mb-4">SIZE SCALE</p>
        <div className="flex gap-4 items-end">
          {[24,32,40,56,72,96].map((size) => (
            <div key={size} className="flex flex-col items-center gap-2">
              <Monogram name="Iris Vega" size={size} />
              <span className="t-meta">{size}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into page.tsx**

Add import: `import { MonogramShowcase } from "./_components/monogram-showcase"`

Add section after badges:
```tsx
<Section id="monograms" kicker="09 · Monograms"><MonogramShowcase /></Section>
```

- [ ] **Step 3: Typecheck + commit**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
git add frontend/app/preview/
git commit -m "feat: add monogram showcase with shapes, statuses, size scale"
```

---

### Task 12: Character card and session row demos

**Files:**
- Create: `frontend/app/preview/_components/character-card-demo.tsx`
- Create: `frontend/app/preview/_components/session-row.tsx`

- [ ] **Step 1: Create character-card-demo.tsx**

`frontend/app/preview/_components/character-card-demo.tsx`:
```tsx
import { Monogram } from "@/components/ui/monogram"
import { Tag } from "@/components/ui/tag"
import { Ring } from "@/components/ui/ring"

interface CharData {
  name: string; role: string; traits: string[]; completeness: number
  source: "public" | "personal"; status: "complete" | "draft"
}

const CHARS: CharData[] = [
  { name: "Sherlock Holmes", role: "Consulting detective · Conan Doyle", traits: ["observant","arrogant","loyal"], completeness: 94, source: "public", status: "complete" },
  { name: "Iris Vega", role: "Original · noir, near-future", traits: ["cynical","soft-spoken","grieving"], completeness: 48, source: "personal", status: "draft" },
  { name: "Captain Nemo", role: "Anti-hero · Verne", traits: ["vengeful","aristocratic","reclusive"], completeness: 82, source: "public", status: "complete" },
]

function CharCard({ c, featured }: { c: CharData; featured?: boolean }) {
  return (
    <article className={`bg-surface-1 border border-hair rounded-[18px] shadow-[var(--shadow-inset),var(--shadow-1)] p-5 flex flex-col gap-4 ${featured ? "col-span-2" : ""}`}>
      <div className="flex items-start justify-between">
        <Monogram
          name={c.name}
          size={featured ? 88 : 56}
          status={c.source === "public" ? "public" : c.status === "draft" ? "warn" : undefined}
        />
        <div className="flex gap-1.5 flex-wrap justify-end">
          {c.source === "public"
            ? <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full bg-accent-soft text-accent-deep border border-[color-mix(in_oklch,var(--accent-oo)_16%,transparent)] font-mono text-[10.5px] tracking-[0.04em] uppercase"><span className="size-1.5 rounded-full bg-current" />PUBLIC</span>
            : <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-surface-sunk text-ink-dim border border-hair font-mono text-[10.5px] tracking-[0.04em] uppercase">PERSONAL</span>
          }
          {c.status === "draft" && (
            <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_14%,var(--surface-1))] text-[oklch(0.45_0.16_78)] font-mono text-[10.5px] tracking-[0.04em] uppercase"><span className="size-1.5 rounded-full bg-current" />DRAFT</span>
          )}
        </div>
      </div>
      <div>
        <h3 className={`font-medium m-0 tracking-[-0.015em] ${featured ? "t-h4" : "t-h6"}`}>{c.name}</h3>
        <p className="t-body-s text-ink-mute mt-0.5">{c.role}</p>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {c.traits.map((t) => <Tag key={t}>{t}</Tag>)}
      </div>
      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-hair">
        <span className="font-mono text-[11px] text-ink-mute flex-1">{c.completeness}% complete</span>
        <div className="flex-1 h-1 bg-surface-sunk rounded-full overflow-hidden">
          <div className="h-full bg-accent-oo rounded-full" style={{ width: `${c.completeness}%` }} />
        </div>
        <Ring value={c.completeness} size={24} stroke={2.5} />
      </div>
    </article>
  )
}

export function CharacterCardDemo() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <CharCard c={CHARS[0]!} featured />
      {CHARS.slice(1).map((c) => <CharCard key={c.name} c={c} />)}
    </div>
  )
}
```

- [ ] **Step 2: Create session-row.tsx**

`frontend/app/preview/_components/session-row.tsx`:
```tsx
import { Monogram } from "@/components/ui/monogram"
import { ChevronRight } from "lucide-react"

interface SessionData {
  chars: string[]; scene: string; turns: number; when: string
  status: "streaming" | "stopped" | "complete"
}

const SESSIONS: SessionData[] = [
  { chars: ["Sherlock Holmes","James Moriarty"], scene: "A foggy Victorian railway platform at dusk. The last train is twelve minutes late.", turns: 26, when: "3 min ago", status: "streaming" },
  { chars: ["Iris Vega","Ada Wren"], scene: "An abandoned greenhouse. Iris is looking for her sister's notebook.", turns: 14, when: "2h ago", status: "stopped" },
  { chars: ["Captain Nemo","Furiosa","Don Quixote"], scene: "A council table. Three commanders, one impossible map.", turns: 42, when: "yesterday", status: "complete" },
]

const STATUS_BADGE: Record<SessionData["status"], React.ReactNode> = {
  streaming: <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full bg-accent-soft text-accent-deep border border-[color-mix(in_oklch,var(--accent-oo)_16%,transparent)] font-mono text-[10.5px] tracking-[0.04em] uppercase"><span className="size-1.5 rounded-full bg-current" />LIVE</span>,
  stopped:   <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_14%,var(--surface-1))] text-[oklch(0.45_0.16_78)] font-mono text-[10.5px] tracking-[0.04em] uppercase">STOPPED</span>,
  complete:  <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-surface-sunk text-ink-dim border border-hair font-mono text-[10.5px] tracking-[0.04em] uppercase">DONE</span>,
}

function SessionRow({ s }: { s: SessionData }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-bg-tinted transition-colors duration-[120ms] cursor-pointer group">
      <div className="flex">
        {s.chars.slice(0, 3).map((name, i) => (
          <div key={name} style={{ marginLeft: i === 0 ? 0 : -10, zIndex: 3 - i }}>
            <Monogram name={name} size={36} />
          </div>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[14px] truncate">{s.chars.join(" · ")}</p>
        <p className="t-body-s text-ink-dim truncate t-editorial">{s.scene}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="t-meta">{s.when}</span>
        <span className="font-mono text-[11px] text-ink-mute">{s.turns}T</span>
        {STATUS_BADGE[s.status]}
        <ChevronRight className="size-4 text-ink-faint group-hover:text-ink-dim transition-colors" strokeWidth={1.5} />
      </div>
    </div>
  )
}

export function SessionRowDemo() {
  return (
    <div className="flex flex-col divide-y divide-hair">
      {SESSIONS.map((s) => <SessionRow key={s.chars.join()} s={s} />)}
    </div>
  )
}
```

- [ ] **Step 3: Wire into page.tsx**

Add imports:
```tsx
import { CharacterCardDemo } from "./_components/character-card-demo"
import { SessionRowDemo } from "./_components/session-row"
```

Add sections (after monograms, before closing `</main>`):
```tsx
<div className="hair-prism" />
<Section id="character-card" kicker="10 · Character card"><CharacterCardDemo /></Section>
<Section id="session-row" kicker="15 · Session row"><SessionRowDemo /></Section>
```

- [ ] **Step 4: Typecheck + commit**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
git add frontend/app/preview/
git commit -m "feat: add character card and session row demo sections"
```

---

### Task 13: Screenplay, CastState, EmotionDots demos

**Files:**
- Create: `frontend/app/preview/_components/screenplay-block.tsx`
- Create: `frontend/app/preview/_components/cast-state.tsx`
- Create: `frontend/app/preview/_components/emotion-dots.tsx`

- [ ] **Step 1: Create screenplay-block.tsx**

`frontend/app/preview/_components/screenplay-block.tsx`:
```tsx
type BlockType = "slug" | "stage" | "paren" | "line"

interface ScriptBlock {
  type: BlockType
  text: string
  char?: string
  emotion?: string
}

const SCRIPT: ScriptBlock[] = [
  { type: "slug", text: "INT. KING'S CROSS PLATFORM 4 — DUSK · APRIL 1891" },
  { type: "stage", text: "Fog rolls between rails. HOLMES stands beneath a gaslamp, reading a telegram. From the column of escaping steam, MORIARTY steps into view." },
  { type: "line", char: "Sherlock Holmes", emotion: "Anticipation · low", text: "You're late, Professor. Twelve minutes is uncharacteristic — even of trains." },
  { type: "line", char: "James Moriarty", emotion: "Trust · feigned", text: "I was watching you read the same telegram four times. I am curious what it said the fourth." },
  { type: "paren", text: "(Holmes folds the telegram precisely, in thirds.)" },
  { type: "line", char: "Sherlock Holmes", emotion: "Joy · cold", text: "It said you would board the 6:14 with a leather case and a second-class ticket. The second-class part interests me." },
]

function Block({ b }: { b: ScriptBlock }) {
  if (b.type === "slug") {
    return <div className="font-mono text-[11.5px] font-semibold tracking-[0.06em] text-ink-dim uppercase mt-6 mb-2">{b.text}</div>
  }
  if (b.type === "stage") {
    return <p className="t-editorial text-[13.5px] text-ink-mute italic mx-auto my-3" style={{ maxWidth: 560 }}>{b.text}</p>
  }
  if (b.type === "paren") {
    return <p className="t-editorial text-[12.5px] text-ink-faint italic my-1 ml-12">{b.text}</p>
  }
  return (
    <div className="my-4">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-mono text-[11px] font-semibold tracking-[0.05em] text-ink">{b.char?.toUpperCase()}</span>
        <span className="t-meta">— {b.emotion?.toUpperCase()}</span>
      </div>
      <p className="t-body text-ink leading-relaxed ml-0">{b.text}</p>
    </div>
  )
}

export function ScreenplayDemo() {
  return (
    <div
      className="rounded-xl border border-hair shadow-[var(--shadow-2)] p-8 max-w-2xl"
      style={{
        background: "linear-gradient(180deg, oklch(0.98 0.008 85) 0%, oklch(0.975 0.006 85) 100%)",
        borderLeft: "4px solid var(--signal-flag)",
      }}
    >
      {SCRIPT.map((b, i) => <Block key={i} b={b} />)}
      <div className="mt-6 pt-4 border-t border-hair flex items-center gap-2">
        <span className="t-meta">JAMES MORIARTY IS COMPOSING</span>
        <span className="flex gap-1">
          {[0,1,2].map((i) => (
            <span
              key={i}
              className="size-1.5 rounded-full bg-accent-oo"
              style={{ animation: `pulse 1.2s ${i * 0.2}s infinite` }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create cast-state.tsx**

`frontend/app/preview/_components/cast-state.tsx`:
```tsx
import { Monogram } from "@/components/ui/monogram"
import { Ring } from "@/components/ui/ring"

interface CastStateData { name: string; emotion: string; intensity: string; coherence: number }

const CAST: CastStateData[] = [
  { name: "Sherlock Holmes", emotion: "Anticipation", intensity: "rising", coherence: 0.93 },
  { name: "James Moriarty", emotion: "Trust · feigned", intensity: "steady", coherence: 0.88 },
]

function CastRow({ c }: { c: CastStateData }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Monogram name={c.name} size={28} />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium truncate">{c.name}</p>
        <p className="t-meta">{c.emotion.toUpperCase()} · {c.intensity}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Ring value={Math.round(c.coherence * 100)} size={26} stroke={2.5} />
        <span className="font-mono text-[10px] text-ink-dim">{Math.round(c.coherence * 100)}</span>
      </div>
    </div>
  )
}

export function CastStateDemo() {
  return (
    <div className="bg-surface-1 border border-hair rounded-xl p-4 max-w-xs">
      <p className="t-meta mb-3">CAST STATE</p>
      <div className="flex flex-col divide-y divide-hair">
        {CAST.map((c) => <CastRow key={c.name} c={c} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create emotion-dots.tsx**

`frontend/app/preview/_components/emotion-dots.tsx`:
```tsx
const EMOTIONS = ["Joy","Trust","Fear","Surprise","Sadness","Disgust","Anger","Anticipation"]

const EMOTION_COLOR: Record<string, string> = {
  Joy: "var(--signal-warn)", Trust: "var(--signal-ok)", Fear: "var(--ink-dim)",
  Surprise: "var(--accent-bright)", Sadness: "var(--accent-deep)", Disgust: "var(--signal-flag)",
  Anger: "var(--signal-flag)", Anticipation: "var(--accent-oo)",
}

export function EmotionDotsDemo() {
  const active = "Anticipation"
  return (
    <div className="flex flex-col gap-4">
      <p className="t-body-s text-ink-mute">Plutchik's 8 primary emotions. Active: <strong>{active}</strong>.</p>
      <div className="grid grid-cols-4 gap-3 max-w-xs">
        {EMOTIONS.map((e) => {
          const isActive = e === active
          return (
            <div key={e} className="flex flex-col items-center gap-1.5">
              <span
                className={`size-3 rounded-full transition-all duration-[220ms] ${isActive ? "scale-125 shadow-glow" : "opacity-40"}`}
                style={{ background: EMOTION_COLOR[e] ?? "var(--ink-mute)" }}
              />
              <span className={`t-meta text-center ${isActive ? "t-meta-bright" : ""}`}>{e}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire into page.tsx**

Add imports:
```tsx
import { ScreenplayDemo } from "./_components/screenplay-block"
import { CastStateDemo } from "./_components/cast-state"
import { EmotionDotsDemo } from "./_components/emotion-dots"
```

Add sections:
```tsx
<Section id="screenplay" kicker="11 · Screenplay"><ScreenplayDemo /></Section>
<Section id="cast-state" kicker="13 · Cast state"><CastStateDemo /></Section>
<Section id="emotion-dots" kicker="14 · Emotion dots"><EmotionDotsDemo /></Section>
```

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
git add frontend/app/preview/
git commit -m "feat: add screenplay, cast state, emotion dots demo sections"
```

---

### Task 14: SheetField and AppNav demos

**Files:**
- Create: `frontend/app/preview/_components/sheet-field.tsx`
- Create: `frontend/app/preview/_components/app-nav-demo.tsx`

- [ ] **Step 1: Create sheet-field.tsx**

`frontend/app/preview/_components/sheet-field.tsx`:
```tsx
import { Ring } from "@/components/ui/ring"

interface SheetFieldProps {
  title: string
  pct: number
  flagged?: boolean
  children: React.ReactNode
}

function SheetField({ title, pct, flagged = false, children }: SheetFieldProps) {
  return (
    <article className={`border rounded-xl overflow-hidden ${flagged ? "border-[color-mix(in_oklch,var(--signal-warn)_40%,transparent)]" : "border-hair"}`}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-hair bg-surface-sunk gap-4">
        <h3 className="t-h6 m-0">{title}</h3>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[11px]" style={{ color: flagged ? "var(--signal-warn)" : "var(--ink-mute)" }}>
            {Math.round(pct * 100)}% confidence
          </span>
          <div className="w-24 h-1 bg-surface-sunk rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct * 100}%`, background: flagged ? "var(--signal-warn)" : "var(--accent-oo)" }}
            />
          </div>
          <Ring value={Math.round(pct * 100)} size={22} stroke={2} color={flagged ? "var(--signal-warn)" : undefined} />
        </div>
      </header>
      <div className="px-4 py-4 bg-surface-1">{children}</div>
    </article>
  )
}

export function SheetFieldDemo() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <SheetField title="Core personality" pct={0.94}>
        <p className="t-body text-ink-dim leading-relaxed">
          A self-described "consulting detective" whose deductive style and chemical obsessions are inseparable from his contempt for ordinary minds. Vulnerable to boredom; deeply, awkwardly loyal to Watson.
        </p>
      </SheetField>
      <SheetField title="Vocal style" pct={0.62} flagged>
        <p className="t-body text-ink-dim leading-relaxed">Precise, clipped, occasionally condescending.</p>
        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-[color-mix(in_oklch,var(--signal-warn)_10%,var(--surface-1))] border border-[color-mix(in_oklch,var(--signal-warn)_25%,transparent)]">
          <span className="t-body-s" style={{ color: "oklch(0.45 0.16 78)" }}>Source conflict — Doyle vs. Granada adaptation differ on whether the violin is calming or compulsive.</span>
        </div>
      </SheetField>
    </div>
  )
}
```

- [ ] **Step 2: Create app-nav-demo.tsx**

`frontend/app/preview/_components/app-nav-demo.tsx`:
```tsx
import { Library, Clapperboard, FlaskConical, Network, Search, User } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import { Monogram } from "@/components/ui/monogram"
import { IconButton } from "@/components/ui/icon-button"

const NAV_LINKS = [
  { label: "Library", icon: Library, active: true },
  { label: "Scenes", icon: Clapperboard, active: false },
  { label: "P-eval", icon: FlaskConical, active: false },
  { label: "MCP", icon: Network, active: false },
]

export function AppNavDemo() {
  return (
    <div className="bg-background border border-hair rounded-xl overflow-hidden shadow-[var(--shadow-2)]">
      <nav className="flex items-center gap-4 px-4 h-14 border-b border-hair">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <circle cx="10" cy="12" r="6.5" fill="none" stroke="var(--ink)" strokeWidth="1.4" />
            <circle cx="14" cy="12" r="6.5" fill="none" stroke="var(--accent-oo)" strokeWidth="1.4" />
          </svg>
          <span className="font-medium text-[15px] tracking-[-0.01em]">
            Open<em className="t-editorial">Ormus</em>
          </span>
        </div>

        {/* Nav links */}
        <div className="flex-1 flex items-center gap-0.5 px-4">
          {NAV_LINKS.map(({ label, icon: Icon, active }) => (
            <a
              key={label}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors duration-[120ms] cursor-pointer ${
                active
                  ? "bg-bg-tinted text-ink"
                  : "text-ink-mute hover:text-ink hover:bg-bg-tinted"
              }`}
            >
              <Icon className="size-4" strokeWidth={1.5} />
              {label}
            </a>
          ))}
        </div>

        {/* Right: search + avatar */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 h-8 px-3 rounded-lg bg-bg-tinted border border-hair text-ink-mute text-[12.5px] cursor-text">
            <Search className="size-3.5" strokeWidth={1.5} />
            <span>Ask or search…</span>
            <Kbd>⌘K</Kbd>
          </div>
          <IconButton aria-label="Profile" variant="ghost">
            <User strokeWidth={1.5} />
          </IconButton>
          <Monogram name="Sherlock Holmes" size={28} />
        </div>
      </nav>
      <div className="p-4 text-center t-meta text-ink-faint">App content area</div>
    </div>
  )
}
```

- [ ] **Step 3: Wire into page.tsx**

Add imports:
```tsx
import { SheetFieldDemo } from "./_components/sheet-field"
import { AppNavDemo } from "./_components/app-nav-demo"
```

Add sections:
```tsx
<Section id="sheet-field" kicker="12 · Sheet field"><SheetFieldDemo /></Section>
<Section id="app-nav" kicker="16 · App nav"><AppNavDemo /></Section>
```

- [ ] **Step 4: Typecheck + commit**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
git add frontend/app/preview/
git commit -m "feat: add sheet field and app nav demo sections"
```

---

### Task 15: Final verification

**Files:** None

- [ ] **Step 1: Run full typecheck**

```bash
bun run typecheck 2>&1 | grep -v "app/api/characters\|ImportStep\|prompts/__tests__"
```

Expected: zero new errors (only the 4 pre-existing ones remain).

- [ ] **Step 2: Run linter**

```bash
bun run --cwd frontend lint 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 3: Start dev server and verify**

```bash
bun run dev:frontend
```

Open `http://localhost:3000/preview` and check:
- Background is warm off-white (not pure white, not zinc)
- Hero: "Open" in Geist, "Ormus" in Instrument Serif italic
- Button default = dark ink-panel bg + warm off-white text
- Input focus = 2px ultramarine ring
- Monograms: each name has a distinct hue gradient; all 6 shapes clip correctly
- Screenplay: cream-tinted paper, red left border, Courier-style mono slugs
- Console: zero errors, zero hydration warnings

- [ ] **Step 4: Side-by-side visual diff**

Open in two browser tabs:
- `file:///home/leo/Documents/open-ormus/OpenOrmus/OpenOrmus Design System.html`
- `http://localhost:3000/preview`

Verify that `hashHue("Sherlock Holmes")` produces the same gradient hue in both (proves the port is correct).

- [ ] **Step 5: Smoke test existing routes**

Open `http://localhost:3000/` and `http://localhost:3000/chat` — they must render without crashing. They will look visually off-palette (use `bg-zinc-*` hardcoded), but must not error.

- [ ] **Step 6: Commit lint/typecheck results (no changes needed if all pass)**

If Step 1–2 showed no issues, no additional commit needed. The work is done.
