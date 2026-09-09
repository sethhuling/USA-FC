# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

USA FC — a mobile-first PWA tracking American soccer players at non-US clubs. Express
server (`server/`) proxies API-Football, owns the API key, caching, and rate limiting;
Vite/React client (`client/`) is built to `client/dist` and served statically by the
same server on port 8787. Deployed on Render (free tier) at https://usa-fc.onrender.com.

## Commands

```bash
npm install            # root install; postinstall installs client deps too
npm run build          # vite-builds the client into client/dist (required before npm start shows UI changes)
npm start              # node server/index.js — serves API + built client on :8787
npm run dev:client     # vite dev server with HMR (proxies /api to :8787; run dev:server separately)
npm run discover       # scan all configured leagues for US-nationality players, merge into players.json
```

There are no tests or linters. Verification is: build, restart the server, curl the API
endpoints, and check the UI. **Server code changes require a server restart** (and most
caches are in-memory, so a restart also clears them — first load re-warms over ~1–2 min
of throttled upstream calls). Client changes require `npm run build`.

Deploys: push to `main` on GitHub → Render auto-deploys (~3 min). Confirm a deploy landed
by grepping the served HTML for the new hashed bundle name from `client/dist/assets/`.
`API_FOOTBALL_KEY` lives in `.env` locally (git-ignored) and in Render env vars — never in git.

## Architecture

Request flow: `server/index.js` (routes, rate limit) → `server/src/service.js`
(orchestration + `server/src/cache.js` TTL caches) → `server/adapters/providers/`
(`apiFootball.js` when `API_FOOTBALL_KEY` is set, else `demo.js` with bundled simulated
data) → `server/adapters/streaming/` (auto lookup stub, then `server/config/streaming.json`
league→US-broadcaster fallback).

Cache TTLs (service.js): player stats 24h, schedules 1h, live overlay 60s, player
profiles 7d (upcoming fixtures separately at 1h), team pages 6h, finished-match details
48h. `getMatches` layers three passes on the cached schedule each request: a 60s live
overlay, a reconcile for matches the cache thinks are live but the live feed dropped
(they finished), and a badge backfill for finished matches (applies all cached details,
fetches at most 15 uncached per request, newest first).

`apiFootball.js` invariants:
- All upstream calls go through `api()` — globally throttled (250ms spacing) with
  backoff retry on per-minute rate limits. Never fetch the API directly elsewhere.
- League/cup ids live in `LEAGUE_IDS` / `CUP_IDS`; fixtures are always labeled via
  `ID_TO_NAME` because the API reuses names across countries (Brazil's league is
  literally "Serie A", Austria's is "Bundesliga", two "League Cup"s exist).
- Fixture↔player matching uses `apiFootballTeamId` (exact), falling back to loose
  club-name matching only for players with no id (zero appearances this season). Cup
  draws are full of near-name collisions ("Racing Club Warwick" ≠ Racing Club de
  Avellaneda) — never go back to name-only matching.
- Squad status: `start`/`on`/`bench`/`out` per tracked player. "Subbed on" is detected
  from per-player minutes, NOT substitution events (the API's in/out field order is
  unreliable). `out` + fixture injury report → `outInjured` (red cross in UI).

## Data files (server/data/)

- `players.json` — the tracked roster, hand-editable, source of truth. The server
  writes back resolved `apiFootballId`/`apiFootballTeamId`; it's committed to git so
  Render's ephemeral disk boots warm.
- `excluded.json` — **roster policy**: players the API calls USA-nationality who chose
  another national team (e.g. Bajraktarević → Bosnia) are excluded here; `npm run
  discover` skips them. Season stats count only the player's current club — no
  prior-club (MLS) or national-team numbers; a mid-season transfer starts the line fresh.
- `demo/` — demo-mode dataset (fixtures generated relative to server start, includes a
  simulated live match so the 60s poll path works keyless).

## Client notes (client/src/)

- Overlay sheets (player profile, match, team) render through React portals to
  `document.body` — the leaderboard's sticky column creates stacking contexts that
  otherwise paint over them. Modal backdrop z-index is 100, above the sticky topbar (40).
- `PlayerProfile.jsx` ⇄ `TeamSheet.jsx` intentionally import from each other
  (PlayerLink/TeamLink/FixtureLine); imports are only used at render time so the cycle
  is safe — don't "fix" it by duplicating components.
- League display names/countries are mapped in `leagues.js`; streaming labels must stay
  bare service names (no parentheticals) — user preference.
- The service worker (`public/sw.js`) is network-first for `/api/` and navigations so
  deploys and live scores are never stale; bump its cache name if you change caching.
- Branding: Old Glory red `#B31942` (motto uses brightened `#E0455F`), navy `#0A3161`,
  original USAFC crest (deliberately NOT the trademarked USMNT logo). Squad badge
  labels: XI / ON / BENCH / OUT.
- Collapsing topbar: the collapse removes ~124px of layout height, so it MUST keep
  `overflow-anchor: none` on `html` (styles.css) and the hysteresis thresholds in
  App.jsx (collapse past 24px, re-expand under 8px). A single scroll threshold
  oscillates on Android — Chrome's scroll anchoring shifts scrollY to compensate for
  the shrink, re-crossing the threshold in a loop. iOS Safari has no scroll anchoring,
  so iPhone testing will never catch a regression here.

## Testing against real data

Football data changes constantly — verify claims against the live API rather than
memory (e.g. a player showing zero stats may genuinely be injured or frozen out, not a
bug: check their career rows). The account is a paid Pro plan (7,500 req/day); a full
cold start uses ~100 calls, the finished-match backfill a few hundred once per 48h.

When verifying scroll/animation behavior in the Claude browser pane, the tab must be
visible (fronted): hidden tabs pause rendering, which freezes CSS transitions at their
start value and suppresses scroll-event dispatch — tests read as false failures.
