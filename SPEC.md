# On Location — Project Spec

*Working title; rename freely.*

**One-liner:** An interactive map of New York City that visualizes where film and TV productions shoot, month by month, as isometric bars rising and falling across a stylized city.

## What it is

A single-page web visualization. The user sees a clean, stylized outline of NYC. Areas of the city are extruded into 3D isometric bars whose height equals the number of permitted film/TV shoots there. A slider scrubs through time, month by month, with play/pause; the bars animate up and down as filming activity shifts. A toggle switches the geographic grain between zip codes and community districts.

## Why (goals)

- A portfolio piece showing fluency with AI dev tools (built via Claude Code) and real engineering against a public API.
- "A bit of everything": data pipeline, geospatial work, interactive front end, deployment.
- Something genuinely fun and surprising about NYC — the city's hidden filming rhythm.

## Data source

- **NYC Open Data — Film Permits**, dataset `tg4x-b46p` (Mayor's Office of Media & Entertainment), via the Socrata / SODA API.
- Each record is one permit: event type, start/end dates, location (borough, community district, police precinct, zip, free-text street segments), and category/subcategory (Television, Film, Commercial, Theater, Web, etc.).
- Coverage: roughly 2023–present, ~17k records. A recent-years tool, not a historical one.
- Known quirk: the zip and community-district fields are messy (trailing commas, "N/A", multi-value rows) — one normalization pass is required.
- No production titles in the data, by design. See non-goals.

## Core feature — v1 / MVP

1. Stylized NYC outline rendered from open boundary GeoJSON (no map tiles).
2. Areas extruded as isometric bars; height = shoot count for the selected month.
3. Month slider across the full date range, with play/pause; bars transition smoothly between months.
4. Unit toggle: zip-code view and community-district view (both aggregations pre-built).
5. Hover or tap an area to see its name and shoot count.
6. Ships as a static site — no runtime API calls.

## Next — v1.5 / stretch

- **AI caption:** a one-line, plain-English summary that regenerates as the slider moves ("Nov 2024 — Greenpoint leads the city"), generated from the underlying counts. This is the clearest AI-literacy showcase — prioritize it once the viz works.
- Circles toggle: expanding/shrinking proportional circles as an alternative to bars.
- Category filter (Film vs TV vs Commercial, etc.).
- Block-level grain: parse the free-text street field and geocode.

## Tech stack

- **Visualization:** deck.gl (MIT-licensed, no API key) — extruded GeoJsonLayer or ColumnLayer for the bars, GeoJsonLayer for the city outline, built-in transitions for animation.
- **Language:** JavaScript / TypeScript throughout — one toolchain for pipeline and front end.
- **Data pipeline:** a build script that queries the SODA API, normalizes the messy fields, aggregates to counts per area per month, joins to boundary polygons, and writes a single static `data/counts.json`.
- **Hosting:** static deploy — GitHub Pages, Netlify, or Vercel.
- **AI layer (v1.5):** an Anthropic API call from the build step or a small serverless function for the caption.

## Architecture

`build script (SODA API -> normalize -> aggregate)` -> `data/counts.json` + `boundary GeoJSON` -> `static front end (deck.gl)` -> `static host`

## Non-goals (explicit)

- No Letterboxd integration and no "which movie" — the permit data has no titles, so that join is impossible. A possible separate future project.
- No live API calls at runtime — data is pre-baked.
- No block-level precision in v1.
- Not a historical tool — coverage starts ~2023.

## Definition of done — v1

A deployed URL where anyone can scrub the month slider, watch the isometric bars animate across a stylized NYC, toggle between zip and community-district views, and hover an area for its count.

## Open decisions (deferred)

- Which unit becomes the default after prototyping both.
- Whether the AI caption lands in v1.5 or later.
- The exact boundary files to use — confirm during setup.
