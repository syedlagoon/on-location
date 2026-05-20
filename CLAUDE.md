# CLAUDE.md

Guidance for Claude Code working in this repository. Read `SPEC.md` before starting any work.

## General Principles

- When asked to implement a plan, execute it immediately without asking for approval. Do not pause to present plans for review unless explicitly asked to plan first. Default to action.
- Never ask the user to manually perform file operations (move, copy, rename, create directories). Always make the change directly using available tools.

## Build & Quality

- After implementing UI changes, always run the build/lint step before reporting completion. Fix any ESLint errors or build failures before committing. Common issues: missing closing tags, effect-based state updates, ref-during-render.

## Project Context

- This project uses HTML, CSS, JavaScript, and Markdown as primary languages. Component files live across 100+ files. When making bulk changes across many files, commit and push incrementally rather than waiting until the end.

## Problem Solving

- When a first approach to a UI problem fails after 2 attempts, stop and rethink the fundamental approach rather than iterating on the same broken strategy. Propose the alternative direction to the user before investing more effort.

## Project

On Location — an interactive deck.gl visualization of NYC film-permit activity over time. A stylized map of New York City where areas extrude into isometric bars sized by the number of film/TV shoots, with a month slider that animates the bars. See `SPEC.md` for full scope, goals, and non-goals.

- **GitHub repo**: `git@github.com:syedlagoon/on-location.git`
- **Local folder**: `neighborhood-films` (does not match the repo name — do not guess the remote name from the directory)

## Stack

- TypeScript, Vite
- deck.gl for visualization (extruded GeoJsonLayer / ColumnLayer for the bars, GeoJsonLayer for the city outline)
- A Node/TypeScript build script for the data pipeline
- Static site — no backend, no runtime API calls

## Repo layout

- `scripts/` — data pipeline: fetch, normalize, aggregate
- `public/data/` — generated `counts.json` and boundary GeoJSON (committed)
- `src/` — front-end app (deck.gl)
- `SPEC.md` — project spec; the source of truth for scope
- `CLAUDE.md` — this file

## Commands

Update this section as scripts are created.

- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run data` — run the data pipeline; regenerates `public/data/counts.json`
- `npm run boundaries` — download boundary GeoJSON files (idempotent, skips existing)

## Data pipeline notes

- Source: NYC Open Data Film Permits, dataset `tg4x-b46p`. SODA API base: `https://data.cityofnewyork.us/resource/tg4x-b46p.json`
- Use a NYC Open Data app token, read from an environment variable. Never hardcode or commit it.
- The zip and community-district fields are messy — trailing commas, `N/A`, rows tagged with several values. Normalize before aggregating, and comment those steps.
- Aggregate shoot counts per area per month, for BOTH zip code and community district.
- The pipeline runs at build time only. The deployed site reads pre-generated JSON.

## Conventions

- TypeScript strict mode; avoid `any`.
- Keep the data pipeline and the front end as separate, clearly-scoped modules.
- Small, focused commits with imperative messages.
- Comment non-obvious data-cleaning logic.

## Constraints — do not

- Do NOT add Letterboxd or any "which film" feature. The permit data has no production titles; that join is impossible. (See SPEC non-goals.)
- Do NOT call the SODA API at runtime — data is pre-baked into `public/data/`.
- Do NOT commit API tokens or any secrets. Use a git-ignored `.env`.
- Do NOT start stretch items (circles toggle, category filter, block-level grain, AI caption) until v1 is built and deployed.

## Working style

- Propose a short plan before large or multi-file changes.
- Build v1 (the SPEC "Core feature" list) first, and ship it before anything else.
- When scope is unclear, check `SPEC.md`.
