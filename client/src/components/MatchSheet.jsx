import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchMatchDetail } from '../api.js';
import { PlayerLink } from './PlayerProfile.jsx';
import { TeamLink } from './TeamSheet.jsx';

const kickoffFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const matchDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
});
const matchTimeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const EVENT_ICONS = { Goal: '⚽', Card: '🟨' };
function eventIcon(ev) {
  if (ev.type === 'Card') return ev.detail?.includes('Red') ? '🟥' : '🟨';
  // Styled glyph, not the 🔁 emoji — its orange arrows read as a yellow card
  // at event-list size. Emoji can't be recolored, so a text glyph it is.
  if (ev.type === 'subst') return <span className="subst-icon">⇄</span>;
  return EVENT_ICONS[ev.type] || '•';
}

// Who came on and who went off, for one side. The API's substitution in/out
// SLOT ORDER is unreliable (the same trap that once left Pukštas unmarked), so
// direction is never read from the slots — it's resolved against the lineup:
// of the two players named, the one currently on the pitch is going off and the
// one on the bench is coming on. Events are walked in match order, so a player
// subbed on and later subbed off is flagged both ways. When neither player can
// be placed (no ids, a name-only feed), nothing is claimed.
function subsForSide(side, events) {
  const on = new Map(), off = new Map(); // apiId -> minute label
  if (!side) return { on, off };
  const bench = new Set((side.substitutes || []).map((p) => p.apiId).filter(Boolean));
  const onPitch = new Set((side.startXI || []).map((p) => p.apiId).filter(Boolean));
  for (const e of events) {
    if (e.type !== 'subst' || e.team !== side.team) continue;
    const a = e.playerId, b = e.assistId;
    if (!a || !b) continue;
    let offId, onId;
    if (onPitch.has(a) && bench.has(b)) { offId = a; onId = b; }
    else if (onPitch.has(b) && bench.has(a)) { offId = b; onId = a; }
    else continue; // can't place them — say nothing rather than guess
    onPitch.delete(offId); onPitch.add(onId);
    const min = `${e.minute ?? ''}${e.extra ? `+${e.extra}` : ''}`;
    off.set(offId, min); on.set(onId, min);
  }
  return { on, off };
}

function LineupSide({ side, playersById, events }) {
  if (!side) return null;
  const subs = subsForSide(side, events);
  const renderPlayer = (pl) => {
    const tracked = pl.trackedId ? playersById.get(pl.trackedId) : null;
    const onMin = subs.on.get(pl.apiId), offMin = subs.off.get(pl.apiId);
    const label = (
      <>
        <span className="shirt-no">{pl.number ?? '–'}</span>
        <span className="lineup-name">{pl.name}{tracked ? ' 🇺🇸' : ''}</span>
      </>
    );
    return (
      <li key={`${pl.apiId ?? pl.name}`} className={tracked ? 'lineup-player american' : 'lineup-player'}>
        {tracked ? <PlayerLink player={tracked}>{label}</PlayerLink> : label}
        {onMin !== undefined && (
          <span className="sub-arrow on" title={`Subbed on ${onMin}′`} aria-label={`Subbed on ${onMin} minutes`}>▲</span>
        )}
        {offMin !== undefined && (
          <span className="sub-arrow off" title={`Subbed off ${offMin}′`} aria-label={`Subbed off ${offMin} minutes`}>▼</span>
        )}
      </li>
    );
  };
  return (
    <div className="lineup-col">
      <h5>{side.team}{side.formation ? ` · ${side.formation}` : ''}</h5>
      {side.coach && <p className="coach">{side.coach}</p>}
      <ul>{side.startXI.map(renderPlayer)}</ul>
      {side.substitutes?.length > 0 && (
        <>
          <h6>Bench</h6>
          <ul className="bench">{side.substitutes.map(renderPlayer)}</ul>
        </>
      )}
    </div>
  );
}

/* ---------- Per-American match stat line ---------- */
// Only players who actually took the pitch: started, came off the bench, or
// (cup ties with no lineups) featured on the evidence of an event.
const ROLE_LABEL = { start: 'Started', on: 'Off the bench', played: 'Featured' };

// Minutes for this match: the stat line when there is one (a null count on a
// line that exists really is 0), else whatever the fixture knew. null means
// genuinely unknown — no stat line at all — not zero.
function minutesOf(tp, st) {
  return st ? (st.minutes ?? 0) : (tp.minutes ?? null);
}

// Same twelve tiles as the profile sheet's "This season", for this match only.
// Inside an API-Football player stat line a zero comes back as null, so an
// absent count on a line that exists is shown as 0; with no stat line at all
// (lower-division ties return events and nothing else) nothing is claimed.
function matchStatTiles(tp, st) {
  const z = (v) => (st ? (v ?? 0) : null);
  const tackles = z(st?.tackles), intercepts = z(st?.interceptions), blocks = z(st?.blocks);
  // In /fixtures payloads passes.accuracy is the COUNT of accurate passes
  // ("39" of 43), not a percentage as in season stats — derive the percentage.
  const passPct = st?.passes > 0 && st.passesAccurate != null
    ? `${Math.round((100 * st.passesAccurate) / st.passes)}%` : null;
  return [
    ['Minutes', minutesOf(tp, st)],
    ['Goals', st ? (st.goals ?? 0) : (tp.goals?.length ?? null)],
    ['Assists', st ? (st.assists ?? 0) : (tp.assists?.length ?? null)],
    ['Tackles', tackles], ['Intercepts', intercepts], ['Blocks', blocks],
    ['Def. actions', st ? tackles + intercepts + blocks : null],
    // Chances created — the stat that says a player was involved when he
    // didn't score or assist. (Touches would sit here, but API-Football's
    // fixture player stats carry no touches field at all.)
    ['Key passes', z(st?.keyPasses)],
    ['Passes', z(st?.passes)], ['Pass %', passPct],
    ['Yellows', z(st?.yellow)], ['Reds', z(st?.red)],
  ];
}

function AmericanStats({ detail, playersById }) {
  // Most minutes first (user request), ties broken alphabetically on the
  // displayed name. A player whose minutes are unknown (no stat line) sinks to
  // the bottom rather than sorting as if he'd played zero.
  const played = (detail?.trackedPlayers || [])
    .filter((tp) => ROLE_LABEL[tp.squadStatus])
    .map((tp) => ({ tp, st: detail.trackedStats?.[tp.playerId] || null }))
    .sort((x, y) => {
      const mx = minutesOf(x.tp, x.st), my = minutesOf(y.tp, y.st);
      if (mx !== my) {
        if (mx == null) return 1;
        if (my == null) return -1;
        return my - mx;
      }
      return x.tp.name.localeCompare(y.tp.name);
    });
  if (played.length === 0) return null;
  return (
    <section className="p-section">
      <h4 className="profile-h">American stats</h4>
      {played.map(({ tp, st }) => {
        const tracked = playersById.get(tp.playerId);
        return (
          <div key={tp.playerId} className="player-stat-block">
            <p className="player-stat-name">
              {tracked ? <PlayerLink player={tracked}>{tp.name}</PlayerLink> : tp.name}
              <span className="role">{ROLE_LABEL[tp.squadStatus]}</span>
            </p>
            <div className="stat-tiles">
              {matchStatTiles(tp, st).map(([k, v]) => (
                <div key={k} className="stat-tile">
                  <span className="val">{v ?? '—'}</span>
                  <span className="lab">{k}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

const STAT_ORDER = [
  'Ball Possession', 'Total Shots', 'Shots on Goal', 'expected_goals',
  'Corner Kicks', 'Fouls', 'Yellow Cards', 'Red Cards', 'Offsides', 'Total passes',
];
const STAT_LABELS = { expected_goals: 'Expected goals (xG)', 'Total passes': 'Passes' };

export default function MatchSheet({ match, playersById, onClose }) {
  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDetail(null); setFailed(false);
    fetchMatchDetail(match.id).then(setDetail).catch(() => setFailed(true));
  }, [match.id]);

  const m = detail || match;

  // While the match is live, re-pull detail each minute so the open sheet keeps
  // up with the game. The server refreshes live details on its own shared timer,
  // so these polls are cache reads — no extra upstream calls per viewer.
  const isLive = m.status === 'live';
  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => {
      fetchMatchDetail(match.id, { fresh: true }).then(setDetail).catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, [isLive, match.id]);
  const kickoff = new Date(m.kickoff);
  // Most recent event first (the API delivers them in match order).
  const events = (detail?.events || [])
    .filter((e) => ['Goal', 'Card', 'subst'].includes(e.type))
    .reverse();

  let statRows = [];
  if (detail?.stats?.length === 2) {
    const homeStats = detail.stats.find((s) => s.team === m.home) || detail.stats[0];
    const awayStats = detail.stats.find((s) => s !== homeStats);
    statRows = STAT_ORDER.map((type) => {
      const h = homeStats.items.find((x) => x.type === type);
      const a = awayStats.items.find((x) => x.type === type);
      if (!h && !a) return null;
      return { label: STAT_LABELS[type] || type, home: h?.value ?? '–', away: a?.value ?? '–' };
    }).filter(Boolean);
  }

  const ticketUrl = 'https://www.google.com/search?q=' +
    encodeURIComponent(`${m.home} vs ${m.away} ${kickoff.toLocaleDateString()} tickets`);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="match-hero">
          <div className="sheet-header">
            <div>
              <h3>{m.competition}</h3>
              <p className="sheet-sub">
                {m.status === 'live' ? `${m.minute}′ LIVE` : m.status === 'finished' ? 'Full time' : kickoffFmt.format(kickoff)}
              </p>
            </div>
            <button className="close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="score-block">
            <span className="team-name"><TeamLink id={m.homeId} name={m.home} /></span>
            <span className={m.status === 'live' ? 'big-score live' : 'big-score'}>
              {m.status === 'scheduled' ? 'vs' : `${m.homeScore} – ${m.awayScore}`}
            </span>
            <span className="team-name"><TeamLink id={m.awayId} name={m.away} /></span>
          </div>
        </div>

        <section className="p-section">
        <h4 className="profile-h">Match info</h4>
        <div className="match-meta">
          <div>📅 {matchDateFmt.format(kickoff)} · {matchTimeFmt.format(kickoff)}</div>
          {detail?.venue && (
            <div>
              📍 {[detail.venue.name, detail.venue.city, detail.venue.country].filter(Boolean).join(', ')}
            </div>
          )}
          {detail?.referee && <div>🧑‍⚖️ {detail.referee}</div>}
          {m.streaming?.service && <div>📺 {m.streaming.service}</div>}
          {m.status === 'scheduled' && (
            <div><a className="ticket-link" href={ticketUrl} target="_blank" rel="noreferrer">🎟 Find tickets</a></div>
          )}
        </div>
        </section>

        {!detail && !failed && <p className="empty">Loading match details…</p>}
        {failed && <p className="empty">Couldn’t load match details right now.</p>}
        {detail?.demo && <p className="empty">Demo mode — lineups and match stats need an API key.</p>}

        <AmericanStats detail={detail} playersById={playersById} />

        {events.length > 0 && (
          <section className="p-section">
            <h4 className="profile-h">Events</h4>
            <ul className="event-list">
              {events.map((e, i) => (
                <li key={i} className={e.trackedId ? 'american' : ''}>
                  <span className="event-min">{e.minute}{e.extra ? `+${e.extra}` : ''}′</span>
                  {eventIcon(e)} {e.player}{e.trackedId ? ' 🇺🇸' : ''}
                  {e.type === 'Goal' && e.assist && (
                    <span className={e.assistTrackedId ? 'event-sub american' : 'event-sub'}>
                      {' '}(assist: {e.assist}{e.assistTrackedId ? ' 🇺🇸' : ''})
                    </span>
                  )}
                  {e.type === 'subst' && e.assist && (
                    <span className={e.assistTrackedId ? 'event-sub american' : 'event-sub'}>
                      {' '}⇄ {e.assist}{e.assistTrackedId ? ' 🇺🇸' : ''}
                    </span>
                  )}
                  <span className="event-team"> — {e.team}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail?.lineups ? (
          <section className="p-section">
            <h4 className="profile-h">Lineups</h4>
            <div className="lineups">
              {/* Match order, NOT the reversed display list above — sub
                  direction is worked out by replaying the match. */}
              <LineupSide side={detail.lineups.home} playersById={playersById} events={detail.events || []} />
              <LineupSide side={detail.lineups.away} playersById={playersById} events={detail.events || []} />
            </div>
          </section>
        ) : detail && !detail.demo && m.status === 'scheduled' ? (
          <p className="empty">Lineups not announced yet — usually ~1 hour before kickoff.</p>
        ) : null}

        {statRows.length > 0 && (
          <section className="p-section">
            <h4 className="profile-h">Match stats</h4>
            <table className="match-stats">
              <tbody>
                {statRows.map((r) => (
                  <tr key={r.label}>
                    <td className="num">{r.home}</td>
                    <td className="stat-label">{r.label}</td>
                    <td className="num">{r.away}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>,
    document.body
  );
}
