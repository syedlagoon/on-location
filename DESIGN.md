# DESIGN.md — On Location Design System

Living design document. All visual decisions, tokens, and rationale live here.

## Brand Direction

**Dark, cinematic, data-dense.** Bloomberg Terminal meets film noir. The app should feel like a control room for NYC's filming rhythm — precise, information-rich, with moments of warmth from the amber accent. Nothing should look like default browser chrome.

**Principles:**
1. **Data first** — the visualization is the hero; UI recedes
2. **Cinematic warmth** — dark surfaces with amber/gold accents evoke film
3. **Precision** — tabular numbers, tight alignment, intentional spacing
4. **Layered depth** — glass surfaces float over the map with clear z-hierarchy

## Color Palette

### Core tokens

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#0a0a0a` | Page background |
| `--color-fg` | `#f0f0f0` | Primary text |
| `--color-fg-muted` | `rgba(240, 240, 240, 0.5)` | Secondary text, labels |
| `--color-accent` | `#ffc83c` | Active states, highlights, data max |
| `--color-accent-hover` | `#ffd666` | Accent hover state |
| `--color-accent-subtle` | `rgba(255, 200, 60, 0.15)` | Accent backgrounds |
| `--color-accent-border` | `rgba(255, 200, 60, 0.4)` | Active borders |
| `--color-surface` | `rgba(12, 12, 20, 0.75)` | Glass panel backgrounds |
| `--color-surface-hover` | `rgba(255, 255, 255, 0.08)` | Hover on interactive surfaces |
| `--color-border` | `rgba(255, 255, 255, 0.12)` | Subtle borders |
| `--color-border-strong` | `rgba(255, 255, 255, 0.25)` | Prominent borders |
| `--color-data-low` | `rgb(40, 40, 80)` | Data minimum color |
| `--color-data-high` | `rgb(255, 200, 60)` | Data maximum color |

### Category colors

| Category | Color | Usage |
|---|---|---|
| Television | `#6fa8dc` | Filter pill, detail stats |
| Film | `#e06666` | Filter pill, detail stats |
| Commercial | `#93c47d` | Filter pill, detail stats |
| Theater | `#c27ba0` | Filter pill, detail stats |
| Web | `#8e7cc3` | Filter pill, detail stats |
| Still Photography | `#f6b26b` | Filter pill, detail stats |
| Music Video | `#76a5af` | Filter pill, detail stats |

## Typography

### Font stack

- **Display/Headings**: `'Inter', system-ui, -apple-system, sans-serif` — clean, geometric, professional
- **Monospace/Data**: `'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace` — crisp tabular numbers

### Type scale

| Token | Size | Weight | Usage |
|---|---|---|---|
| `--text-display` | `44px` | 700 | Hero title |
| `--text-title` | `26px` | 700 | App title, panel headings |
| `--text-heading` | `20px` | 700 | Detail panel name |
| `--text-body` | `14px` | 400 | Body text, descriptions |
| `--text-caption` | `12px` | 500 | Timeline labels, filter pills |
| `--text-label` | `11px` | 600 | Legend labels, section headers |
| `--text-data-lg` | `32px` | 700 | Big stat numbers |
| `--text-data-md` | `22px` | 700 | Rank numbers |

### Rules

- All numeric data uses `font-variant-numeric: tabular-nums`
- Letter-spacing: `-0.02em` on titles, `0.04em` on uppercase labels
- Line height: `1.2` headings, `1.5` body

## Spacing Scale

| Token | Value |
|---|---|
| `--space-xs` | `4px` |
| `--space-sm` | `8px` |
| `--space-md` | `12px` |
| `--space-lg` | `16px` |
| `--space-xl` | `24px` |
| `--space-2xl` | `32px` |
| `--space-3xl` | `48px` |

## Radii

| Token | Value |
|---|---|
| `--radius-sm` | `4px` |
| `--radius-md` | `8px` |
| `--radius-lg` | `12px` |
| `--radius-pill` | `100px` |

## Effects

| Token | Value |
|---|---|
| `--blur-surface` | `16px` |
| `--blur-tooltip` | `12px` |
| `--shadow-panel` | `0 8px 32px rgba(0,0,0,0.5)` |
| `--shadow-pill` | `0 2px 8px rgba(0,0,0,0.3)` |
| `--transition-fast` | `120ms ease` |
| `--transition-normal` | `200ms ease` |
| `--transition-slow` | `400ms cubic-bezier(0.16, 1, 0.3, 1)` |
| `--transition-panel` | `500ms cubic-bezier(0.16, 1, 0.3, 1)` |

## Baseline Audit (Phase 1)

**Date**: 2026-05-20 | **Overall**: 52/100

### Visual Hierarchy — 5/10
- Title overlay is small (28px) and doesn't stand out as a display element
- No typographic differentiation between UI labels and data
- system-ui font is generic; no personality or data-viz authority
- Caption text at 15px italic blends into the background
- Legend uses tiny (11px) text with low opacity — nearly invisible

### Information Architecture — 6/10
- Layout is reasonable: title top-left, controls bottom-center, legend bottom-right
- Stacking order (filter > toolbar > timeline) is logical but cramped vertically
- Detail panel content is well-structured (stat > rank > sparkline > top months)
- Attribution placement conflicts with timeline on mobile

### Cognitive Load — 6/10
- Three toggle buttons with cryptic labels ("CD", "|||", "Block") — unclear to new users
- Notch timeline is intuitive once discovered but lacks month-on-hover preview
- Category filter pills blend together — no color differentiation
- Hero intro is too brief (2s auto-dismiss) to orient the user

### Interaction Quality — 4/10
- No hover states on toggle buttons beyond subtle background
- No focus indicators (keyboard nav is technically functional but invisible)
- Detail panel has no entrance choreography — just slides
- No visual feedback when switching months (only bar animation)
- Close button on detail panel is plain text, no hover treatment

### Visual Polish — 4/10
- Hard-coded colors everywhere — no systematic tokens
- Inconsistent spacing (24px, 16px, 8px, 6px, 4px used ad-hoc)
- Border-radius varies (6px tooltip, 18px pills, 10px timeline, 4px legend, 16px mobile panel)
- Glass-morphism is inconsistent (some panels use it, some don't)
- Default system-ui font reads as prototype
- No shadows or depth cues beyond backdrop-filter

### Color Usage — 5/10
- Monochromatic amber accent works but is the only color
- Category pills have no color differentiation
- Legend gradient is effective but could be more refined
- rgba white borders at varying opacities (0.3, 0.25, 0.15) — inconsistent

### Delight / Personality — 3/10
- Hero fade-in is the only moment of delight
- No micro-interactions on any interactive element
- No transitions on state changes (filter toggle is instant)
- App feels functional but clinical — no warmth or personality

### Anti-patterns Detected
1. **P0**: No focus-visible styles — keyboard users see nothing
2. **P0**: system-ui font gives "unfinished" impression
3. **P1**: Hard-coded colors make theming/consistency impossible
4. **P1**: No hover states on primary controls
5. **P1**: Category pills are visually identical when inactive
6. **P2**: Detail panel close button is bare text character
7. **P2**: Legend is easy to miss (tiny, low opacity, no label emphasis)
8. **P2**: No notch hover preview (tooltip showing month/count)
9. **P3**: Attribution link has no hover style
10. **P3**: Year labels on timeline barely visible (opacity 0.4, 10px)

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-20 | Dark theme only, no light mode | Data viz on map requires dark bg; aligns with cinematic brand |
| 2026-05-20 | Inter + JetBrains Mono font pair | Inter is clean/geometric for UI; JetBrains Mono has true tabular nums for data |
| 2026-05-20 | Amber (#ffc83c) as sole accent | Film/warmth association; high contrast on dark; already established in v1 |
| 2026-05-20 | Glass-morphism for floating panels | Creates depth hierarchy over map without occluding; feels modern |
| 2026-05-20 | Category-specific colors for filter pills | Helps distinguish categories at a glance; enables future per-category data coloring |
