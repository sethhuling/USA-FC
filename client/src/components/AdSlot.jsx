import React, { useEffect, useRef } from 'react';
import ads from '../../../server/config/ads.json';
import { getSetting } from '../settings.js';

// Ad slot with three states (see server/config/ads.json):
//  - ads disabled + adPreview off (today's default): renders NOTHING at all.
//  - ads disabled + adPreview setting on: a dashed placeholder at the exact
//    reserved height, so placements can be previewed on a real device.
//  - ads enabled with a publisher id + this slot's unit id: a real AdSense
//    <ins>, pushed once per mount. The AdSense loader <script> in index.html
//    must be uncommented at launch (docs/ads-launch-checklist.md).
// The container always carries min-height when it renders, so a filling ad
// never shifts content, and it lives in normal flow (no z-index) so overlay
// sheets always paint above it.
export default function AdSlot({ name }) {
  const live = ads.enabled && ads.client && ads.slots[name];
  const pushed = useRef(false);

  useEffect(() => {
    if (!live || pushed.current) return;
    pushed.current = true; // guard: StrictMode double-mounts must not double-push
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* loader absent */ }
  }, [live]);

  if (live) {
    return (
      <div className="ad-slot" aria-label="Advertisement">
        <ins
          className="adsbygoogle" style={{ display: 'block' }}
          data-ad-client={ads.client} data-ad-slot={ads.slots[name]}
          data-ad-format="auto" data-full-width-responsive="true"
        />
      </div>
    );
  }
  if (getSetting('adPreview')) {
    return (
      <div className="ad-slot placeholder">
        <span className="ad-kicker">Advertisement</span>
        <span className="ad-name">{name}</span>
      </div>
    );
  }
  return null;
}
