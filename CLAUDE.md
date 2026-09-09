# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

USA FC — a mobile-first PWA tracking American soccer players at non-US clubs. Express
server (`server/`) proxies API-Football, owns the API key, caching, and rate limiting;
Vite/React client (`client/`) is built to `client/dist` and served statically by the
same server on port 8787. Deployed on Render (free tier) at https://usa-fc.onrender.com.

Tabs: Schedule (past/live/upcoming, with US streaming info), Stats (leaderboards),
Players (profiles with bio and season stats). Primary user is Seth, mostly on an iPad
and phone — mobile/tablet layout is the priority, not desktop.

Long-term goal: a public, monetized app. Prefer designs that scale beyond one user —
server-side caching, no per-user upstream calls, no unlicensed scraping in production
paths.

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

## Environment

- Secrets live in `.env` locally (git-ignored) and in the Render dashboard in
  production. Never commit `.env`. Never print API keys in output.
- Key vars: `API_FOOTBALL_KEY`, `SEASON`, `PORT`, `ENABLE_STREAMING_AUTO`,
  `ENABLE_FOTMOB_SCRAPER`.
- `SEASON` is blank in `.env` and absent from `render.yaml`, so the server
  auto-computes it (`season()` in `server/adapters/providers/apiFootball.js`:
  calendar year, rolling over each August — 2026 as of Sept 2026). No manual summer
  bump is needed; only set it to pin a specific season.

## Deploy

Push to `main` (the repo's default branch) on GitHub → Render auto-deploys via the
`render.yaml` Blueprint (~3 min). Confirm a deploy landed by grepping the served HTML
for the new hashed bundle name from `client/dist/assets/`. To see a shipped change on
the iPad/phone, hard-relaunch the app after the Render build finishes.

## Architecture

Request flow: `server/index.js` (routes, rate limit) → `server/src/service.js`
(orchestration + `server/src/cache.js` TTL caches) → `server/adapters/providers/`
(`apiFootball.js` when `API_FOOTBALL_KEY` is set, else `demo.js` with bundled simulated
data) → `server/adapters/streaming/` (auto lookup stub, then `server/config/streaming.json`
league→US-broadcaster fallback).

Cache TTLs (service.js): player stats 24h, schedules 1h, live overlay 60s, player
profiles 7d (upcoming fixtures separately at 1h), team pages 6h, finished-match
details 30d. Match details use two keys: `match:<id>` (60s, live/upcoming) and
`match-final:<id>` (30d) — `getMatchDetail` serves the long-lived copy first, and
both it and the badge backfill write to it, but ONLY details whose status is
actually `finished` (a null or still-live detail must never be long-cached).
While a live match's detail is being viewed, a single server-side timer
(`watchedLive` in service.js) refreshes it every 60s and all viewers read the
shared cache — N concurrent viewers cost 1 upstream call per interval, and the
timer stops when the match finishes or nobody has viewed it for 3 minutes. Each
tick logs `[live-detail] refreshed N watched match(es)` (visible in Render logs).

`getMatches` layers three passes on the cached schedule each request: a 60s live
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

## Data sources (server/adapters/)

Five sources in three adapter groups; each has one job. In production only two are
live: API-Football + streaming.json.

Providers (`providers/`) — match/player data. `index.js` picks ONE at startup:
- API-Football (`apiFootball.js`): the real source for everything — season stats,
  fixtures, live scores, match detail, profiles, transfers, rounds. Active when
  `API_FOOTBALL_KEY` is set. Pro plan ($19/mo): 7,500 requests/day (resets every
  24h), 300/min. Responses include `x-ratelimit-requests-remaining` headers — check
  them before assuming budget. The daily cap is comfortable for stat refreshes; the
  300/min limit is the real risk during live polling. Batch or space live requests;
  never add a new poll loop without estimating req/min.
- Demo (`demo.js`): keyless stand-in with bundled data; one match is always "live" so
  the 60-second poll path can be developed offline. Returns `demo: true` on everything.

Streaming (`streaming/`) — "what US service is this match on?"
- configFallback: hand-maintained `server/config/streaming.json` mapping competition →
  US broadcaster (e.g. Championship → Paramount+). Fuzzy name matching. Re-read on
  every lookup, so edits need no restart. THIS IS WHAT ACTUALLY ANSWERS IN PRODUCTION.
- liveSoccerTv: intentional stub, always returns null. Placeholder for a licensed
  match-level lookup (LiveSoccerTV forbids scraping). `ENABLE_STREAMING_AUTO=1` —
  leave off.

Scrapers (`scrapers/`)
- FotMob: opt-in (`ENABLE_FOTMOB_SCRAPER=1`), best-effort only. Adds clearances and
  interceptions that API-Football lacks, via an unofficial endpoint. Treat as
  optional; may break without notice.

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
- An open `MatchSheet` on a live match re-pulls detail every 60s
  (`fetchMatchDetail(id, { fresh: true })` skips the 60s client memo but still
  updates it). These polls are server cache reads — the server's shared timer does
  the upstream fetching, so per-viewer polling adds no API-Football cost.
- Branding: Old Glory red `#B31942` (motto uses brightened `#E0455F`), navy `#0A3161`,
  original USAFC crest (deliberately NOT the trademarked USMNT logo). Squad badge
  labels: XI / ON / BENCH / OUT.
- Collapsing topbar: the collapse removes ~124px of layout height, so it MUST keep
  `overflow-anchor: none` on `html` (styles.css) and the hysteresis thresholds in
  App.jsx (collapse past 24px, re-expand under 8px). A single scroll threshold
  oscillates on Android — Chrome's scroll anchoring shifts scrollY to compensate for
  the shrink, re-crossing the threshold in a loop. iOS Safari has no scroll anchoring,
  so iPhone testing will never catch a regression here.

## Conventions

- Player profiles use imperial units (feet/inches, pounds), never metric.
- Player bios read like an American scouting card (set Sept 2026).

## Testing against real data

Football data changes constantly — verify claims against the live API rather than
memory (e.g. a player showing zero stats may genuinely be injured or frozen out, not a
bug: check their career rows). The account is a paid Pro plan (7,500 req/day); a full
cold start uses ~100 calls, the finished-match backfill a few hundred once per restart
(details cache for 30d, longer than the server usually lives).

When verifying scroll/animation behavior in the Claude browser pane, the tab must be
visible (fronted): hidden tabs pause rendering, which freezes CSS transitions at their
start value and suppresses scroll-event dispatch — tests read as false failures.

## Known issues / next up

- streaming.json is hand-maintained by competition. Review each August when US rights
  change. Finding a licensed broadcast-data source is a future task, not something to
  attempt ad hoc.

## Working style

- Explain changes in plain language; Seth is not a professional developer.
- Check in before adding new dependencies or external services.
- Keep this file updated when a durable decision is made. Remove items from Known
  issues once they are fixed.
