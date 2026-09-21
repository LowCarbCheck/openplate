# openplate Design Language

Distilled from lowcarbcheck (`apps/remix-lcc`). openplate is a sibling product and shares the
family DNA: a neutral scale carrying all surfaces, a single **teal** brand accent, and a
traffic-light **carb-status color system** doing the semantic heavy lifting. The overall feel is
"trustworthy nutrition tool", clean, data-forward, slightly technical, never a playful consumer app.

openplate keeps its shadcn/Tailwind-4 CSS-variable architecture (LCC predates it); this document
maps LCC's literal-palette language onto openplate's semantic tokens. When adding UI, follow the
recipes here instead of inventing new ones.

## Lineage: what M243 took from lowcarbcheck.org, and what it refused

M243 pulled the family resemblance much closer, and it is worth naming both halves.

**Kept from LCC:** a monospace body voice, graph paper behind the hero, flat cards with a hairline,
a radius ladder where each step means one kind of object, a grey section label, and an accent spent
a countable number of times per screen.

**Refused on purpose:** LCC's emerald (openplate-brand owns the teal, and which teal wins is still
an open question for a person), its polychrome pastel chip rows, and its tinted section bands. Two
things a reader notices first are also out of scope: the raised round Scan button, whose geometry
carries three documented clearances, and `public/landing/*`, whose screenshots still show the
pre-M243 look.

**Why the M129 choices were reversed, so a third flip needs a real argument.** M129 put the body in
Inter, bumped the dominant card radius to `rounded-2xl`, tinted the chrome with the brand hue, and
set every card title in the display serif over a wide-tracked teal label. The operator read that on
a phone, called the result generic and AI generated, and asked for lowcarbcheck.org's design
instead. That is the whole reason: a taste call by the person who owns the product, not a
measurement. Anyone proposing Inter bodies, one radius or serif card titles again is proposing to
reverse that decision and owes an argument of the same kind. The seams are cheap on purpose: the
body face is one line (`--font-body` in `app/app.css`) and every number the tests read is one file
(`tests/design-contract.ts`).

---

## 1. Principles

1. **The neutrals carry the chrome, teal carries the brand, traffic-light carries the data.** Almost
   everything is neutral. Teal appears only where attention belongs: primary CTAs, active nav,
   focus rings, links, progress. It is counted rather than judged by eye: §6 freezes a ceiling per
   screen. Green/amber/red appear only to communicate carb quality.
2. **Feedback is mandatory.** Every async action shows its state: pending buttons get a spinner,
   navigations get the top progress bar, mutations confirm with a toast, destructive actions get a
   real dialog (never `window.confirm`). Nothing the user triggers may look frozen.
3. **Data reads at a glance.** Macro numbers are compact, mono-spaced, and color-coded by carb
   status. A user should identify "low-carb" without reading a number.
4. **Dark mode is a first-class parallel palette**, not an inversion. Every recipe below has an
   explicit dark variant.
5. **Shape ranks things, and nothing is heavy at rest.** Five radius steps, each one a kind of
   object (§5), plus `rounded-full` for pills. A resting card is `shadow-sm`, never heavier, with
   the one sanctioned exception in §5. Information density stays compact. (M129/01 had put every
   card on `rounded-2xl`; M243 spec 03 restored the ladder, which is what §5 had said all along.)

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

**Teal is a rationed ACCENT, never a rationed SURFACE (M243 spec 04).** M129 read the rule the other
way: three utilities painted a saturated `hsl(var(--primary) / …)` wash, and seven screens then read
as a tinted card on a tinted page. The three utilities keep their names and their jobs, and none of
them paints the brand hue any more. All three live in `app.css`, all three are token-only, never a
literal:

- `.surface-brand` is the one hero panel per screen. A flat `bg-card` fill on the border colour at
  `shadow-sm`, with §5b's graph paper drawn inside it. The paper is what marks the hero now that
  the fill is an ordinary card fill.
- `.surface-brand-soft` is a placeholder or empty-state panel, `bg-muted/40`, paired with
  `border-dashed` on the border colour at every call site.
- `.brand-glow` is the landing hero backdrop only, a muted radial, not a brand one.

Everything else keeps `bg-card`. Ordinary cards, list rows and inputs never get a brand fill.

**At most one hero per screen, named:** diary is the day summary; overview is "Today"; trends is
"This week"; landing is the screenshot frame; fasting is whichever of the three state cards is on
screen (plan, scheduled, active), so the state changes and the count does not. The rule is "at
most one", because an empty diary and a first visit legitimately draw none. A second
`.surface-brand` on any of those screens is a bug, and it is a browser fact rather than a
convention: `tests/e2e/lcc-lineage-hero.spec.ts` counts the elements on each screen in both the
empty and the logged state, with a second-hero control that must go red. (Fasting is the one screen
whose hero IDENTITY is state-dependent, which is why it is spelled out: the fix for "two of these
states look unbranded" is not to give a second card a brand fill. `profile` no longer appears above
because that route is gone, it redirects to `/settings`.)

**Where the brand shows up outside a hero.** These are the only sanctioned brand-carrying
treatments on ordinary surfaces, all token-only, and every one of them is counted against the
screen's ceiling in §6:

| Surface | Treatment |
| --- | --- |
| Section labels (meal groups, chip rows, search-result groups, drill-down blocks) | `<SectionEyebrow>`, and it is NOT brand-carrying any more: `text-xs font-semibold uppercase tracking-wide text-muted-foreground`, optional `trailingRule` hairline at `bg-border`. Exported as `SECTION_EYEBROW_CLASS` for the one inline copy (`fast-strip.tsx`). |
| Card titles, app-wide                                                            | `text-lg font-semibold tracking-tight` in the body face, the `CardTitle` default with no per-card override. No serif, see §4.                                                                                                                                      |
| The wordmark in the header kicker                                                | `text-primary` on `<Wordmark>`, the product's own name.                                                                                                                                                                                                            |
| Active bottom-nav tab                                                            | `bg-primary/5` + `text-primary` + a `after:` top rule at `bg-primary`. Three cues, so it never depends on hue alone.                                                                                                                                               |
| The one primary action per screen                                                | the default filled `Button`. One per screen, and a secondary action is never a second filled button.                                                                                                                                                               |
| Links                                                                            | `text-primary hover:underline underline-offset-4` in the app, `decoration-primary/30` under a landing secondary action.                                                                                                                                            |
| Interactive row/chip hover, and the just-added row                               | `hover:border-primary/40 hover:bg-primary/5`, and `border-primary/50 bg-primary/10` while an entry is freshly added. Hover is invisible on a phone and headless, so it costs nothing on the ceiling there.                                                         |
| The "logging to a past day" banner                                               | `border-primary/20 bg-primary/5` with a `text-primary` icon. Informational, never a warning, so no amber and no red.                                                                                                                                               |
| Landing screenshot frames                                                        | the hero frame's sanctioned `border-primary/55 shadow-2xl shadow-primary/20` (see §5), and `border-primary/25 shadow-md shadow-primary/5` on every shot below it.                                                                                                  |
| An award a person holds                                                          | the brand fill on `award-tile.tsx`'s `default` variant.                                                                                                                                                                                                            |

Group subtotals are **no longer** on this list. A meal's net carbs, a nutrient's share of its
target and a bundle's item count were all a `bg-primary/10 text-primary` pill; they use
`CHIP_NEUTRAL` now (§6). A number is a number, and spending the accent on arithmetic leaves
nothing to point at what a person should do.

---

## 2b. Day verdict chip (M129/06, regraded by the lens in M210)

The diary hero's novice-first verdict, one grade per day, chosen by the account's eating style.
The style (`app/lib/eating-style.ts`) carries a `lens`, and the lens decides which single chip the
day gets: `carb` renders the carb impact against the person's own net-carb ceiling, `kcal` renders
a three tier calorie verdict (within, near from 0.9 of the target, over above it), `protein`
renders two states against the floor (to go, met), and `none` renders no chip at all. The
arithmetic is `dayVerdict` in `app/lib/macro-gaps.ts`; the chips are `DayVerdictChip`,
`CarbImpactChip`, `KcalBudgetChip` and `ProteinChip` in `app/components/day-summary-details.tsx`.

- **A day with no goal is not graded.** The carb chip used to fall back to a documented 50 g
  reference for someone who had set no ceiling, which put a number in front of a person who had
  never seen it. M210 deleted that reference: a lens is either backed by a number the person set,
  or there is no verdict.
- Palette **tops out at amber and never reaches `--destructive`**, a day past its line describes the
  food, not the person, matching the over-goal ring arc and habit-strip dots. Protein never wears
  amber at all, since a floor cannot be exceeded.
- Tiers within a lens can share a hue, so **color is not the discriminator**: a three-bar level
  meter (1/2/3 lit) sits beside a label that states the tier in words.
- Distinct from section 3's traffic light, which grades a FOOD's per-100 g net carbs. This grades a
  DAY against a target. Don't merge them.

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

**A screen asks for a ROLE, never for a face.** Three roles are declared in the `@theme` block of
`app/app.css`, and they are the only names a component may use. A taste reversal is then one line
there instead of a sweep of the tree.

| Role | Declares | Utility | Who asks for it |
| --- | --- | --- | --- |
| `--font-body` | `'Victor Mono Variable', 'Inter Variable', ui-monospace, monospace` | `font-body` | `<body>`, so the whole app |
| `--font-prose` | `'Inter Variable', sans-serif` | `font-prose` | `.prose` and the four legal pages |
| `--font-brand` | `'Victor Mono Variable', ui-monospace, monospace` | `font-display` | the `Wordmark` component, and nothing else |

Three more `--font-*` names sit in the same block and are NOT roles. `--font-sans` and `--font-mono`
are Tailwind's own variable names, read by the `font-sans` and `font-mono` utilities; they still
declare Inter and Victor Mono, which is how a one-off technical string can name a FACE, and no
component in this app should need to. `--font-display` is an alias for `var(--font-brand)`, and it
exists only so the Tailwind utility of that name resolves to the brand role.
`tests/unit/design-md-in-sync.test.ts` fails if a `--font-*` name is added to the `@theme` block and
this document does not learn it.

- **Body face: Victor Mono Variable (M243 spec 01).** The monospace voice is the single largest
  piece of the lowcarbcheck resemblance. Inter Variable sits behind it in the stack for a glyph
  Victor Mono lacks, then the device's own monospace. Ligatures are off app-wide
  (`font-variant-ligatures: none` on `body`): Victor Mono joins `->` and `<=` into one glyph, and
  people type exactly those into food names.
- **Long-form reading stays in Inter**, through the `prose` role. A monospace paragraph at 16px in
  a 358px column measures about 35 characters per line, below the readable floor, and the German
  terms page grows by 27 percent. lowcarbcheck.org does the same from the other side: seven of its
  densest route containers opt back into the sans face.
- **The wordmark is thin, in two colours, and it is one component.** The word "openplate" is set
  in the brand role (`--font-brand`, reached through `font-display`) by the `Wordmark` component and
  nowhere else. The recipe was decided by the operator on 2026-09-21, after judging it against the
  real fonts: Victor Mono at its lowest weight, 100, tracking `-0.03em`, "open" in brand teal and
  "plate" in the ink of the place it sits in. It was Fraunces, a display serif, from M129 until then.
  The role still names the same Victor Mono the body uses, so the wordmark is told apart by weight
  and colour and no longer by a face of its own. It stays a role so that changing the face of the
  name is one line, and `tests/unit/wordmark-brand-role.test.ts` fails if the class appears anywhere
  else under `app/`. Monospace helps here: every letter is 0.6em wide at every weight, so Thin and
  Bold are the same width and no row around the word reflows.
- **Centred on the mark by its x-height.** Where the word sits in a row beside the mark, `Wordmark`
  takes `besideMark`, which lifts it by `0.08em` (1.4 px at 18). A flex row centres the line box, and
  the eye reads the middle of the lowercase letters, so without the lift the word hangs low.
  `tests/e2e/wordmark.spec.ts` measures it on a real page to within a pixel. The phone header's
  kicker and the landing heading have no mark beside them and do not take it.
- **Never the brand role on a live figure.** It is weight 100, a hairline, and it belongs to a name.
  **Keep `tabular-nums`** on every number that changes as you use the app (ring stat, macro grid,
  gap rows, entry rows). Victor Mono is tabular by construction, so the class is redundant today; it
  is what makes a rollback to a proportional body face safe.
- Fonts are **self-hosted**, Inter and Victor Mono via `@fontsource-variable/*` imports in
  `root.tsx`. There is no other font file: the 67 KB Fraunces file went with the serif. Never a Google Fonts CDN `<link>`
  (openplate is privacy-first and self-hosted, no third-party font beacons).
- Scale (plain Tailwind, applied consistently). A monospace reads optically larger than Inter at
  the same pixel size, which is why the header title stepped down in M243:
  - Header page title on a phone: `truncate text-sm font-semibold leading-tight tracking-tight md:text-xl`.
    14px, and MEASURED: it is the largest whole pixel size at which no route title in any of the
    six languages clips harder than Inter at 18px did, at 390px and at 360px. It is also the floor
    in `tests/design-contract.ts`, so the next clip cannot be "fixed" by shrinking the title.
  - Landing wordmark: `text-5xl sm:text-6xl`, the weight and the tracking come from `Wordmark`
  - Card title: `text-lg font-semibold leading-tight tracking-tight text-balance` (the `CardTitle`
    primitive's default; auth and onboarding screens override the size). It is 18px on every card.
    M243 had stepped it to 16px while fourteen Insights cards kept an explicit `text-lg`, so one
    screen drew both sizes over the same 14px body and no title stood clear of the text under it.
    On 2026-09-21 the operator called the cards flat, with no visual hierarchy. The default went
    back to 18px and the overrides were deleted. `CARD_TITLE_OVER_BODY_MIN_RATIO` in
    `tests/design-contract.ts` holds the gap, and `tests/e2e/lcc-lineage-hierarchy.spec.ts` measures
    it on a device that has data, which the empty-state read in `lcc-lineage-labels.spec.ts` never saw.
  - Body: `text-sm` (default) / `text-base`
  - Meta/labels/badges: `text-xs`; muted meta: `text-xs text-muted-foreground`
- **A card reads in tiers, and each tier looks different, not just a little smaller.** In one face
  at three nearby sizes, size alone does not separate a label from prose, so the tiers also differ
  in case, weight and grey: a title (18px, semibold, ink), a description or note (14px or 12px,
  muted, sentence case), a label (12px, semibold, muted, UPPERCASE: the section label recipe) and
  a figure (20px, semibold, `tabular-nums`, ink). A stat is a label over a figure with an optional
  note under it, and that is `StatTile` (`app/components/trends/stat-tile.tsx`): the weight card,
  the range summary and the fasting stats all use the same label. **A stat tile holds a figure,
  never a sentence.** A stat that has no figure yet gets no tile, and one quiet line under the row
  says why. A filter group is named by the same section label, from the legend it already had.
- Emphasis weight is `font-semibold`; `strong/b` renders 700.
- Numbers in macro grids are the body face, which is now genuinely the mono font. Keep
  `tabular-nums` where columns of numbers stack.

---

## 5. Shape, elevation, spacing

**THE RADIUS LADDER (M243 spec 03).** Five steps, and each step is one kind of object. Anything at
the same step is the same kind of object, which is the whole point: a person learns the ladder once
and then reads a screen faster. One radius used to mean everything, so the shape of a thing said
nothing about what the thing was.

| Tier | Class | px | What wears it |
| --- | --- | --- | --- |
| `dataRow` | `rounded` | 4 | a data row inside a panel: label, value, status |
| `control` | `rounded-md` | 6 | buttons, inputs, composer keys, thumbnails |
| `card` | `rounded-lg` | 8 | every card, every inset group, every list row, every panel |
| `tile` | `rounded-xl` | 12 | a tile in a grid |
| `hero` | `rounded-2xl` | 16 | the one hero per screen, dialogs, sheets, the landing frame |

`rounded-full` is the sixth and is not a step: pills, badges, dots and avatars are round because
they are round, not because of where they sit. `--radius: 0.5rem` stays.

The ladder lives as numbers in `tests/design-contract.ts` (`RADIUS_TIER_PX`, `RADIUS_TIER_CLASS`),
which is where a reversal is a one-line edit. `tests/unit/radius-tiers.test.ts` holds an allowlist
of the eleven sites still permitted to draw 12px or 16px, with the reason beside each one, and
`tests/e2e/lcc-lineage-shape.spec.ts` reads the COMPUTED radius of each tier in a real browser. A
radius is never a test's way of FINDING an element: `Card` carries `data-slot="card"` for that,
because a selector like `div.rounded-2xl.bg-card` fails the day a taste call moves and passes
vacuously the day it moves and nobody notices.

- Shadows: `shadow-sm` on resting cards, `hover:shadow-md` (list cards) or `hover:shadow-lg`
  (feature cards), `shadow-lg` for overlays. Never heavier at rest, with ONE sanctioned exception:
  the landing hero's screenshot frame, `border-primary/55 shadow-2xl shadow-primary/20` (and
  `dark:border-primary/40 dark:shadow-primary/10`), because it is a product photograph that has to
  lift off the page rather than a card the user can act on (M146). It is the same element as §2's
  single landing `.surface-brand`, so the exception cannot spread without breaking that rule first.
- Interactive-card hover recipe: `transition-colors duration-300 hover:border-primary/40
  hover:bg-primary/5`. No `dark:` variant is needed, because `primary` is already per-theme, which
  the literal `teal-300`/`teal-600` pair it replaces was only ever emulating. (That pair is banned
  by §11 and four of them still exist, see §11. §2's hover row is the same recipe for rows and
  chips. Hover is invisible on a phone and under headless Chromium, so a layout or colour claim
  may never depend on it.)
- Page container: `mx-auto max-w-3xl px-4 sm:px-6` for the app's focused single-column pages
  (openplate is narrower than LCC's `max-w-7xl` content site — keep it).
- Vertical rhythm: `space-y-6` between page sections, `space-y-4` within cards, `gap-2` label→input.

---

## 5b. Texture: the graph paper (M243)

The one piece of texture in the app, taken from lowcarbcheck.org's hero, and the cheapest thing
that stops a screen reading as a scaffolded template. It is a CSS utility in `app.css`, drawn from
tokens, with no image, no SVG and no new colour:

```css
.surface-grid {
  background-image:
    linear-gradient(to right, hsl(var(--border) / 0.7) 1px, transparent 1px),
    linear-gradient(to bottom, hsl(var(--border) / 0.7) 1px, transparent 1px);
  background-size: 28px 28px;
  background-position: -1px -1px;
}
```

- **`--border` is themed**, a pale teal-grey in light and a deep one in dark, so the paper reads in
  both themes from one declaration, with no second rule, no new token and no literal.
- **28px cells.** The original SVG stretches to about 128px at desktop width, which is far too
  coarse for a 390px column.
- **Seven tenths alpha, in both places the paper is drawn.** Three tenths was tried first, out of
  a worry about the 12px captions under the hero figures, and at three tenths the paper is simply
  not there in either theme. What keeps the paper off the small text is the CONTENT, the data rows
  and inner cards carry fills of their own, not a weaker line. The cell and the alpha are
  `GRID_CELL_PX` and `GRID_LINE_ALPHA` in `tests/design-contract.ts`.

**Where it is drawn, and where it is NOT.** Two places only: inside the one hero panel
(`.surface-brand` declares its own copy, §2) and behind the landing hero section (`.surface-grid`
on the wrapper in `app/routes/index.tsx`). It is deliberately **not** on the app shell's `<main>`,
which was the first proposal: opaque cards would leave the paper visible only in 16px gutters and
behind the smallest grey text, which is noise rather than texture.
`tests/e2e/lcc-lineage-hero.spec.ts` asserts the dashboard's hero is the only element on that
screen painting a grid, with a second-hero control that must break both that claim and the count.

---

## 6. Component recipes

**Buttons** — shadcn variants as shipped, with `default` now teal via `--primary`. Sizes unchanged.
Pending state (see §7) is built into `SubmitButton`.

**The teal budget, counted per screen (M243 spec 05b).** "Use the accent sparingly" has never
stopped a single teal icon from being added, because no one addition is the one that breaks the
page. `TEAL_BUDGET_CEILING` in `tests/design-contract.ts` freezes the number each screen measured
on the build that shipped: `/settings` 2, `/trends` 4, `/add` 5, `/diary` 9, `/dashboard` 12. A
number counts one element inside `main` whose own text colour, background colour or drawn border
resolves to `--primary` at any alpha above zero, and `tests/e2e/lcc-lineage-teal-budget.spec.ts`
does the counting with an injection control that proves one more element breaks the ceiling. Every
screen pays two before it draws anything of its own, the header wordmark and the raised launcher,
and `/settings` is exactly those two. The next feature that wants the brand colour takes it away
from something else, or moves a line in that file on purpose.

**Rows.** Three named surfaces in `app/components/list-row.ts`, because four lists used to draw
the same idea three ways:

- `LIST_ROW_CLASS` = `rounded-lg border bg-card p-3`, a NAVIGABLE row. It goes somewhere, so it is
  a card you can tap: a card's fill, a card's hairline, the ladder's card step. `LIST_STACK_CLASS`
  (`space-y-3`) is the distance between two of them.
- `DATA_ROW_CLASS` = `flex items-center gap-2 rounded bg-muted/40 p-3`, a DATA row inside a panel
  that is already a card. It goes nowhere, so it has no border, a quieter fill and the ladder's
  4px step. With `DATA_ROW_LABEL_CLASS`, `DATA_ROW_VALUE_CLASS` and `DATA_ROW_DOT_CLASS` it is
  label, value, dot, and nothing else: no icon, no tile, no chevron. This is lowcarbcheck.org's
  signature row.
- Giving both the same surface is what made a screen read as boxes inside boxes.

**Settings rows** keep their icon and their chevron and lost the tile. A settings row navigates, so
the chevron earns its place, and a hub of fifteen rows in six languages is scanned by shape before
it is read, so the glyph earns its place too. The glyph is `text-muted-foreground` in a `size-9`
box with no fill: fifteen teal tiles spent the whole screen's accent on decoration.
`SETTINGS_INSET_CLASS` (`rounded-lg border bg-card`) is the one container both the hub's groups and
the sub-page blocks compose.

**Badges/pills.** `rounded-full px-2 py-0.5 text-xs font-medium` plus a color pair from §3. A
NEUTRAL chip uses `CHIP_NEUTRAL` (`rounded-full bg-muted px-2 py-0.5 text-foreground`) and never a
literal palette pair; callers add their own `text-xs`, `font-medium` and `tabular-nums`, because
the size and the weight are the caller's business and the fill and the ink are not. Larger filter
pills: `px-4 py-2`. In a row of filter chips only the ACTIVE one is teal, which is
lowcarbcheck.org's list-page recipe; polychrome pastel chips were considered and refused.

**Food match card** (curated data from lowcarbcheck.org) — the richest element; model on LCC's
`FoodItem`:

- Thumbnail `h-16 w-16 rounded-md object-cover bg-muted`, `loading="lazy"`;
  container clips (`overflow-hidden`). (The shipped rows still say `bg-zinc-100 dark:bg-zinc-900`
  here, see §11.)
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
The bottom tab bar's active tab spends THREE cues, `bg-primary/5` plus `text-primary` plus an
`after:` top rule at `bg-primary`, so the state never depends on hue alone. It is one of the two
teal marks every screen pays for (see the budget above).

**Tap targets.** 44px is the floor on a phone for anything a thumb touches: buttons, icon
buttons, switches, date-picker cells, filter chips, settings rows, footer links, the drawer close
key. `tests/e2e/lcc-lineage-tap-targets.spec.ts` measures it per screen and carries exactly four
reasoned exceptions, each named in that file. Desktop sizes are unchanged. A control that will not
fit is made to wrap rather than shrink: the update ribbon wraps its sentence and keeps its two
keys at 44px, instead of cutting the version number off the end.

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
  one-line note, banked in `localStorage` so it can never fire twice. No confetti library.
  Anything that could fire weekly is not a celebration.
- **Awards are a record, not a score (M235)**: this section previously banned badges and streaks.
  The app now tracks what a person completes. Follow these constraints across all surfaces under
  `app/components/gamification/`: show no points, no levels, no leaderboards, and no peer
  comparisons. Use no loss language. Never announce a broken streak, but show the lower count on
  the next screen load. Never revoke an award after an edit or a goal change. Use amber, never
  red. Show only one number per screen. The activity streak is that number on both the dashboard
  and Progress. Let users turn off the display in preferences, and maintain the underlying
  record.

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

- No new accent colors. The brand is an ACCENT and not a surface (§2), it is counted per screen
  (§6), and it is never a raw color literal in a component. The three `app.css` utilities in §2
  paint the hero, the empty panel and the landing backdrop, and none of them paints the brand hue.
- No `text-teal-*`/`bg-emerald-*`/`bg-zinc-*` literals in app code: every brand, macro and neutral
  value is a token. Colour literals belong in `app/app.css` and nowhere else.
  **This rule is not yet true of the tree, and M243 did not fix it.** A source scan of
  `app/**/*.{ts,tsx}` today finds about fifty zinc, teal and emerald classes across seven files.
  The one this document used to teach is still live in three of them: `hover:border-teal-300`
  with `dark:hover:border-teal-600` in `app/components/carb-basis-field.tsx`,
  `app/components/add/search-result-row.tsx` and `app/routes/diary.entry.$id.tsx` (twice), which
  is the exact pair §5's hover recipe replaces. The rest are `bg-zinc-100`, `dark:bg-zinc-800` and
  their siblings on thumbnails and code samples, plus the emerald marks on the OpenRouter and AI
  settings screens. Do not widen that set, and do not read this bullet as a claim that the tree
  obeys it. `tests/unit/design-tokens.test.ts` enforces the ban for the amber family only, for the
  stated reason that amber is the one hue whose literal is an accessibility regression rather than
  a stylistic slip; widening the guard to the whole palette is a separate sweep, and a test that
  failed on day one would just be deleted.
- No `font-display` or `font-brand` outside `app/components/wordmark.tsx`. The brand role is the
  product's name and nothing else (§4), and `tests/unit/wordmark-brand-role.test.ts` fails the
  build for any other file that writes either token.
- No radius outside the five steps in §5, and no radius used as a SELECTOR in a test. Find an
  element by its `data-slot`, never by `div.rounded-2xl.bg-card`.
- No thick left border to mark a block. A rule down the left edge of a card or a row is a template
  tell; `tests/unit/day-budget-rows-component.test.tsx` fails on any `border-l-*` in the budget
  rows, which is where it kept being reintroduced.
- No `window.confirm` / `window.alert`.
- No unlabeled spinners as page content — spinners attach to the thing that's pending.
- No Google Fonts / CDN assets — self-hosted only.
- No inline threshold logic for carb colors — always `app/utils/carb-status.ts`.
- No new one-off card/badge class combos when a recipe above fits.
