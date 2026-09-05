require('./src/env');
const express = require('express');
const path = require('path');
const rateLimit = require('./src/rateLimit');
const { getPlayers, getMatches, getMeta } = require('./src/service');

const app = express();
app.set('trust proxy', 1); // real client IPs behind cloud proxies (Render, etc.)
app.disable('x-powered-by');
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.get('/api/meta', async (req, res) => {
  try { res.json(await getMeta()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/players', async (req, res) => {
  try { res.json(await getPlayers()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/matches', async (req, res) => {
  try { res.json(await getMatches()); } catch (e) { res.status(502).json({ error: e.message }); }
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
  console.log(`[americans-abroad] data provider: ${require('../server/adapters/providers').name}`);
  // Warm caches so the first page load doesn't wait on throttled upstream calls.
  Promise.allSettled([getPlayers(), getMatches()]).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected');
    console.log(`[warmup] caches primed${failed.length ? ` (${failed.length} failed: ${failed.map((f) => f.reason?.message).join('; ')})` : ''}`);
  });
});
