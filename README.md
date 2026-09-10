# USA FC

USA FC — a mobile-first web app that tracks American soccer players at clubs outside the
United States: live scores, schedules with US streaming info, sortable stat
leaderboards, and a searchable player directory.

## Quick start

```bash
npm install       # installs server + client deps
npm run build     # builds the React client
npm start         # serves everything at http://localhost:8787
```

With no API key configured the app runs in **demo mode**: bundled illustrative
data with a simulated live match, clearly labeled with a banner. Demo stats are
not real; player clubs are a snapshot of early 2026 and may be out of date.

## Real data: API key setup

The primary provider is **API-Football** (api-sports.io).

Why API-Football over the alternatives:
- **API-Football** — covers all tracked leagues (see list below), per-player
  season stats including tackles, interceptions and pass accuracy, live fixtures
  with events and lineups.
  Caveat: the free tier serves only seasons 2021–2023 at 100 requests/day;
  current-season data needs a paid plan (entry tier is enough).
- **football-data.org** — generous free tier but no Liga MX, and no per-player
  defensive stats, which the Stats tab needs.
- **Sportmonks** — good data but Liga MX and detailed player stats sit behind
  higher-priced plans.

Setup:

```bash
cp .env.example .env
# edit .env and set API_FOOTBALL_KEY=your-key
npm start
```

The provider switches automatically when the key is present — no code changes.
Set `SEASON=2026` (season start year) if the auto-computed season is wrong for
your plan. **The key never reaches the browser**; all upstream calls happen in
the Node server.

> Honesty note: the API-Football adapter is written to the documented v3 API but
> was developed and verified against demo mode (no key was available in this
> session). Expect possible small field-mapping fixes on first live run.
> Known mapping caveat: API-Football exposes *blocks*, not true clearances — the
> server's internal `clearances` field carries blocks, and the UI labels it
> "Blocks" accordingly.

## Covered leagues

England: Premier League, Championship, League One. Top 5: La Liga, Serie A,
Bundesliga, Ligue 1. Plus: Liga MX, Eredivisie, Scottish Premiership,
Primeira Liga (Portugal), Belgian Pro League, Süper Lig (Turkey),
Brasileirão (Brazil), Liga Profesional (Argentina), Austrian Bundesliga,
and Champions League / Europa League fixtures.

Note: API-Football reuses league names across countries (Brazil's top flight is
named "Serie A", Austria's "Bundesliga"), so fixtures are always labeled with the
canonical names above, mapped by league id.

## Adding / removing players

Tracked players live in [`server/data/players.json`](server/data/players.json) —
hand-edit freely (the server reads it fresh on every request, no restart needed).
Each entry:

```json
{
  "id": "pulisic-christian",
  "name": "Christian Pulisic",
  "club": "AC Milan",            // must match the club name the provider uses
  "league": "Serie A",           // must match a key in the league tables below
  "position": "RW",
  "positionGroup": "FW",         // DF | MF | FW — used by the position filter
  "nationality": "USA",
  "apiFootballId": 1485          // required for real stats in API mode
}
```

Or auto-discover:

```bash
npm run discover
```

With an API key this scans every configured league for US-nationality players
and appends new ones (your hand edits are kept). Without a key it seeds from the
bundled demo roster. Discovery costs a few hundred API calls — don't run it on
the free tier.

## Adding leagues

1. Add the league id to `LEAGUE_IDS` in
   [`server/adapters/providers/apiFootball.js`](server/adapters/providers/apiFootball.js)
   (ids are in the API-Football docs).
2. Add a US broadcaster entry to
   [`server/config/streaming.json`](server/config/streaming.json).
3. Add or discover players in that league.

## Streaming info

Every match shows a US streaming service and **where that info came from**:

1. **Automatic lookup** (`server/adapters/streaming/liveSoccerTv.js`) — disabled
   by default. LiveSoccerTV has no public API and prohibits scraping, so this
   ships as a stub; if you have a licensed broadcast-data source, implement
   `forMatch()` there and set `ENABLE_STREAMING_AUTO=1`. Matches resolved this
   way are labeled "(LiveSoccerTV)".
2. **Config fallback** (`server/config/streaming.json`) — a hand-editable
   competition → US broadcaster map, labeled "(league default)" in the UI.
   Edit it anytime; changes apply without a restart. Broadcast rights change —
   verify entries each season.

## Caching & polling

| Data            | Server cache TTL | Client poll            |
|-----------------|------------------|------------------------|
| Player stats    | 24 h             | on load                |
| Schedules       | 1 h              | 5 min (no live match)  |
| Live matches    | 60 s             | 60 s while any match is live |

The server also de-duplicates concurrent upstream calls, serves stale data if
the upstream fails, and rate-limits clients (120 req/min/IP). Kickoff times are
rendered in the viewer's local timezone by the browser.

## Deploying / sharing (Render)

The repo includes a [`render.yaml`](render.yaml) blueprint:

1. Push this repo to GitHub (private is fine).
2. Create a free account at render.com, choose **New + > Blueprint**, and select
   the repo. Render reads `render.yaml` automatically.
3. When prompted, paste your `API_FOOTBALL_KEY`. It's stored as a Render env
   var — never in git (`.env` is git-ignored).
4. Deploy. Your app gets a permanent `https://usa-fc-*.onrender.com` URL to share.

Notes:
- The **free tier sleeps after ~15 min idle**; the next visitor waits ~a minute
  while it wakes and re-warms caches. Render's paid Starter tier stays always-on.
- Anyone with the URL consumes your API-Football daily quota (7,500 req/day on
  Pro). Caching keeps per-visitor cost near zero, but don't post the URL publicly.
- The server's disk on Render is ephemeral: fine for this app (players.json ships
  in the repo; resolved ids re-save on boot at trivial API cost).

## Development

```bash
npm run dev:server   # terminal 1 — API on :8787
npm run dev:client   # terminal 2 — Vite dev server on :5173, proxies /api
```

## Not in v1

- Browser notifications on tracked-player goals (deliberately skipped).
- Websocket push — polling only, per the caching table above.
