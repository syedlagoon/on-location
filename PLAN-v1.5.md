# On Location — v1.5 Implementation Plan

## Product Direction (from brainstorm)

- **Audience:** Design hiring managers evaluating AI fluency and build ability
- **Feeling:** "This is impressive tech" — smooth animations, AI integration, data quality
- **Aesthetic:** Dark, glowing 3D map (Mapbox/deck.gl showcase style). Current dark + gold accent is the foundation
- **Mobile:** Desktop-first. Phone should load and look acceptable but not be a priority
- **AI caption role:** Supporting detail — adds context, doesn't dominate the UI
- **First impression:** Brief hero moment (2–3 second animated intro before the map)

### Bonus features (beyond the 4 spec stretch items)

- **Seasonal trends chart:** Small sparkline below the controls showing city-wide filming volume across all months
- **Neighborhood deep-dive:** Click an area → camera flies in, overlay panel slides in with sparkline, top months, rank, trend over time. Dismissible back to full map
- **Shareable URLs** (deferred — not planned for v1.5)

---

## Build Order

Each phase is a deployable increment. Ship after each.

| Phase | Feature | Pipeline | Front End |
|-------|---------|----------|-----------|
| 1 | Category filter | Extend `counts.json` with per-category breakdowns | Filter pills in controls bar |
| 2 | AI caption | New `scripts/captions.ts`, generates `captions.json` | Caption below title, updates on month change |
| 3 | Circles toggle | None (centroids computed client-side) | ScatterplotLayer + viz mode toggle |
| 4 | Seasonal trends chart | None (derived from existing counts) | Sparkline below controls |
| 5 | Neighborhood deep-dive | None | Click → fly-to + slide-in overlay panel |
| 6 | Hero intro | None | Animated reveal on first load |
| 7 | Block-level grain | New `scripts/blocks.ts`, geocoding, `blocks.json` | HeatmapLayer + grain toggle |

---

## Phase 1: Category Filter

### Pipeline (`scripts/pipeline.ts`)

1. Add `category` to `SELECT_FIELDS` (the field already exists in SODA — values: Television, Film, Commercial, Theater, Web, etc.).
2. Extend `aggregate()` to produce a `byCategory` key in `counts.json`:
   ```
   byCategory: {
     "Television": {
       cd: { "Manhattan-5": { "2024-01": 12, ... }, ... },
       zip: { "10001": { "2024-01": 5, ... }, ... }
     },
     "Film": { ... },
     ...
   }
   ```
3. Add `metadata.categories: string[]` listing all category values found.
4. Normalize category strings (trim whitespace, collapse case variations).
5. The existing top-level `byCommunityDistrict` and `byZip` remain as the "All" aggregate.

**Gotchas:**
- File size will grow ~5–8x. Measure after generation. If over 2 MB, consider splitting per-category into lazy-loaded files.
- Some permits have empty or null categories. Bucket as "Other".

### Front End (`src/main.ts`)

1. Add state: `let activeCategories: Set<string> | null = null` (null = all).
2. Add `computeFilteredCounts(counts, unit, activeCategories)` that sums category breakdowns when a filter is active, or returns the top-level aggregate when null.
3. Build a `#category-filter` row of pill buttons below the controls bar. Each pill toggles on/off. "All" pill resets to null.
4. Update `updateLayers()` to call `computeFilteredCounts()`.
5. Update `computeMaxCount` calls to use filtered counts.
6. Update the legend max on filter change.

### CSS (`src/style.css`)

```css
#category-filter {
  position: fixed;
  bottom: 84px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  z-index: 1;
}

.cat-pill {
  padding: 4px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.25);
  background: rgba(20,20,30,0.7);
  color: #fafafa;
  font-size: 12px;
  cursor: pointer;
  backdrop-filter: blur(6px);
}

.cat-pill.active {
  background: rgba(255,200,60,0.25);
  border-color: rgba(255,200,60,0.6);
}
```

Responsive: pills wrap at 600px.

---

## Phase 2: AI Caption

### Pipeline (`scripts/captions.ts` — new file)

1. Read `public/data/counts.json`.
2. For each month, for both CD and ZIP:
   - Find the top 3 areas by count.
   - Compute total shoots and month-over-month delta.
   - Send to Claude (`claude-sonnet-4-20250514`) with a tight prompt requesting one punchy sentence (max 80 chars), no month name (shown separately).
3. Batch 5 months per API call to keep costs under $0.10 total.
4. Write `public/data/captions.json`:
   ```
   {
     "metadata": { "generatedAt": "...", "model": "claude-sonnet-4-20250514" },
     "cd": { "2024-01": "Greenpoint leads with 47 shoots", ... },
     "zip": { "2024-01": "Midtown dominates as filming surges", ... }
   }
   ```
5. Add to `package.json`: `"captions": "tsx scripts/captions.ts"`.
6. Requires `ANTHROPIC_API_KEY` in `.env`. Add `@anthropic-ai/sdk` dependency.

**Gotchas:**
- Front end must gracefully handle missing `captions.json` (file won't exist until the user has an API key and runs the script).
- Captions are generated for "All" categories only. When a category filter is active, hide the caption or show a computed fallback like "47 Television shoots this month".
- If counts are regenerated, captions may be stale. Log a console warning if timestamps diverge.

### Front End (`src/main.ts`)

1. Fetch `captions.json` in the initial `Promise.all` with `.catch(() => null)` fallback.
2. Create `#caption` element below the title overlay.
3. In `updateLayers()`, set `captionEl.textContent` from the appropriate unit's captions map.
4. Fade transition via CSS `transition: opacity 0.3s ease`.

### CSS

```css
#caption {
  position: fixed;
  top: 80px;
  left: 24px;
  font-size: 15px;
  font-style: italic;
  opacity: 0.65;
  pointer-events: none;
  z-index: 1;
  max-width: 400px;
  transition: opacity 0.3s ease;
}
```

---

## Phase 3: Circles Toggle

### Front End only (no pipeline changes)

1. Add state: `type VizMode = "bars" | "circles"; let currentVizMode: VizMode = "bars"`.
2. Add `computeCentroid(geometry)` helper — arithmetic mean of outer ring vertices. ~15 lines.
3. Import `ScatterplotLayer` from `@deck.gl/layers`.
4. Add `buildCircleLayer(month, unit)`:
   - Map each feature to `{ position: centroid, count, label, countsKey }`.
   - Use `sqrt(count / maxCount)` for radius scaling (preserves proportional area, statistically correct).
   - Same color ramp as bars via `getColor()`.
   - `radiusUnits: "meters"`, max ~2000m, min ~200m.
5. Add `#viz-toggle` button in controls (next to unit toggle). Displays `|||` for bars, `●` for circles.
6. Update `updateLayers()` to dispatch on `currentVizMode`.
7. Update `getTooltip` to handle both GeoJSON feature objects (bars) and plain data objects (circles).

**Gotchas:**
- MultiPolygon centroids (islands) may land in water. Accept minor visual quirks.
- Dense areas overlap. The `opacity: 0.8` + transparency helps.
- Legend could add a size indicator in circles mode. Defer unless it looks confusing.

---

## Phase 4: Seasonal Trends Chart

### Front End only (derived from existing counts)

1. Create a `#trends` container below the controls bar.
2. Render a small inline SVG sparkline (~300x40px):
   - X axis: all months. Y axis: total city-wide shoot count for the selected unit.
   - Highlight the current month with a dot.
   - Path uses the gold accent color (`#ffc83c`), area fill at 15% opacity.
3. Update the highlight dot position in `updateLayers()`.
4. Clicking on the sparkline scrubs to that month (derive month index from click X position).

**Gotchas:**
- When category filter is active, the sparkline should reflect filtered totals.
- Keep it small and unobtrusive — it's supplementary context, not a full chart.
- No external charting library — raw SVG keeps the bundle small.

### CSS

```css
#trends {
  position: fixed;
  bottom: 84px;            /* above category pills if present */
  left: 50%;
  transform: translateX(-50%);
  pointer-events: auto;
  z-index: 1;
  opacity: 0.7;
}
```

Exact bottom offset depends on whether category filter is present. Stack them vertically.

---

## Phase 5: Neighborhood Deep-Dive

### Front End only

1. On click (not hover) of an area, transition to deep-dive mode:
   - `deck.setProps({ initialViewState: { ...flyToArea, zoom: 13, pitch: 45, transitionDuration: 1200 } })`.
   - Slide in a `#detail-panel` from the right (320px wide) with:
     - Area name as heading
     - Current month's count prominently displayed
     - Rank among all areas for this month
     - SVG sparkline showing this area's count across all months
     - Top 3 months by count
     - Month-over-month trend arrow
2. "Back" button or click outside the panel → fly back to the initial view state, hide panel.
3. Keyboard: Escape closes the panel.

**Gotchas:**
- Deep-dive must work in both CD and ZIP modes.
- If a category filter is active, the panel stats should reflect the filtered data.
- The panel must not obscure the map too much on narrow screens. On mobile, make it a bottom sheet.
- The fly-to target needs the centroid of the clicked area — reuse `computeCentroid()` from Phase 3.

### CSS

```css
#detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: 100vh;
  background: rgba(15, 15, 25, 0.95);
  backdrop-filter: blur(12px);
  padding: 32px 24px;
  z-index: 2;
  transform: translateX(100%);
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  overflow-y: auto;
}

#detail-panel.open {
  transform: translateX(0);
}
```

---

## Phase 6: Hero Intro

### Front End only

1. On initial load, show a full-screen `#hero` overlay:
   - "On Location" title, large (48px), centered.
   - Subtitle fades in after 0.5s.
   - After 2s total, the overlay fades out and the map is revealed underneath (already loaded and rendering).
2. The map starts at a higher zoom / different angle, then transitions to `INITIAL_VIEW_STATE` as the hero fades — creating a cinematic pull-back effect.
3. If the user clicks or presses any key during the intro, skip to the map immediately.
4. Set a `sessionStorage` flag so the intro only plays once per session.

**Gotchas:**
- The map and data must load during the hero animation, not after. Start fetches immediately, show the hero while data loads.
- If data takes longer than 2s to load, extend the hero until ready (add a subtle loading indicator).
- Keep it tasteful — 2–3 seconds max. Longer and it becomes annoying.

---

## Phase 7: Block-Level Grain

### Pipeline (`scripts/blocks.ts` — new file)

1. Fetch permits from SODA with `parkingheld` field included.
2. Parse `parkingheld` — comma-separated segments matching `STREET between CROSS_A and CROSS_B`.
3. Geocode intersections via NYC Geoclient API (`NYC_GEO_KEY` in `.env`).
   - For each segment, geocode both cross-street intersections, take the midpoint.
   - Aggressive caching in `scripts/.geocode-cache.json` (gitignored).
   - Normalize abbreviations (ST→STREET, AVE→AVENUE, W.→WEST, etc.).
   - Queue with ~5 concurrent requests + 100ms delay.
4. Aggregate by snapping to 4-decimal precision (~11m grid).
5. Write `public/data/blocks.json`:
   ```
   {
     "metadata": { "generatedAt": "...", "totalPoints": N, "geocodeHitRate": 0.78 },
     "points": [
       { "lng": -73.9857, "lat": 40.7484, "months": { "2024-01": 3, ... } },
       ...
     ]
   }
   ```
6. Add to `package.json`: `"blocks": "tsx scripts/blocks.ts"`.
7. Requires `NYC_GEO_KEY` in `.env`.

**Gotchas:**
- First geocode run is slow (10–30 min for ~30K intersections). Cache makes subsequent runs fast.
- Expect 15–30% geocode failure rate. Log failures, track hit rate.
- File size could reach 500KB–2MB. Use compact coordinates (4 decimals). Lazy-load on the front end.
- "DEAD END" as a cross street — skip these segments.

### Front End (`src/main.ts`)

1. Add `type GrainMode = "area" | "block"`. Separate from the CD/ZIP toggle.
2. Lazy-load `blocks.json` only when user activates block mode.
3. Use `HeatmapLayer` from `@deck.gl/aggregation-layers` (new dependency).
4. Add a "Block" toggle button — separate from the CD/ZIP unit toggle.
5. When in block mode: hide the CD/ZIP toggle and viz-mode toggle (they don't apply). Hide the color legend (heatmap has its own ramp). Hide the detail panel click handler.
6. When switching back to area mode, restore everything.

---

## New Dependencies

| Package | Phase | Purpose |
|---------|-------|---------|
| `@anthropic-ai/sdk` | 2 | Caption generation |
| `@deck.gl/aggregation-layers` | 7 | HeatmapLayer for block-level |

## New Environment Variables

| Variable | Phase | Source |
|----------|-------|--------|
| `ANTHROPIC_API_KEY` | 2 | Anthropic Console |
| `NYC_GEO_KEY` | 7 | NYC Developer Portal |

## Files Created

| File | Phase |
|------|-------|
| `scripts/captions.ts` | 2 |
| `scripts/blocks.ts` | 7 |
| `public/data/captions.json` | 2 (generated) |
| `public/data/blocks.json` | 7 (generated) |

## Files Modified

| File | Phases |
|------|--------|
| `scripts/pipeline.ts` | 1, 7 |
| `src/main.ts` | 1, 2, 3, 4, 5, 6, 7 |
| `src/style.css` | 1, 2, 3, 4, 5, 6 |
| `package.json` | 2, 7 |
| `CLAUDE.md` | 2, 7 |
| `.gitignore` | 7 |
