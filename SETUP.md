# Setup Checklist — On Location

Work through these once, before and during your first Claude Code session. Check items off as you go.

## 1. Prerequisites

- [ ] Install Node.js — current LTS (v22). Verify: `node --version`
- [ ] Install Git. Verify: `git --version`
- [ ] Have a terminal and a code editor ready

## 2. NYC Open Data app token

- [ ] Create an account on the NYC Open Data portal (`data.cityofnewyork.us`)
- [ ] Generate a free app token (Socrata) — it raises your API rate limit
- [ ] Save it somewhere safe; it goes in a `.env` file later, never committed

## 3. Install Claude Code

- [ ] Install via the native installer (recommended):
  - macOS / Linux: `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`
  - npm alternative: `npm install -g @anthropic-ai/claude-code` (needs Node 18+; do not use `sudo`)
- [ ] Signing in requires a paid Claude plan or API access
- [ ] Verify: run `claude` in a terminal

## 4. Create the repo

- [ ] Create a new GitHub repo (e.g. `on-location`)
- [ ] Clone it locally
- [ ] Copy `SPEC.md` and `CLAUDE.md` into the repo root (rename the spec file to `SPEC.md`)
- [ ] Add a `.gitignore` covering `node_modules/`, `.env`, `dist/`
- [ ] Commit — "chore: project docs and gitignore"

## 5. Scaffold the project

- [ ] Initialize a Vite + TypeScript project
- [ ] Install deck.gl
- [ ] Create the folders from CLAUDE.md: `scripts/`, `src/`, `public/data/`
- [ ] Commit the scaffold

You can do step 5 yourself, or hand it to Claude Code as its first task.

## 6. Start with Claude Code

- [ ] Open Claude Code in the repo directory — it reads `CLAUDE.md` automatically
- [ ] First real task: the data pipeline — fetch, normalize, and aggregate the film-permit data

## Then

Come back here and tell me where you've landed. We'll do live reconnaissance on the API together, and I'll coach you through the first build steps.
