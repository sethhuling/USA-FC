# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Uncle Sam FC (renamed from USA FC, Sept 2026) — a mobile-first PWA tracking American soccer players at non-US clubs. Express
server (`server/`) proxies API-Football, owns the API key, caching, and rate limiting;
Vite/React client (`client/`) is built to `client/dist` and served statically by the
same server on port 8787. Deployed on Render at https://uncle-sam-fc.onrender.com
(service `uncle-sam-fc`, created Sept 2026 as a plain web service after the original
Blueprint-managed `usa-fc` service was suspended) on a paid instance — it must not
go back to free: free instances spin down after 15 idle minutes, which showed
Render's own loading page on open, wiped the in-memory caches (forcing the
~1,400-call startup warm on every wake), and stopped the daily/post-match warm
scheduler.

Tabs: Schedule (past/live/upcoming, with US streaming info), Stats (leaderboards),
Players (profiles with bio and season stats), News (hand-picked headline links +
an auto-written daily roundup). Primary user is Seth, mostly on an iPad
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

Demo-mode limits: match details carry no lineups, events, or stats (demo.js
returns them empty), so MatchSheet events/lineup UI changes can't be exercised
against demo data — verify by temporarily injecting sample markup into the page
(then removing it), or check the production site after deploy.

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
- The live `uncle-sam-fc` service is a PLAIN web service, not Blueprint-managed
  (since Sept 2026): the Render dashboard is the single source of truth for env
  vars, instance plan, and every other service setting. Set new secrets in the
  dashboard's Environment tab only; keep the plan at Starter there. `render.yaml`
  is a LEGACY leftover from the old Blueprint-managed `usa-fc` service (now
  suspended) — it configures nothing that is live. Do not reconnect a Blueprint
  to this repo without first updating render.yaml's service name; while the old
  Blueprint existed, yaml pushes silently reverted dashboard-only changes (a
  `plan: free` in yaml once downgraded the paid instance), and env vars had to
  be declared in BOTH places. None of that applies to the current service.
- `SEASON` is blank in `.env` and unset in the Render dashboard, so the server
  auto-computes it (`season()` in `server/adapters/providers/apiFootball.js`:
  calendar year, rolling over each August — 2026 as of Sept 2026). No manual summer
  bump is needed; only set it to pin a specific season.

## Deploy

Push to `main` (the repo's default branch) on GitHub → the `uncle-sam-fc` web
service auto-deploys from its GitHub link (~3 min; build/start commands live in
the service's dashboard settings, not render.yaml). Confirm a deploy landed by grepping the served HTML
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
profiles 7d (upcoming fixtures separately at 1h, injury reports at 12h), team pages
6h, finished-match details 30d. Match details use two keys: `match:<id>` (60s, live/upcoming) and
`match-final:<id>` (30d) — `getMatchDetail` serves the long-lived copy first, and
both it and the badge backfill write to it, but ONLY details whose status is
actually `finished` (a null or still-live detail must never be long-cached).
While a live match's detail is being viewed, a single server-side timer
(`watchedLive` in service.js) refreshes it every 60s and all viewers read the
shared cache — N concurrent viewers cost 1 upstream call per interval, and the
timer stops when the match finishes or nobody has viewed it for 3 minutes. Each
tick logs `[live-detail] refreshed N watched match(es)` (visible in Render logs).

Cache warmer (`server/src/warm.js`, started from index.js): pre-fills every
user-facing cache — players, schedule, leagues, every team page, every player
profile (85 players as of Sept 2026; profiles also fill each club's
`team-upcoming`) — so opens never hit
API-Football cold. It must run in-process because the caches are in-memory.
Three triggers: **startup** (full fill, ~1,400 calls / ~6 min cold), **daily at
09:00 UTC** (forced refresh, ~400 calls — quiet hour between South American late
games and European kickoffs), and **post-match** (a 5-min checker watches tracked
kickoff times; once no tracked match has kicked off for 3h, a contiguous block of
kickoffs is "over" and it force-refreshes stats, schedule, rounds, and the played
teams' caches — one warm per block, not per match). Forcing uses `cache.del()` so
unexpired-but-stale keys (24h stats right after a match) re-fetch. Logs as
`[warm] <reason> ... done in Ns` (visible in Render logs).

Automatic roster sync (`server/src/rosterSync.js`, run by warm.js; added Sept
2026): scans every coverage.json league for US-nationality players and appends
new ones to players.json — this is what makes a newly covered league appear in
the app once an American plays there (every UI surface derives from the
roster, so an empty league shows nowhere). Runs after the startup warm and
before the daily 09:00 warm (~1,000 throttled calls per scan, shares the
global 250ms spacing; logs as `[roster-sync]`). The automatic path is
ADD-ONLY: it never rewrites an existing entry's club/league (hand-maintained,
and the club string drives the current-club-only stats filter) — only the
manual `npm run discover` (same shared module, `refreshExisting: true`)
refreshes those. Runtime additions land on Render's ephemeral disk and vanish
on the next deploy; the startup sync re-finds them within minutes, but commit
players.json now and then to make them durable. Auto-added players arrive
without the hand-audited extras (capTied, otherEligibility, hometowns) — audit
them when they show up, and add anyone who chose another national team to
excluded.json.

News tab (`server/src/news.js`, `/api/news`; added Sept 2026) — two parts, both
built to stay legally above board (see "News legal rules" below):
- Headlines: read fresh from hand-maintained `server/data/news.json` on every
  request (validated: http(s) URL, title, source, YYYY-MM-DD date, category
  abroad/usmnt/youth; unknown player ids dropped; domains in `blockedSources`
  hidden). Maintained by the CLOUD routine "Uncle Sam FC news headlines"
  (claude.ai/code/routines/trig_018cAswdyaHHLELPGycctGVE; cron
  `0 14,17,19,22 * * *` UTC = 10 AM / 1 PM / 3 PM / 6 PM Eastern during
  daylight time — one hour earlier in winter, since routine cron is UTC-only),
  running in the "USFC website" cloud environment like the "Uncle Sam FC
  injury news scan" routine (08:00 UTC daily). Both run without Seth's Mac;
  the old local desktop tasks of the same names were deleted (Sept 2026) —
  don't recreate local copies alongside the routines. Both routines push
  with `git push origin HEAD:main` then point the local branch at
  origin/main, so they leave no stray `claude/*` branches on GitHub. Cloud runs can only open sites on
  that environment's network allowlist; a blocked publisher can't be
  verified, so its stories are dropped, and each run's report lists blocked
  domains. Since Sept 11, 2026 "USFC website" uses a CUSTOM allowlist of the
  app itself plus major outlets (ESPN, Guardian, U.S. Soccer, Goal, CBS, Fox,
  Yahoo Sports, SI, USA Today, SBI, American Soccer Now, Stars and Stripes FC,
  NYT/The Athletic, Reuters, AP, BBC, Sky Sports) — chosen over Full access
  because these runs can push to main. Add a domain there when run reports
  keep listing it (e.g. soccerwire.com was blocked on the first run). Editing
  it: claude.ai/code/routines → routine → pencil → cloud icon under
  Instructions → HOVER the environment row → gear icon → Network access. The
  gear only appears on mouse hover, so it can't be done from the iPad/phone.
  Verification falls back to `curl` + og:title/published_time when WebFetch
  refuses a site (USA Today, Reuters, AP). It pushes only
  news.json and only when a run ADDED a link, because every push redeploys
  (restart → cold caches, full startup warm + roster sync, ~2,400 calls).
  Those restarts often land mid-match, which is why warm.js starts
  `lastHandledKickoff` one match window before boot — a match in progress at
  boot still gets its post-match refresh.
- Daily roundup: plain sentences per match ("Weston McKennie started for
  Juventus as they hosted Palermo. McKennie scored 1 goal and was subbed off in
  the 67th minute.") — NO closing result sentence (user request: the article
  subhead already shows the score), except "…won 2–1 after extra time" /
  "…won 4–3 on penalties", which the score line can't say — written by FIXED RULES from API-Football
  match details — deliberately no AI (user choice: can never state anything the
  data doesn't). Covers finished matches from the last 7 US-Eastern days: every
  tracked American who started / came on / was an unused sub (out-of-squad
  players aren't mentioned), plus national-team results (USMNT + U-23/U-20/U-17,
  ids in coverage.json `nationalTeams`, fetched via `/fixtures?team&last=10`,
  cached `national-fixtures` 1h) with U.S. scorers and red cards. Safety
  rules: if a match's goal events don't sum to the final score, NO scoring
  details are stated for it; "played the full match" only when per-player
  minutes ≥ 90 (sub events can lack a player); sub direction comes from squad
  status, not the unreliable in/out slots; shootout kicks excluded; second
  mentions use the surname only for plain two-word names ("Konrad de La
  Fuente" keeps his full name).
  Stat highlight (user request): each player who played gets their single MOST
  POSITIVE stat from the match's per-player stats (`trackedStats` on match
  details) — `bestStat()` scores candidates (pass completion with volume,
  key passes, tackles/interceptions/blocks or combined "defensive
  contributions", duels won, dribbles, shots on target, fouls drawn, keeper
  saves/clean sheet, penalties won/saved) and states the winner with raw
  counts ("completed 39 of 43 passes (91%)"); nothing is added if no stat
  clears a minimum (a weak number reads as a knock). Goals/assists are stated
  separately, never as the highlight. In /fixtures player stats
  `passes.accuracy` is a COUNT, and `goals.conceded` is null even for keepers
  who conceded — clean sheets come from the final score. Text stays
  pronoun-free (surnames, not he/his).
  Each day becomes an ARTICLE (`dayArticle()`): a headline built from the facts
  ("Reyna scores for Strasbourg as 15 Americans see action"; a national-team
  result leads when there is one), a one-line summary (dek), and stories
  ordered national team → matches with American goals/assists (biggest first)
  → the rest by kickoff. The "N Americans see action" number counts only
  Americans who STARTED or CAME ON (unique players that day) — not games, and
  not the unused subs the article also names, so it's often lower than the
  number of Americans named. User confirmed this is correct (Sept 2026, after
  briefly reading it as wrong) — don't change it. Matches whose data has NO
  lineups and no per-player stats (lower-division cup ties: Austrian Cup,
  Stenhousemuir–Hearts in the Scottish League Cup, Sept 11 2026) used to be
  dropped from the roundup entirely, because every American in them had a null
  squad status — which silently lost a goal-and-two-assists game. Now anyone
  NAMED BY AN EVENT (goal, assist, card, substitution) in such a match gets
  squad status `'played'` — "featured, start vs. sub unknown" — and is written
  up as "X played for Y as they visited Z" plus goals/assists/cards. Start/sub
  minutes are still never claimed there (the API's sub in/out slot order is
  unreliable and there is no lineup to disambiguate it), and an American who
  featured without an event to his name is still unknowable, so still unnamed.
  Cached as `roundup` (1h, 5 min when a detail
  failed); built LAST in every warm (after profiles, so the badge backfill has
  already cached the details it needs — ~180 calls when fully cold) and
  force-rebuilt by daily/post-match warms. Demo mode has no lineups/events, so
  the roundup is empty there — verify roundup text by running `buildRoundup()`
  from `news.js` in a node script against the real key (~180 calls), and UI by
  overriding `window.fetch` for `/api/news` in the browser.

`getMatches` layers three passes on the cached schedule each request: a 60s live
overlay, a reconcile for matches the cache thinks are live but the live feed dropped
(they finished), and a badge backfill for finished matches. The backfill applies
cached details inline (in-memory, cheap) but NEVER fetches upstream in the request
path — uncached ones go to a background drain (`scheduleBadgeBackfill`, one loop at
a time, queue replaced per request) whose results the next request applies. Inline
fetching used to add ~5s to every /api/matches response until a month's backlog
drained after each restart, and the loading splash waits on this endpoint — don't
reintroduce upstream awaits in getMatches' response path (perf fix, Sept 2026).

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
- A tracked player's goal list (`extractPlayerEvents`, drives the red Schedule
  chips and goal markers) excludes missed penalties, OWN GOALS (the event names
  the player who put it in his own net) and penalty-SHOOTOUT kicks
  (`comments: "Penalty Shootout"`). Fixed Sept 2026 — before that an American's
  own goal would have shown as his goal.
- Player availability (`playerInjuryStatus`, added Sept 2026) comes from
  `/injuries?player&season` — fixture-dated missing/questionable rows with a reason,
  including upcoming fixtures a player is already ruled out of. Only rows within the
  last 10 days or in the future count as "current". Do NOT use `/sidelined` for
  "injured now": its open-ended entries never get closed (Cardoso carried a
  year-old "Ankle Injury" while starting weekly). The API publishes no
  expected-return date, so `expectedReturn` is always null and the UI shows
  "Unknown" — never invent one. Cached as `injury:<id>` (12h) in service.js,
  merged into the profile payload as `profile.injury` (null = fit, also cached).

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
  is 900/min per the `x-ratelimit-limit` header, seen Sept 2026) — keep the throttle, batch or space live requests, and
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
  country, FIFA code; cups carry `{ id, country }`, UEFA cups use "Europe"),
  a `flags` map (country → flag emoji, "Europe" → 🇪🇺) that puts a flag before
  the competition name on Schedule cards (`competitionFlag()` in leagues.js —
  a new league/cup country needs a `flags` entry or its cards show no flag),
  and the tracked `nationality` ("USA") plus the
  `nationalTeamPattern` regex for splitting national-team career rows. Loaded
  server-side by `server/src/coverage.js`; the client imports the SAME file at
  build time via `client/src/leagues.js` (Vite bundles it — a coverage edit needs
  `npm run build`, and the vite dev server has `fs.allow: ['..']` so it can serve
  the file from outside the client root).
- `streaming.json` — competition → US broadcaster fallback (see Data sources).
- `site.json` — public contact / link-removal email (UncleSamFCapp@gmail.com)
  shown in the News tab footer; client imports it at build time.
- coverage.json's `nationalTeams` — the tracked nationality's national teams
  (API-Football team ids + display label + news category). News roundup only;
  national-team matches never touch season stats (current-club-only rule).

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
- `excluded.json` — **roster policy**: two skip lists, both honored by `npm run
  discover` AND the automatic roster sync. `excluded`: players the API calls
  USA-nationality who chose another national team (e.g. Bajraktarević →
  Bosnia). `departed` (added Sept 2026): players who left covered leagues
  mid-season (moved to MLS or an uncovered league, e.g. Johan Gómez → Chicago
  Fire, Ian Hoffmann → Mjällby/Allsvenskan) — without this, their old league's
  season stat rows would re-add them on every scan; remove the id if the
  player returns to a covered league. Season stats count only the player's
  current club — no prior-club (MLS) or national-team numbers; a mid-season
  transfer starts the line fresh.
- `hometowns.json` — hand-verified US birth states (and rare country corrections)
  keyed by player id; API-Football birth places have no state. Merged into profile
  bios by `withHometown()` in service.js, read fresh each call so edits need no
  restart. Only add entries verified against a real source — city names repeat
  across states (Clovis NM vs CA, Birmingham AL vs MI). New roster additions won't
  have an entry until one is added by hand.
- `injury-notes.json` — hand-verified injury notes keyed by player id:
  press/club-sourced `expectedReturn` free text ("around Christmas") and a more
  specific `reason` than the API's label ("Quad Injury" where the API says
  "Muscle Injury"), each with a `source` URL and `verified` date. Merged by
  `withInjuryNote()` in service.js ONLY onto an active API injury report, so a
  stale note self-cleans when the API stops flagging the player. Read fresh
  each call — edits need no restart. Only add entries verified against a real
  source (the API publishes no return dates; this file is the ONLY place they
  come from). No automated scraping in the app itself — the notes are
  refreshed by the "Uncle Sam FC injury news scan" cloud routine (08:00 UTC
  daily, game days only; web search + verified sources, pushes this file
  only), or on request (ask Claude to re-check the news for flagged players).
- `news.json` — News-tab headline links (`headlines` array + `blockedSources`).
  Each entry: exact published `title`, publisher `source` name, canonical
  `url`, `published` date, `category` (abroad | usmnt | youth), `players`
  (roster ids), optional `paywall`, `added`. Maintained by the "Uncle Sam FC
  news headlines" cloud routine (see News tab above); every entry must be verified against the live page (no
  fabrication). Pruned to ~14 days. To honor a publisher's removal request, add
  its domain to `blockedSources` (hides all its links) and delete its entries.
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
- Substitution icon (user preference, Sept 2026): the MatchSheet events list uses
  a bold light-blue ⇄ text glyph (`.subst-icon` in styles.css, brighter tint in
  dark mode), NOT the 🔁 emoji — its orange arrows read as a yellow card at
  event-list size. Emoji can't be recolored, hence a styled glyph.
- Loading splash (added Sept 2026): the full-bleed Uncle Sam crest artwork
  (`crest.png` as a cover background over navy) with the wordmark, motto, and
  red/white/blue bouncing dots anchored near the bottom over a navy gradient
  scrim; it covers the app from first paint until the initial
  players AND matches fetches both settle, then fades out. It exists twice with
  identical markup — static HTML inside `#root` in `client/index.html` (paints before
  any JS loads) and a React `Splash` component in `App.jsx` (covers the data wait).
  The splash stays up until the data settles AND at least 3s from page open
  (user preference, Sept 2026, added once loads became near-instant) — the
  minimum is measured with `performance.now()` so pre-React time counts.
  Both are styled by the inline `<style>` block in index.html — keep the two copies
  and that style block in sync.
- Stats tab filters (Sept 2026): one Filters button (active-count badge) opens a
  panel holding every filter — league toggles (moved from the old always-visible
  row; grouped under country headings in a fixed user-chosen order — England,
  Spain, Italy, Germany, France, Portugal, Scotland, Belgium, Netherlands,
  Austria, Mexico, Brazil, Argentina, then unlisted countries alphabetically — with
  leagues inside a country in coverage.json order, top tier first, via
  `leagueRank()` in leagues.js), multi-select position and age-range chips (empty selection = All; picking
  every option collapses back to All), a 0→max minimum-minutes slider (max is the
  roster's top minutes total, so it grows with the season), cap-tied
  Include/Hide, and other-country eligibility All/Eligible/Not eligible. The
  cap-tied and eligibility filters read the hand-audited `capTied` /
  `otherEligibility` fields in players.json (see Data files); "Not eligible"
  means no VERIFIED other eligibility on record. A player's other-eligibility
  list is displayed only in the full profile sheet ("Also eligible" row in
  PlayerProfile.jsx) — deliberately not on hover cards, Players-tab cards, or
  the leaderboard.
- Profile sheet bio grid (PlayerProfile.jsx): NO Nationality row — every tracked
  player is USA by definition, so it was removed (user preference, Sept 2026);
  don't re-add it. The Profile section renders only when at least one row has
  content (Born, Hometown, Height, Weight, or Also eligible) — Nationality used
  to be its only guaranteed row, so without this guard an empty "Profile" box
  could appear.
- Profile "This season" stat grid (PlayerProfile.jsx): 12 tiles, exactly 3 rows
  of 4 on the sheet. The raw Passes tile was removed (user preference, Sept
  2026) because a 13th tile pushed the grid onto an ugly 4th line — Pass %
  stays. Don't re-add Passes, and adding any new tile means removing one.
- Injury banner (PlayerProfile.jsx, Sept 2026; user wants it BRIEF): `profile.injury`
  renders a red banner in the profile sheet and a one-line note on the hover card.
  Headline = the injury name itself ("Hamstring Injury"); the classifying label
  (Injured / Doubtful / Suspended / Unavailable) stands in only when the reason
  is missing or the bare word "Injury". Detail is one line: "Injured Sep 2 ·
  Expected return late October" ("Out since …" for non-injury absences,
  "Doubtful for the … fixture" for questionable). Expected return comes only
  from hand-verified injury-notes.json; "unknown" otherwise — never fabricate
  one. Demo mode simulates Pulisic (out, with a return note) and Cardoso
  (doubtful) so the banner is testable offline.
- News tab (`NewsTab.jsx`, 4th tab): ONE list (user request — the roundup lives
  among the headlines as an article, not in schedule-style cards) with All /
  Americans Abroad / USMNT / Youth filter chips. Outside headlines and our
  Daily Roundup articles are interleaved by date; the newest roundup is pinned
  to the top. An outside headline renders ONLY as the publisher's headline
  linking out (new tab, never framed or shown in-app), the publisher name as
  plain text, the date, a "Subscriber" tag when paywalled, and tagged-player
  chips (PlayerLink). Never add snippets, thumbnails, publisher logos, or an
  in-app reader view for outside stories — see News legal rules. No artwork
  or photos of our own either (branded tiles, licensed player photos were
  offered; user declined Sept 2026: "leave it as is") — the list stays
  text-only. A roundup
  teaser (red left rule, "Daily Roundup" kicker, serif headline + 2-line dek,
  "Uncle Sam FC" as source) opens `RoundupArticle`, an article-styled sheet:
  headline, dek, byline ("Written automatically from match data"), one
  subhead per match (score line — tap opens the MatchSheet — plus
  competition) and a serif paragraph with tracked players' full names linked
  to their profiles. The footer carries the
  "links go to publishers / not affiliated with U.S. Soccer / link-removal
  email" notice — keep it.
- The service worker (`public/sw.js`) is network-first for `/api/` and navigations so
  deploys and live scores are never stale; bump its cache name if you change caching.
- An open `MatchSheet` on a live match re-pulls detail every 60s
  (`fetchMatchDetail(id, { fresh: true })` skips the 60s client memo but still
  updates it). These polls are server cache reads — the server's shared timer does
  the upstream fetching, so per-viewer polling adds no API-Football cost.
- Stadium backdrop (Sept 2026): the whole app renders over a faded flag-crowd
  stadium photo (`client/public/stadium-bg.webp`), drawn by a `body::before`
  fixed pseudo-element in styles.css at 0.22 opacity (0.16 in dark mode) — a
  pseudo-element because iOS Safari ignores `background-attachment: fixed`.
  Two invariants: `body` must keep `isolation: isolate` (without its own
  stacking context the z-index -1 backdrop paints behind body's background and
  vanishes), and the splash is unaffected because its background is opaque.
- Branding: Old Glory red `#B31942` (motto uses brightened `#E0455F`), navy `#0A3161`,
  logo is a full-color Uncle Sam illustration (`client/public/crest.png`, replaced the
  original USAFC shield crest Sept 2026; deliberately NOT the trademarked USMNT logo). Squad badge
  labels: XI / PLAYED / ON / BENCH / OUT (PLAYED = featured in a match whose
  data has no lineups, so start vs. sub is unknown).
- Topbar wordmark (user-directed layout, Sept 2026 — header felt "clunky"/"stock"):
  STACKED and centered — big text-only "Uncle Sam FC" in Bebas Neue (loaded from
  the existing Google Fonts link in index.html, alongside Pinyon Script), white
  with a red "FC" span and a thin red gradient underline (`h1::after`), with the
  one-line motto ("Oh when the YANKS go marching in") directly beneath it. The
  square crest is deliberately NOT in the header — it stays as the app icon and
  splash art. On collapse the motto disappears (opacity AND max-height → 0; the
  bar is a column, so opacity alone would leave its gap) and the wordmark
  SHRINKS (never fades — it is the bar's identity now, per the user's explicit
  spec). Wordmark and motto are nowrap with vw-scaled `clamp()` font sizes so
  the motto's single line clears the 16px side padding down to small phones.
  The LIVE dot is absolutely corner-anchored (top right) so it never fights the
  stack for space. The splash wordmark matches the header exactly (user
  request): same Bebas wordmark with red FC, same gradient underline, same
  one-line motto beneath. Keep the static index.html copy and the React
  `Splash` copy in sync, and keep the splash styles visually in step with
  `.topbar h1` / `.motto` when either changes.
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
- Tappable topbar (Sept 2026): tapping the topbar smooth-scrolls to the top
  (`scrollY > 8`, matching the re-expand threshold); tapping at the top goes
  "home" — `setTab('schedule')` plus a bumped `scheduleResetKey` passed as
  ScheduleTab's React `key`, remounting it in its freshly-opened state (default
  Live & Upcoming view, filters cleared, scrolled to top). `onBrandTap` in
  App.jsx; the whole header is the tap target (cursor/tap-highlight styles on
  `.topbar` in styles.css).

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

## News legal rules (user-set, Sept 2026 — "stay very above board")

Researched Sept 2026 (not legal advice; a lawyer should review before a
monetized launch). What keeps the News tab low-risk:
- Headlines only as links OUT to the publisher's own page, with the publisher
  named in plain text. No article text, excerpts, publisher RSS descriptions,
  or news photos (copying ledes lost in AP v. Meltwater; wire/Getty photos are
  actively enforced). No framing/in-app reader views.
- Never use publisher RSS feeds or news-search APIs as the source: nearly all
  forbid commercial use (checked Sept 2026 — Google News RSS, The Athletic,
  Stars and Stripes FC/PMC, Fox, CBS, Guardian free RSS, Reddit). The headlines
  are hand-picked from the open web instead; linking needs no license.
- "USMNT" is a registered U.S. Soccer trademark (Reg. 7,710,595): plain-text
  descriptive use only (section labels), with the "not affiliated" footer. Never
  in the app name, logo, or merch; never U.S. Soccer's crest.
- Honor removal requests promptly (`blockedSources` in news.json). The public
  contact is UncleSamFCapp@gmail.com (`server/config/site.json`).
- Roundups are our own text written from licensed data (facts aren't
  copyrightable); API-Football's terms grant no redistribution license for raw
  data and note leagues may require extra licenses for "mass media
  distribution" — a question for the lawyer, and it applies to the whole app.

## Known issues / next up

- DMCA designated agent not yet registered — TABLED (Sept 11, 2026) until Seth
  forms an LLC, so it's filed under the LLC's name and street address instead of
  his home address (the directory is public). Seth files it himself at
  dmca.copyright.gov/osp/login.html ($6, renew every 3 years); agent can be a
  title ("Copyright Agent") with UncleSamFCapp@gmail.com and a P.O. box. Then
  add the agent's name/address/phone/email to the app (17 USC 512(c)(2)
  requires it on the site) and update this item. A one-time cloud routine
  "Reminder: DMCA agent registration (LLC)" fires 2026-09-18 10 AM ET and
  pushes a reminder unless this item says it's registered. Must be done before
  a public launch.

- streaming.json is hand-maintained by competition. Review each August when US rights
  change. Finding a licensed broadcast-data source is a future task, not something to
  attempt ad hoc. Entries verified Sept 2026 (only add source-verified carriers;
  no entry = "Unknown" in the UI). Three gaps pending announcements — re-check:
  Bundesliga 2 (no US home announced after its ESPN+ package ended with
  2025-26), A-League (2026-27 US arrangement unannounced as of Sept 2026;
  season starts mid-October — ESPN carried 2025-26), Eliteserien (league-run
  international OTT only, no stable US brand to cite).
- There is no settings UI: per-user preferences (`client/src/settings.js`, currently
  just `units`) can only be changed from the browser console. Build a small settings
  screen once a second preference exists.

## Working style

- Explain changes in plain language; Seth is not a professional developer.
- Check in before adding new dependencies or external services.
- Keep this file updated when a durable decision is made. Remove items from Known
  issues once they are fixed.
