# Tactile Hearth — HomeOps AI Design System

A warm, material design language for a calm home operating system. Surfaces behave
like lit physical materials (paper, ceramic, clay); **depth encodes hierarchy and
"what's pressable"**, never decoration; motion is calm by default and settles like a
real object. Everything respects `prefers-reduced-motion` and a user **Calm Mode**.

> Single sources of truth: tokens → `tailwind.config.js`; material classes + motion +
> Calm Mode → `src/index.css`; components → `src/components/ui.tsx`; sensory prefs →
> `src/lib/prefs.ts`. Flagship reference screen → `src/screens/Dashboard.tsx`.

---

## Principles

1. **Depth is meaning.** Elevation shows hierarchy and affordance, not flourish.
2. **One bold thing.** The ember‑lit *Hearth* is the signature; everything else stays quiet.
3. **Calm by default, rich on intent.** Micro‑interactions fire on touch, not ambiently.
4. **Inclusive is non‑negotiable.** AA contrast, visible focus, reduced‑motion, Calm Mode.
5. **Status colors are vocabulary.** Their meaning is fixed; never recolor them decoratively.

---

## Design Tokens

### Color

**Surfaces** (the material base — warm paper & ceramic):

| Token | Hex | Use |
|---|---|---|
| `surface-base` | `#ece3d5` | Page background (warm oat) |
| `surface-raised` | `#fdfbf7` | Cards / raised material (porcelain) |
| `surface-sunken` | `#e6dccb` | Wells, inputs, recessed rows |
| `surface-overlay` | `#fbf8f2` | Popovers / hover surfaces |
| `surface-rim` | `#ffffff` | Lit top edge / input fill |

**Ember** — the signature brand warmth (the "hearth glow"). Distinct from status colors;
used for the hero, the single primary CTA per view, and live accents. `ember-50…600`
(`#fdf1e7 → #ae4d18`), key stops `ember-400 #e47f35`, `ember-500 #d26420`.

**Ink** — deep warm charcoal‑navy for nav and primary buttons. `ink-400…900`.

**Semantic status (meaning is fixed — do not repurpose):**

| Color | Meaning |
|---|---|
| `sage` | success / done |
| `coral` | attention / danger |
| `amber` | warning |
| `sky` | informational |
| `lavender` | caregiving / sensitive |

### Typography

| Role | Family | Token | Use |
|---|---|---|---|
| Display | **Fraunces** (soft optical serif) | `font-display` | Headings, hero greeting, big stat numbers — used with restraint |
| Body / UI | **Inter** | `font-sans` (default) | All body, controls, data |

Loaded via Google Fonts in `index.html`; graceful serif/sans fallbacks. Small uppercase
labels use the `section-title` class. **Do not set everything in serif.**

### Elevation (warm‑tinted, with a lit top edge)

| Token | Use |
|---|---|
| `shadow-e1` | Resting card |
| `shadow-e2` | Raised / hover |
| `shadow-e3` | Modal / drawer / command palette |
| `shadow-well` | Inset well (inputs, recessed blocks) |
| `shadow-ember` | The hearth / ember CTA glow |

(`shadow-card`/`shadow-pop` remain as aliases → upgraded depth, so legacy usages lift too.)

### Radius & Spacing

`rounded-2xl` for rows/controls, `rounded-3xl` for cards/panels, `rounded-[1.9rem]` for the
Hearth. Spacing follows Tailwind's scale; cards use `card-pad` (`p-5`).

### Motion

Calm, physical, short. Easing `cubic-bezier(0.22, 1, 0.36, 1)`. Classes: `animate-fade-in`,
`animate-slide-up`, `animate-scale-in`, `animate-soft-pulse`, `stagger` (parent) +
`style={{['--i']: i}}` on children. `.lift` (hover translate + shadow), `.pressable`
(active compress). **No new keyframes; no infinite ambient motion.** All motion is disabled
under `prefers-reduced-motion: reduce` and Calm Mode.

---

## Components (`src/components/ui.tsx`)

### Button
Variants: `primary` (ink gradient, default actions), `ember` (the single most inviting
create/generate CTA per view), `secondary`, `ghost`, `danger`, `success`. Sizes `sm`/`md`.
States: hover (lift sheen), active (`scale-0.97` compress), focus (2px ember ring + offset),
disabled (50% + not‑allowed). Tactile by construction.

### Card
Material surface (`surface-raised`, `rounded-3xl`, `shadow-e1`, lit top edge). Pass `hover`
or `onClick` to make it interactive → auto‑adds `lift pressable`, keyboard operability
(Enter/Space), and a visible focus ring. **Does not accept a `style` prop** — for a stagger
cascade, wrap the Card in a `<div style={{['--i']: i}}>` under a `.stagger` parent.

### Surfaces & helpers
`.card` / `.panel` (raised), `.well` (sunken inset), `.hero` (deep navy feature panel),
`.hearth` + `.hearth-glow` (navy + ember glow — **at most one per screen**), `.glass`
(frosted), `.data-row`, `.input`, `.label`, `.chip`, `.section-title`.

### Other primitives
Modal, Drawer (focus‑trapped, Esc‑to‑close, restore focus), Tabs (ember underline),
Badge / RiskBadge / ReadinessBadge (carry their own semantic colors), StatTile (display‑serif
value), EmptyState, Field / TextInput / TextArea / Select / Toggle / Checkbox, ProgressBar,
Avatar, IconButton, PageHeader, SectionTitle.

---

## Patterns

- **Bento grid** — varied‑width material tiles on a `lg:grid-cols-6` grid (wide `col-span-4`
  features beside narrow `col-span-2` tiles). See the Dashboard.
- **The Hearth** — the emotional center: a dark `.hearth` panel with a soft ember glow,
  display‑serif greeting, and a lit "Ask HomeOps" well. One signature moment per app.
- **Material lists** — uniform lists become tidy `data-row`/card grids with hover‑lift.
- **Attention tile** — when items need the user, a tile gains a subtle warm (amber) accent
  rather than an alarming one.

---

## Inclusive & neurodivergent design

- **Calm Mode** (`src/lib/prefs.ts`, `useCalmMode()` → `data-calm` on `<html>`, persisted):
  flattens depth, stills all motion, removes the ember glow, softens saturation, keeps clear
  borders for contrast. Toggle in the top bar and **Settings → Comfort & accessibility**.
- **Reduced motion** — `prefers-reduced-motion: reduce` disables animation/transition globally.
- **Predictable, low‑load layout** — generous spacing, clear bento zones, consistent vocabulary.
- **Visible focus everywhere** — 2px ember focus ring with offset; full keyboard operability
  on cards, tabs, dialogs (focus trap + restore).
- **Contrast** — text uses solid ink tones and the darker status tints on tinted fills (AA).

---

## Voice & inclusive copy

Warm, plain, reassuring. Name things by what people control ("manage notifications", not
"webhook config"). Active voice; an action keeps its name through the flow ("Publish" →
"Published"). Empty/failure states give direction, not mood ("A calm day — no appointments
scheduled"; "Nothing is waiting on you right now"). Sentence case throughout.

---

## Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Use `ember` for the one primary CTA per view | Sprinkle ember on every button |
| Keep status colors to their meaning | Recolor sage/coral/amber/sky/lavender decoratively |
| Reserve `.hearth` for one signature moment | Add multiple glowing panels per screen |
| Reuse the `ui.tsx` primitives | Re‑implement cards/buttons/inputs inline |
| Gate any motion behind reduced‑motion/Calm | Add infinite ambient animation |
| Use `font-display` for headings/big numbers | Set body text in serif |
