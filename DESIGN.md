# openplate Design Language

Distilled from lowcarbcheck (`apps/remix-lcc`) — openplate is a sibling product and shares the
family DNA: a neutral zinc scale carrying all surfaces, a single **teal** brand accent, and a
traffic-light **carb-status color system** doing the semantic heavy lifting. The overall feel is
"trustworthy nutrition tool" — clean, data-forward, slightly technical — not a playful consumer app.

openplate keeps its shadcn/Tailwind-4 CSS-variable architecture (LCC predates it); this document
maps LCC's literal-palette language onto openplate's semantic tokens. When adding UI, follow the
recipes here instead of inventing new ones.

---

## 1. Principles

1. **Zinc carries the chrome, teal carries the brand, traffic-light carries the data.** Almost
   everything is neutral. Teal appears only where attention belongs: primary CTAs, active nav,
   focus rings, links, progress. Green/amber/red appear only to communicate carb quality.
2. **Feedback is mandatory.** Every async action shows its state: pending buttons get a spinner,
   navigations get the top progress bar, mutations confirm with a toast, destructive actions get a
   real dialog (never `window.confirm`). Nothing the user triggers may look frozen.
3. **Data reads at a glance.** Macro numbers are compact, mono-spaced, and color-coded by carb
   status. A user should identify "low-carb" without reading a number.
4. **Dark mode is a first-class parallel palette**, not an inversion. Every recipe below has an
   explicit dark variant.
5. **Soft but dense.** Generous radii (`rounded-2xl` primary content cards, `rounded-full` pills),
   subtle shadows, compact information density. (M129/01 bumped the dominant card radius from
   `rounded-lg`.)

---

## 2. Color tokens

Semantic tokens live in `app/app.css` as HSL triplets (shadcn convention). **M129 retired the
zinc neutrals**: every surface and hairline now sits on the brand's own hue (192°) at low chroma,
so the chrome, the page and the cards read as one teal-tinted family instead of a teal accent
dropped onto a cold grey app. Values below are the current ones — read `app/app.css` for the
per-token rationale comments.

| Token                  | Light                      | Dark                       | Usage                         |
| ---------------------- | -------------------------- | -------------------------- | ----------------------------- |
| `--background`         | `192 34% 96%` pale teal    | `192 24% 4.5%` teal-black  | page                          |
| `--foreground`         | `200 18% 8%`               | `180 12% 97%`              | text (18:1 / 18:1)            |
| `--card`               | white                      | `192 20% 8%`               | card surfaces                 |
| `--muted` / `--accent` | `192 26% 93%`              | `192 16% 15%`              | hover surfaces, subdued fills |
| `--muted-foreground`   | `197 14% 38%`              | `190 12% 68%`              | secondary text (6:1 / 9:1)    |
| `--border` / `--input` | `192 22% 85%`              | `192 16% 17%`              | hairlines                     |
| `--primary`            | `179 92% 25%`              | `172 70% 52%`              | CTAs, links, active nav       |
| `--primary-foreground` | white                      | `187 90% 8%`               | text on primary               |
| `--destructive`        | `0 72% 45%`                | `0 70% 45%`                | delete/disconnect             |
| `--ring`               | same as `--primary`        | same as `--primary`        | focus rings                   |
| `--accent-amber`       | `32 94% 31%` ochre         | `38 94% 62%`               | "over goal" text + ring arc   |
| `--macro-carbs`        | `181 93% 32%`              | `172 70% 52%`              | ratio-bar fill / legend rule  |
| `--macro-protein`      | `349 66% 50%`              | `349 82% 70%`              | ratio-bar fill / legend rule  |
| `--macro-fat`          | `36 95% 38%`               | `38 94% 62%`               | ratio-bar fill / legend rule  |
| `--macro-fiber`        | `125 34% 38%`              | `125 34% 62%`              | ratio-bar fill / legend rule  |

`--accent-amber` and `--macro-fat` are deliberately separate tokens with different values: the
first carries text (4.5:1 floor), the second is fill-only (3:1 floor) and can stay brighter. Macro
color is never the only cue — every macro figure is also named, ordered, and position-coded.

Chart palette (from LCC, same value both modes): sky `#5899DA`, rose `#EE6868`, emerald `#19A979`,
grape `#945ECF`, navy `#2F6497`, orange `#FF9F40`, yellow `#FFD700`, brown `#8B4513`.

**Teal discipline (revised in M129):** the neutrals are teal-tinted everywhere, but a *saturated*
teal surface is still rationed. Exactly three utilities may paint one, all defined in `app.css` and
all expressed as `hsl(var(--primary) / …)` gradients — never a literal:

- `.surface-brand` — the ONE hero card per screen (diary day summary, trends "This week", the
  landing preview). One per screen, never two.
- `.surface-brand-soft` — placeholder/empty-state panels, paired with `border-dashed`.
- `.brand-glow` — the landing hero backdrop only.

Everything else keeps `bg-card`. Ordinary cards, list rows and inputs never get a brand fill.

**One hero per screen, named:** diary → the day summary; overview → "Today"; trends → "This week";
landing → the preview card; fasting → whichever of the three state cards is on screen (plan /
scheduled / active) — the state changes, the count does not. Adding a second `.surface-brand` to any
of those screens is a bug. (Fasting is the first screen whose hero IDENTITY is state-dependent, which
is why it is spelled out: the fix for "two of these states look unbranded" is not to give a second
card a brand fill. `profile` no longer appears above because that route is gone — it redirects to
`/settings`.)

**Where the brand shows up outside a hero** (M129/06 "lean into it" pass) — these are the only
sanctioned brand-carrying treatments on ordinary surfaces, all token-only:

| Surface | Treatment |
| --- | --- |
| Section labels (meal groups, chip rows, search-result groups, drill-down blocks) | `<SectionEyebrow>` — `text-[11px] font-semibold uppercase tracking-[0.11em] text-primary`, optional `trailingRule` hairline at `bg-primary/20` |
| Card titles, app-wide | `font-display` (Fraunces) via the `CardTitle` primitive — never on a live figure, see §4 |
| Interactive row/chip hover | `hover:border-primary/40 hover:bg-primary/5` (replaces the old literal `teal-300`/`teal-600` pair) |
| Group subtotals (meal net carbs) | `rounded-full bg-primary/10 px-2 py-0.5 text-primary` pill |
| Active bottom-nav tab | `bg-primary/5` + a `after:` top rule at `bg-primary` |
| Drill-down panel inside a hero | `rounded-xl border-primary/15 bg-card/70` — an inset card, because `.surface-brand`'s gradient has faded out by the bottom of a tall card |

---

## 2b. Day carb-impact chip (M129/06)

The diary hero's novice-first verdict — "Low / Moderate / High carb impact" against the user's
net-carb ceiling, or against the documented 50 g reference when they've set none. Tiers and the
non-shaming rationale live in `app/lib/macro-gaps.ts`; the chip is `CarbImpactChip` in
`app/components/day-drill-down.tsx`.

- Palette **tops out at amber and never reaches `--destructive`** — a high-carb day describes the
  food, not the person, matching the over-goal ring arc and habit-strip dots.
- Moderate and high therefore share a hue, so **color is not the discriminator**: a three-bar level
  meter (1/2/3 lit) sits beside a label that states the tier in words.
- Distinct from §3's traffic light, which grades a FOOD's per-100 g net carbs. This grades a DAY
  against a target. Don't merge them.

---

## 3. Carb-status traffic light (the signature pattern)

Net carbs per 100 g classify into three tiers (LCC's `getCarbStatus`):

| Status     | Threshold | Text                                   | Badge / tile fill                                                          |
| ---------- | --------- | -------------------------------------- | -------------------------------------------------------------------------- |
| `low`      | ≤ 5 g     | `text-green-700 dark:text-green-400`   | `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`     |
| `moderate` | ≤ 10 g    | `text-yellow-700 dark:text-yellow-400` | `bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400` |
| `high`     | > 10 g    | `text-red-700 dark:text-red-400`       | `bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`             |

Implementation: one shared helper (`app/utils/carb-status.ts`) exporting `getCarbStatus(netCarbsPer100g)`
and the class-recipe maps. Never inline the thresholds elsewhere. Apply wherever per-100g food data
renders: curated match cards, per-food draft cards, food-log entries. Dot indicator variant:
`h-2 w-2 rounded-full bg-green-500|yellow-400|red-500`.

---

## 4. Typography

- **Body font: Inter Variable (`font-sans`) on `<body>`.** Victor Mono Variable stays available as
  `font-mono` for genuinely technical strings; Inter is the prose/UI voice.
- **Display serif: Fraunces (`font-display`)**, self-hosted from `public/fonts/` (M129/01). It
  carries the wordmark, page titles, and — since M129/06 — every **card title**, which is the
  cheapest way to give screens past the hero some brand character.
  **Never on a live figure.** The Fraunces subset has no `tnum` feature, so digits would jitter in
  width as they update. Every number that changes as you use the app (ring stat, macro grid, gap
  rows, entry rows) stays in `font-sans` with `tabular-nums`.
- Fonts are **self-hosted via `@fontsource-variable/*` imports** in `root.tsx` — never a Google
  Fonts CDN `<link>` (openplate is privacy-first, self-hosted; no third-party font beacons).
- Scale (plain Tailwind, applied consistently):
  - Page title: `text-2xl font-semibold tracking-tight`
  - Hero (landing): `text-4xl font-bold tracking-tight sm:text-5xl`
  - Card title: `text-lg font-semibold`
  - Body: `text-sm` (default) / `text-base`
  - Meta/labels/badges: `text-xs`; muted meta: `text-xs text-muted-foreground`
- Emphasis weight is `font-semibold`; `strong/b` renders 700.
- Numbers in macro grids are the mono font by default (body font) — this is intentional; keep
  tabular alignment with `tabular-nums` where columns of numbers stack.

---

## 5. Shape, elevation, spacing

- Radii: `rounded-md` buttons/inputs/thumbnails · `rounded-lg` cards, dialogs, food images
  (dominant) · `rounded-xl` feature/stat tiles · `rounded-full` pills, badges, status dots.
  `--radius: 0.5rem` stays.
- Shadows: `shadow-sm` resting cards → `hover:shadow-md` (list cards) or `hover:shadow-lg`
  (feature cards); `shadow-lg` for overlays. Never heavier at rest.
- Interactive-card hover recipe: `transition-all duration-200 hover:shadow-md
  hover:border-primary/40`. No `dark:` variant is needed — `primary` is already per-theme, which
  the literal `teal-300`/`teal-600` pair this replaces was only ever emulating. (That pair is
  banned by §11; this line used to still teach it, which is how it kept getting copied into new
  cards. §2's hover row is the same recipe for rows and chips.)
- Page container: `mx-auto max-w-3xl px-4 sm:px-6` for the app's focused single-column pages
  (openplate is narrower than LCC's `max-w-7xl` content site — keep it).
- Vertical rhythm: `space-y-6` between page sections, `space-y-4` within cards, `gap-2` label→input.

---

## 6. Component recipes

**Buttons** — shadcn variants as shipped, with `default` now teal via `--primary`. Sizes unchanged.
Pending state (see §7) is built into `SubmitButton`.

**Badges/pills** — `rounded-full px-2 py-0.5 text-xs font-medium` + a color pair from §3 (or
zinc: `bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300` for neutral chips like meal
type). Larger filter pills: `px-4 py-2`.

**Food match card** (curated data from lowcarbcheck.org) — the richest element; model on LCC's
`FoodItem`:

- Thumbnail `h-16 w-16 rounded-md object-cover bg-zinc-100 dark:bg-zinc-900`, `loading="lazy"`;
  container clips (`overflow-hidden`).
- Title `text-sm font-medium truncate`; source label `text-xs font-medium text-muted-foreground`.
- Net-carb badge colored by §3; macro summary `text-xs text-muted-foreground`.
- Outbound link `text-xs text-primary hover:underline underline-offset-4`.
- Attribution (BLS etc.) stays `text-xs text-muted-foreground` — legally required, never drop it.

**Inputs** — shadcn `Input`/`Label`. Field errors: one shared `<FieldError>` rendering
`text-sm text-red-600 dark:text-red-400` (never re-inline the red `<p>`).

**Inline alerts** — shadcn `Alert` pattern: `rounded-lg border p-4 text-sm` with icon; destructive:
`border-red-500/50 text-red-700 dark:text-red-400 [&>svg]:text-current bg-red-50 dark:bg-red-900/20`.
Use for action errors that must persist on screen (form-level failures).

**Nav** — active link: `text-primary` (teal); inactive: `text-muted-foreground hover:text-foreground`.

---

## 7. Motion & feedback (non-negotiables)

- **Global progress bar** (LCC's `indeterminate` pattern, teal): fixed `top-0 h-1 z-50`; track
  `bg-primary/20`, runner `h-full w-1/3 bg-primary animate-indeterminate` with keyframe
  `from { translateX(-100%) } to { translateX(400%) }`, `1s ease-in-out infinite`. It must run
  during **both** `useNavigation().state !== 'idle'` **and** any non-idle `useFetchers()` — slow
  action POSTs (the AI vision call) live in `submitting`, not `loading`.
- **Pending buttons**: every submit button disables and shows `Loader2` (`animate-spin`) + a
  progressive label ("Identifying…", "Saving…"). Use the shared `SubmitButton`; no bare text swaps.
- **Long AI operations** (plate identify, key verification): staged status copy driven by elapsed
  time — e.g. 0 s "Uploading photo…" → 2 s "Analyzing your plate…" → 8 s "Still working — complex
  plates take a moment…". Never leave a silent multi-second gap.
- **Toasts** (sonner, mounted in root): success confirmations for every mutation that redirects or
  mutates a list (logged foods, quick-add, delete, settings saved). Theme-aware — follows the
  active light/dark theme, never hardcoded. Position top-center in a band just below the header
  (safe-area-aware offsets; the container is `pointer-events-none` so only the toast box itself is
  interactive and the header menu/drawer stay tappable), close button on. The bottom of the screen
  belongs to the tab bar and the raised Scan button — toasts never cover them.
- **Destructive actions**: AlertDialog confirmation (`ConfirmAction`) with a destructive button and
  pending spinner — `window.confirm` is banned.
- **Radix enter/exit**: `tw-animate-css` data-state animations as shipped (fade/zoom/slide).
- **Micro-interactions**: `transition-colors` default; images in interactive cards
  `group-hover:scale-105 transition-transform duration-200`; arrow affordances
  `group-hover:translate-x-1`.
- **Add feedback (M129/03)** — logging a food is the app's core action, so it gets real feedback,
  all of it `motion-safe:`-gated:
  - the hero figure **counts** old → new over ~400ms (`useCountUp`), always from the value
    currently on screen and cancelling any in-flight tween — a second add continues, never
    restarts or stacks;
  - the ring arc is driven by that same tweened scalar (`RingProgress`'s `animatedValue`), so the
    number and the arc can't drift apart. `aria-valuenow` keeps the REAL value, never a frame;
  - **one toast per action, not per row.** Every add path writes through the single
    `FOOD_ADDED_TOAST_ID`, so a four-item plate or four chip taps collapse into one updating toast.
- **Celebrations are rationed to genuine firsts**: first food ever logged, first AI-identified
  plate, a full seven-day window. One `animate-celebrate` border pulse on the hero card plus a
  one-line note, banked in `localStorage` so it can never fire twice. No confetti library, no
  badges, no streak scores. Anything that could fire weekly is not a celebration.

---

## 8. Imagery

- Food/plate images: `aspect-video` in cards (`object-cover`), `rounded-lg` via container clip,
  placeholder backdrop `bg-zinc-100 dark:bg-zinc-900`. Thumbnails `rounded-md` at `h-12`–`h-16`.
- The plate-photo preview (pre-upload) uses the same aspect-video card treatment; during
  identification it gets a `backdrop-blur` overlay with spinner + staged copy.
- Plate photos are **never persisted** — previews are client-side object URLs, revoked on change.

---

## 9. Dark mode

Class-based (`.dark` on `<html>`), hand-rolled localStorage toggle (light/dark/system). Rules:
every new component ships both palettes; overlays and toasts must resolve the active theme (no
hardcoded `theme="light"` anywhere); status colors use the §3 dark pairs (`-900/30` fills, `-400`
text) — never raw `-100` fills in dark.

---

## 10. Voice

One register, everywhere: **warm, plainspoken, non-shaming, and literally true** — the Goals page
is the reference. Rules, in priority order:

1. **Never imply the user failed.** Over a goal is amber and factual ("12g over today"), never red,
   never an exclamation, never a negative remainder. A gap is a number, not a verdict. Copy
   describes the FOOD or the DATA, never the person.
2. **Never claim more than is true.** The honesty copy — photo retention, "your key, your
   provider", local-first storage — is load-bearing product truth. Rewrite it for warmth, never for
   comfort. The backup banner leads with the architecture ("Your diary only lives here — one
   device, no cloud."), not with what the user neglected to do.
3. **Sentence case, ordinary words.** No Title Case buttons, no operator jargon ("instance",
   "server logs", "invalid") in anything a normal user can reach. "Log in" everywhere — never
   "Login", never a second synonym.
4. **Confirmations end in a period and state the outcome** ("Goals saved.", "Entry updated.").
   The add toast additionally reports the running total, because the number is the reason the user
   logged the food: `Added ⟨food⟩` / `To ⟨meal⟩ — Xg net carbs so far today.`
5. **Empty is not an error.** "Empty plate so far." — never "Nothing logged", never "No data".
6. **"Coming soon" is a dead end.** Say what isn't built, what works instead today, and how long
   the workaround takes.
7. **One phrasing per idea.** A sentence that appears on two screens is a bug in one of them (the
   duplicated "This step is entirely optional." lived on both `/scan` and AI settings until
   M129/03 kept it on `/scan` only).

### Hero framing (M129/03)

The diary hero is REMAINING-first, and all five framings come from one tested function
(`formatHeroStat` in `app/components/hero-stat.tsx`) — never re-derived at a call site:

| state | tier 1 | tier 2 | tier 3 |
| --- | --- | --- | --- |
| under a carb goal | `7.9` | `g left of 50` | `net carbs` |
| over a carb goal | `12` | `g over today` | `net carbs` (amber) |
| under a calorie goal | `620` | `left of 1800` | `calories` |
| over a calorie goal | `120` | `over today` | `calories` (amber) |
| no goal at all | `42.1` | `g net carbs` | — |

The ring tracks whichever budget the user actually set (carbs first, calories for a calorie-only
tracker, no ring at all with neither). The impact chip and the protein figure compose underneath
unchanged — the chip still grades the DAY qualitatively (§2b), which is why it can coexist with a
calorie hero.

## 11. Don'ts

- No new accent colors. Brand washes are allowed but rationed — only the three `app.css` utilities
  in §2, only in the places listed there, and never as a raw color literal in a component.
- No `text-teal-*`/`bg-emerald-*`/`bg-zinc-*` literals in app code — every brand, macro and neutral
  value is a token. Colour literals belong in `app/app.css` and nowhere else.
- No `window.confirm` / `window.alert`.
- No unlabeled spinners as page content — spinners attach to the thing that's pending.
- No Google Fonts / CDN assets — self-hosted only.
- No inline threshold logic for carb colors — always `app/utils/carb-status.ts`.
- No new one-off card/badge class combos when a recipe above fits.
