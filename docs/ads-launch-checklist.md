# Ads: enable-at-launch checklist

The app ships with ad **slots** built in but turned off (`server/config/ads.json`,
`enabled: false` — nothing renders). This is the ordered checklist for turning
real ads on at public launch. Written September 2026.

Preview the placements today on any device: run this in the browser console,
then reload — dashed placeholders appear where ads will go (Schedule after the
4th card, News above the footer, Stats below the leaderboard):

```
localStorage.setItem('unclesamfc-settings', JSON.stringify({ adPreview: true }))
```

## 1. Prerequisites

- [ ] **LLC formed**, then register the DMCA agent under the LLC's name
      (see the tabled item in CLAUDE.md → Known issues; must be done before a
      public launch).
- [x] **Custom domain live** (done Sept 14, 2026): UncleSamFC.com serves the
      app directly via Render Custom Domains (www redirects to the bare
      domain). The onrender.com subdomain stays enabled — the installed PWAs
      live on that origin; don't redirect it to the domain without planning a
      PWA reinstall + push re-subscription.
- [ ] **Lawyer review** of `/privacy` and `/terms` (both are marked as drafts);
      fill in the terms' governing-law placeholder with the LLC's state; update
      both effective dates.

## 2. Apply to AdSense

- [ ] Create the AdSense account with **UncleSamFC.com** (approval on an
      onrender.com subdomain is unlikely — apply with the custom domain).
- [ ] Uncomment the AdSense loader `<script>` in `client/index.html` (marked
      `ADS:`) and put the assigned `ca-pub-…` id in it — AdSense uses this tag
      to verify the site during review. `npm run build`, deploy.
- [ ] Keep `ads.json` `enabled: false` during review (no empty ad boxes).
- [ ] Submit for review and wait (days to a couple of weeks).

## 3. On approval

- [ ] In AdSense, create three **manual display ad units** named after the
      slots: `schedule-inline`, `news-list`, `stats-bottom` (leave Auto ads off
      — placements stay under our control).
- [ ] Edit `server/config/ads.json`: `enabled: true`, `client` = the
      `ca-pub-…` id, and each slot's numeric ad-unit id (a slot left empty
      renders nothing, so units can go live one at a time).
- [ ] Create `client/public/ads.txt` containing exactly one line
      (replace the pub id):
      `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`
      (Vite copies `client/public/` into the build, so it serves at `/ads.txt`
      automatically — deliberately absent until now.)
- [ ] Bump the service-worker cache name in `client/public/sw.js`
      (`unclesamfc-vN`), `npm run build`, deploy.
- [ ] Verify `https://UncleSamFC.com/ads.txt` serves the line.

## 4. Consent (no code needed)

- [ ] AdSense → **Privacy & messaging**: create and publish the **GDPR message**
      (EEA/UK/Switzerland — Google's own certified CMP, delivered by the same
      adsbygoogle script) and the **US states message**. No app changes.

## 5. Privacy policy

- [ ] Rewrite the "Cookies, local storage, and advertising" section of
      `server/privacy.html` into present tense: Google AdSense, its cookies,
      the consent tools above, links to Google's ad policies. Update the
      effective date. Deploy.

## 6. Verify

- [ ] A real ad renders in each slot on the phone; nothing shifts when it loads
      (the slot reserves `min-height: 100px`).
- [ ] Open a player/match/team sheet over each slot — the sheet must cover the
      ad (slots have no z-index; sheets are z-index 100).
- [ ] Ads never appear inside sheets, and short match lists (under 5) show no
      inline ad.
