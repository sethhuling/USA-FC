require('./src/env');
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const rateLimit = require('./src/rateLimit');
const metrics = require('./src/metrics');
const { getPlayers, getMatches, getMeta, getPlayerProfile, getMatchDetail, getLeagues, getTeamOverview } = require('./src/service');

const app = express();
app.set('trust proxy', 1); // real client IPs behind cloud proxies (Render, etc.)
app.disable('x-powered-by');
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

// Admin-only diagnostics. Send the ADMIN_KEY env var as a bearer token:
//   curl -H "Authorization: Bearer $ADMIN_KEY" .../api/admin/stats
// (an x-admin-key header works too). Timing-safe compare; 503 when no key is set.
function adminAuthorized(req) {
  const key = process.env.ADMIN_KEY;
  if (!key) return false;
  const auth = req.headers.authorization || '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : String(req.headers['x-admin-key'] || '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
app.get('/api/admin/stats', (req, res) => {
  if (!process.env.ADMIN_KEY) return res.status(503).json({ error: 'ADMIN_KEY not configured' });
  if (!adminAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
  res.json(metrics.snapshot());
});
// Human-friendly view of the same stats: open /admin, enter the key once.
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.get('/api/meta', async (req, res) => {
  try { res.json(await getMeta()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/players', async (req, res) => {
  try { res.json(await getPlayers()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/matches', async (req, res) => {
  try { res.json(await getMatches()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/leagues', async (req, res) => {
  try { res.json(await getLeagues()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/team/:id', async (req, res) => {
  try {
    const team = await getTeamOverview(Number(req.params.id));
    if (!team) return res.status(404).json({ error: 'unknown team' });
    res.json(team);
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/match/:id', async (req, res) => {
  try {
    const detail = await getMatchDetail(String(req.params.id));
    if (!detail) return res.status(404).json({ error: 'unknown match' });
    res.json(detail);
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// News tab: hand-picked headline links + the daily roundup (src/news.js).
app.get('/api/news', async (req, res) => {
  try { res.json(await require('./src/news').getNews()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/player/:id', async (req, res) => {
  try {
    const profile = await getPlayerProfile(String(req.params.id));
    if (!profile) return res.status(404).json({ error: 'unknown player' });
    res.json(profile);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

const dist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(dist));
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built yet. Run: npm run build');
  });
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`[americans-abroad] listening on http://localhost:${port}`);
  console.log(`[americans-abroad] data provider: ${require('./adapters/providers').name}`);
  // Cache warmer: full warm now, forced re-warm daily and after each match
  // window, so user opens never hit API-Football cold (see src/warm.js).
  require('./src/warm').start();
});
