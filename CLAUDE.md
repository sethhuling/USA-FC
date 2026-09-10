# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Uncle Sam FC (renamed from USA FC, Sept 2026) — a mobile-first PWA tracking American soccer players at non-US clubs. Express
server (`server/`) proxies API-Football, owns the API key, caching, and rate limiting;
Vite/React client (`client/`) is built to `client/dist` and served statically by the
same server on port 8787. Deployed on Render at https://usa-fc.onrender.com on a paid
instance (upgraded from free tier Sept 2026) — it must not go back to free: free
instances spin down after 15 idle minutes, which showed Render's own loading page on
open, wiped the in-memory caches (forcing the ~1,400-call startup warm on every wake),
and stopped the daily/post-match warm scheduler.

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
caches are in-memory, so a restart also clears them — the startup warm refills
everything over ~6 min of throttled upstream calls; players/matches come back first).
Client changes require `npm run build`.

For local verification that must not spend real API-Football requests, use the
`americans-abroad-demo` launch config (`.claude/launch.json`): it runs the server on
port 8791 with `API_FOOTBALL_KEY=` empty (demo provider, zero upstream calls) and
`ADMIN_KEY=demo-admin-key`. Caution: the Claude browser preview tool has launched the
first/real config on 8787 even when the demo config was requested by name (observed
Sept 2026, spending real API calls on the startup warm) — after starting a preview,
check the reported port/name and `preview_logs` before letting it run; running the
demo server via a plain background `node` command is a safe fallback.

## Environment

- Secrets live in `.env` locally (git-ignored) and in the Render dashboard in
  production. Never commit `.env`. Never print API keys in output.
- Key vars: `API_FOOTBALL_KEY`, `SEASON`, `PORT`, `ENABLE_UNLICENSED_SOURCES`
  (master kill switch in `server/src/unlicensed.js` — gates every unlicensed
  data path at once; MUST be 0/unset in any public release),
  `ENABLE_STREAMING_AUTO` (per-source flag, inert unless the master switch is
  also 1), `ADMIN_KEY` (bearer token for `/api/admin/stats` —
  upstream request counts and cache hit rate; endpoint returns 503 if unset).
  `/admin` serves a human-friendly page (`server/admin.html`) for the same stats:
  it asks for the key once and stores it in localStorage.
- Adding a new secret takes BOTH steps: declare the key in `render.yaml` under
  `envVars` with `sync: false`, and set its value in the Render dashboard
  (Environment tab on the usa-fc service). A dashboard-only var on this
  Blueprint-managed service didn't reach the server when ADMIN_KEY was added
  (Sept 2026) until it was declared in `render.yaml` too.
- The same rule applies to EVERY service setting, not just env vars: on this
  Blueprint-managed service a `render.yaml` push triggers a sync that enforces
  whatever the yaml says, reverting dashboard-only changes. The paid instance
  upgrade was dashboard-only, so the 2026-09-10 rebrand push (which touched
  render.yaml still saying `plan: free`) silently downgraded the service to
  free — spin-downs and the Render loading page came back until `plan: starter`
  was committed. Any future instance-type change must be made in `render.yaml`.
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

Admin stats (`server/src/metrics.js`): in-memory counters — API-Football request
timestamps (rolling 24h window) recorded in `api()` (retries count separately, matching
what the API bills), cache hit/miss counted in `cache.wrap()` (fresh hit or in-flight
join = hit). Served by token-protected `/api/admin/stats` (Authorization: Bearer or
x-admin-key header, timing-safe compare, 503 when ADMIN_KEY unset) and the `/admin`
page. Like the caches, counters reset on every restart (`serverStartedAt` in the
response says when).

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

Cache warmer (`server/src/warm.js`, started from index.js): pre-fills every
user-facing cache — players, schedule, leagues, all 55 team pages, all 72 player
profiles (which also fill each club's `team-upcoming`) — so opens never hit
API-Football cold. It must run in-process because the caches are in-memory.
Three triggers: **startup** (full fill, ~1,400 calls / ~6 min cold), **daily at
09:00 UTC** (forced refresh, ~400 calls — quiet hour between South American late
games and European kickoffs), and **post-match** (a 5-min checker watches tracked
kickoff times; once no tracked match has kicked off for 3h, a contiguous block of
kickoffs is "over" and it force-refreshes stats, schedule, rounds, and the played
teams' caches — one warm per block, not per match). Forcing uses `cache.del()` so
unexpired-but-stale keys (24h stats right after a match) re-fetch. Logs as
`[warm] <reason> ... done in Ns` (visible in Render logs).

`getMatches` layers three passes on the cached schedule each request: a 60s live
overlay, a reconcile for matches the cache thinks are live but the live feed dropped
(they finished), and a badge backfill for finished matches (applies all cached details,
fetches at most 15 uncached per request, newest first).

`apiFootball.js` invariants:
- All upstream calls go through `api()` — globally throttled (250ms spacing) with
  backoff retry on per-minute rate limits. Never fetch the API directly elsewhere.
- League/cup ids and the tracked nationality live in `server/config/coverage.json`,
  loaded by `server/src/coverage.js` (which exports `LEAGUE_IDS`/`CUP_IDS`);
  fixtures are always labeled via `ID_TO_NAME` because the API reuses names across
  countries (Brazil's league is literally "Serie A", Austria's is "Bundesliga",
  two "League Cup"s exist).
- Venue country isn't in fixture payloads; `matchDetail` looks it up via `/venues`
  once per stadium (`venueLocations` Map, process-lifetime — stadiums don't move),
  falling back to the league's country unless it's "World" (UEFA cups etc.).
- Fixture↔player matching uses `apiFootballTeamId` (exact), falling back to loose
  club-name matching only for players with no id (zero appearances this season). Cup
  draws are full of near-name collisions ("Racing Club Warwick" ≠ Racing Club de
  Avellaneda) — never go back to name-only matching.
- Squad status: `start`/`on`/`bench`/`out` per tracked player. "Subbed on" is detected
  from per-player minutes, NOT substitution events (the API's in/out field order is
  unreliable). `out` + fixture injury report → `outInjured` (red cross in UI).

## Data sources (server/adapters/)

Four sources in two adapter groups; each has one job. In production only two are
live: API-Football + streaming.json.

Providers (`providers/`) — match/player data. `index.js` picks ONE at startup:
- API-Football (`apiFootball.js`): the real source for everything — season stats,
  fixtures, live scores, match detail, profiles, transfers, rounds. Active when
  `API_FOOTBALL_KEY` is set. Mega plan ($39/mo, upgraded Sept 2026): 150,000
  requests/day. Responses include `x-ratelimit-requests-remaining` headers — check
  them before assuming budget. The daily cap is no longer a practical constraint,
  but a per-minute burst limit still applies (300/min on the old Pro plan; Mega's
  exact figure unverified) — keep the throttle, batch or space live requests, and
  never add a new poll loop without estimating req/min.
- Demo (`demo.js`): keyless stand-in with bundled data; one match is always "live" so
  the 60-second poll path can be developed offline. Returns `demo: true` on everything.

Streaming (`streaming/`) — "what US service is this match on?"
- configFallback: hand-maintained `server/config/streaming.json` mapping competition →
  US broadcaster (e.g. Championship → Paramount+). Fuzzy name matching. Re-read on
  every lookup, so edits need no restart. THIS IS WHAT ACTUALLY ANSWERS IN PRODUCTION.
- liveSoccerTv: intentional stub, always returns null. Placeholder for a licensed
  match-level lookup (LiveSoccerTV forbids scraping). Needs
  `ENABLE_UNLICENSED_SOURCES=1` + `ENABLE_STREAMING_AUTO=1` — leave both off.

All unlicensed paths share one master kill switch: `ENABLE_UNLICENSED_SOURCES`
(`server/src/unlicensed.js`). Per-source flags do nothing without it, and it
MUST be off in any public release. Any future scraper or unlicensed lookup must
check it too. With everything off the UI is unaffected: gated adapters return
null, streaming falls through to configFallback (or "Unknown"), and
interceptions come from API-Football. The server's `clearances` field actually
carries API-Football's blocks (the API has no clearances stat), and the UI
labels it "Blocks". A FotMob stats scraper once lived in `server/adapters/scrapers/`;
it was deleted (Sept 2026) — don't reintroduce scraping in production paths.

## Config layer (server/config/)

Deployment-level choices live in config files, not code — one instance, shared by
everyone using it:
- `coverage.json` — which leagues/cups this deployment tracks (name → API id,
  country, FIFA code) and the tracked `nationality` ("USA") plus the
  `nationalTeamPattern` regex for splitting national-team career rows. Loaded
  server-side by `server/src/coverage.js`; the client imports the SAME file at
  build time via `client/src/leagues.js` (Vite bundles it — a coverage edit needs
  `npm run build`, and the vite dev server has `fs.allow: ['..']` so it can serve
  the file from outside the client root).
- `streaming.json` — competition → US broadcaster fallback (see Data sources).

Per-user choices live in `client/src/settings.js` — a localStorage-backed
preferences layer (`getSetting`/`setSetting`, defaults in `DEFAULTS`). Its key is
`unclesamfc-settings`; reads fall back to the pre-rename `usafc-settings` key so
old devices keep their preferences. Currently
just `units` (`imperial` default, `metric` supported), used for height/weight in
`PlayerProfile.jsx`. There is no settings UI yet; new per-user display
preferences should route through this module rather than being hard-coded.

## Data files (server/data/)

- `players.json` — the tracked roster, hand-editable, source of truth. The server
  writes back resolved `apiFootballId`/`apiFootballTeamId` but ONLY fills blanks —
  a wrong stored id is never re-checked. A dead/mismatched apiFootballId shows up
  as null age + all-zero stats + empty career rows (Agyemang had id 360681, an
  empty record; his real one is 407652): verify a suspect id by pulling its
  season rows and matching them to the player's actual clubs before trusting
  anything derived from it. Team-id resolution needs at least one current-season
  club stat row, so a player with none (injured all season, just transferred)
  keeps a null apiFootballTeamId until hand-set (Derby is 69). The file is
  committed to git so Render's ephemeral disk boots warm.
  Optional hand-maintained `"capTied": true` flag (player has senior competitive
  caps for ANY country — a friendly never ties) and
  `"otherEligibility": ["Country", ...]` (source-verified other national teams a
  non-tied player could represent) drive the Stats tab's cap-tied and
  eligibility filters; eligibility also shows as the profile sheet's
  "Also eligible" row. Absent means not tied / none verified. Both audited
  Sept 2026 (API-Football career rows cross-checked against Wikipedia/press;
  the API counted a phantom 0-minute Maloney cap, so never flag from API rows
  alone). Only set either field from a verified source — never guess.
  The `/api/players` payload also carries each player's `age`
  (from API-Football; demo mode simulates it), used by the Stats age filter.
- `excluded.json` — **roster policy**: players the API calls USA-nationality who chose
  another national team (e.g. Bajraktarević → Bosnia) are excluded here; `npm run
  discover` skips them. Season stats count only the player's current club — no
  prior-club (MLS) or national-team numbers; a mid-season transfer starts the line fresh.
- `hometowns.json` — hand-verified US birth states (and rare country corrections)
  keyed by player id; API-Football birth places have no state. Merged into profile
  bios by `withHometown()` in service.js, read fresh each call so edits need no
  restart. Only add entries verified against a real source — city names repeat
  across states (Clovis NM vs CA, Birmingham AL vs MI). New roster additions won't
  have an entry until one is added by hand.
- `demo/` — demo-mode dataset (fixtures generated relative to server start, includes a
  simulated live match so the 60s poll path works keyless).

## Client notes (client/src/)

- Overlay sheets (player profile, match, team) render through React portals to
  `document.body` — the leaderboard's sticky column creates stacking contexts that
  otherwise paint over them. Modal backdrop z-index is 100, above the sticky topbar (40).
- `PlayerProfile.jsx` ⇄ `TeamSheet.jsx` intentionally import from each other
  (PlayerLink/TeamLink/FixtureLine); imports are only used at render time so the cycle
  is safe — don't "fix" it by duplicating components.
- League display names/countries come from the shared `server/config/coverage.json`
  via `leagues.js` (build-time import); streaming labels must stay
  bare service names (no parentheticals) — user preference.
- American marking (user preference, settled Sept 2026 after one revert): in the
  MatchSheet ("game view") every tracked American is red + 🇺🇸 everywhere — lineups,
  bench, and BOTH names of an event. Events carry `trackedId` AND `assistTrackedId`
  (the second slot holds a goal's assister or the player subbed ON, and the API's
  subst in/out slot order is unreliable, so both slots must be checked — this is how
  Pukštas went unmarked when subbed on). Schedule-card chips stay navy, red only when
  the player scored, no flags — do NOT re-add red/flags there.
- Loading splash (added Sept 2026): the full-bleed Uncle Sam crest artwork
  (`crest.png` as a cover background over navy) with the wordmark, motto, and
  red/white/blue bouncing dots anchored near the bottom over a navy gradient
  scrim; it covers the app from first paint until the initial
  players AND matches fetches both settle, then fades out. It exists twice with
  identical markup — static HTML inside `#root` in `client/index.html` (paints before
  any JS loads) and a React `Splash` component in `App.jsx` (covers the data wait).
  Both are styled by the inline `<style>` block in index.html — keep the two copies
  and that style block in sync.
- Stats tab filters (Sept 2026): one Filters button (active-count badge) opens a
  panel holding every filter — league toggles (moved from the old always-visible
  row), multi-select position and age-range chips (empty selection = All; picking
  every option collapses back to All), a 0→max minimum-minutes slider (max is the
  roster's top minutes total, so it grows with the season), cap-tied
  Include/Hide, and other-country eligibility All/Eligible/Not eligible. The
  cap-tied and eligibility filters read the hand-audited `capTied` /
  `otherEligibility` fields in players.json (see Data files); "Not eligible"
  means no VERIFIED other eligibility on record. A player's other-eligibility
  list is displayed only in the full profile sheet ("Also eligible" row in
  PlayerProfile.jsx) — deliberately not on hover cards, Players-tab cards, or
  the leaderboard.
- The service worker (`public/sw.js`) is network-first for `/api/` and navigations so
  deploys and live scores are never stale; bump its cache name if you change caching.
- An open `MatchSheet` on a live match re-pulls detail every 60s
  (`fetchMatchDetail(id, { fresh: true })` skips the 60s client memo but still
  updates it). These polls are server cache reads — the server's shared timer does
  the upstream fetching, so per-viewer polling adds no API-Football cost.
- Branding: Old Glory red `#B31942` (motto uses brightened `#E0455F`), navy `#0A3161`,
  logo is a full-color Uncle Sam illustration (`client/public/crest.png`, replaced the
  original USAFC shield crest Sept 2026; deliberately NOT the trademarked USMNT logo). Squad badge
  labels: XI / ON / BENCH / OUT. The topbar wordmark is `white-space: nowrap` with a
  `clamp()` font size (styles.css) — "Uncle Sam FC" is long enough to wrap on phones
  otherwise.
- American goal marker (`UsaBall` in icons.jsx, settled Sept 2026): drawn to look
  exactly like the ⚽ emoji used for regular goals — same tilted pentagon layout,
  spherical shading, beveled panels, soft edge with NO hard outline ring — just
  recolored: navy panels where the emoji is black, red seams. Iterate on it by
  screenshotting it next to the real emoji in a browser; check it at 13px too,
  that's the size it renders in the app.
- Collapsing topbar: the collapse removes ~124px of layout height, so it MUST keep
  `overflow-anchor: none` on `html` (styles.css) and the hysteresis thresholds in
  App.jsx (collapse past 24px, re-expand under 8px). A single scroll threshold
  oscillates on Android — Chrome's scroll anchoring shifts scrollY to compensate for
  the shrink, re-crossing the threshold in a loop. iOS Safari has no scroll anchoring,
  so iPhone testing will never catch a regression here.

## Conventions

- Player profiles default to imperial units (feet/inches, pounds); the per-user
  `units` setting in `client/src/settings.js` can switch a device to metric.
- Player bios read like an American scouting card (set Sept 2026).

## Testing against real data

Football data changes constantly — verify claims against the live API rather than
memory (e.g. a player showing zero stats may genuinely be injured or frozen out, not a
bug: check their career rows). But all-zero stats PLUS a null age or empty career
means the roster's apiFootballId is probably a dead record — see players.json above. The account is a paid Mega plan (150,000 req/day since
Sept 2026, after restarts exhausted the old 7,500 Pro cap in one day); a fully
cold startup warm uses ~1,400 calls (dominated by first-time player profiles, which
then cache 7d), the daily forced warm ~400, the finished-match backfill a few hundred
once per restart (details cache for 30d, longer than the server usually lives). Daily
budget is ample now; the per-minute burst limit is what still demands care — don't add
new bulk fetch loops without estimating req/min. `/api/admin/stats` (or the `/admin`
page) shows live request counts and cache hit rate.

When verifying scroll/animation behavior in the Claude browser pane, the tab must be
visible (fronted): hidden tabs pause rendering, which freezes CSS transitions at their
start value and suppresses scroll-event dispatch — tests read as false failures.

## Known issues / next up

- streaming.json is hand-maintained by competition. Review each August when US rights
  change. Finding a licensed broadcast-data source is a future task, not something to
  attempt ad hoc.
- There is no settings UI: per-user preferences (`client/src/settings.js`, currently
  just `units`) can only be changed from the browser console. Build a small settings
  screen once a second preference exists.

## Working style

- Explain changes in plain language; Seth is not a professional developer.
- Check in before adding new dependencies or external services.
- Keep this file updated when a durable decision is made. Remove items from Known
  issues once they are fixed.
