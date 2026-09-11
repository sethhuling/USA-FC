import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchNews } from '../api.js';
import { PlayerLink } from './PlayerProfile.jsx';
import MatchSheet from './MatchSheet.jsx';
// Deployment-level contact address (build-time import, like coverage.json).
import site from '../../../server/config/site.json';

// One list: outside headlines are links OUT to the publisher's own page — we
// show only the headline, the publisher's name and the date (never story text
// or images). Our own Daily Roundup articles (written on the server from match
// data) sit in the same list and open in-app as a full article.

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'abroad', label: 'Americans Abroad' },
  { key: 'usmnt', label: 'USMNT' },
  { key: 'youth', label: 'Youth' },
];

const longDateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
// 'YYYY-MM-DD' at local noon, so the calendar day never shifts with timezone.
const dayDate = (s) => new Date(`${s}T12:00:00`);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Turn tracked players' full names in a paragraph into profile links.
function linkNames(text, ids, playersById) {
  const people = ids.map((id) => playersById.get(id)).filter(Boolean)
    .sort((a, b) => b.name.length - a.name.length);
  if (!people.length) return text;
  const re = new RegExp(`(${people.map((p) => escapeRe(p.name)).join('|')})`, 'g');
  return text.split(re).map((part, i) => {
    const p = people.find((x) => x.name === part);
    return p ? <PlayerLink key={i} player={p}>{part}</PlayerLink> : part;
  });
}

function Headline({ h, playersById }) {
  const tagged = h.players.map((id) => playersById.get(id)).filter(Boolean);
  return (
    <li className="headline">
      <a className="headline-link" href={h.url} target="_blank" rel="noopener">
        {h.title}
      </a>
      <div className="headline-meta">
        <span className="headline-source">{h.source}</span>
        <span>· {shortDateFmt.format(dayDate(h.published))}</span>
        {h.paywall && <span className="paywall-tag">Subscriber</span>}
      </div>
      {tagged.length > 0 && (
        <div className="chips headline-players">
          {tagged.map((p) => (
            <span key={p.id} className="chip"><PlayerLink player={p}>{p.name}</PlayerLink></span>
          ))}
        </div>
      )}
    </li>
  );
}

function RoundupTeaser({ day, onOpen }) {
  return (
    <li className="headline roundup-teaser" onClick={() => onOpen(day)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(day); }}>
      <div className="roundup-kicker">Daily Roundup</div>
      <div className="roundup-title">{day.title}</div>
      {day.dek && <p className="roundup-dek">{day.dek}</p>}
      <div className="headline-meta">
        <span className="headline-source">Uncle Sam FC</span>
        <span>· {shortDateFmt.format(dayDate(day.date))}</span>
        <span className="read-more">Read ›</span>
      </div>
    </li>
  );
}

function RoundupArticle({ day, playersById, onClose, onOpenMatch }) {
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <article className="sheet profile-sheet article-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <div className="roundup-kicker">Daily Roundup · {longDateFmt.format(dayDate(day.date))}</div>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <h2 className="article-title">{day.title}</h2>
        {day.dek && <p className="article-dek">{day.dek}</p>}
        <p className="article-byline">By Uncle Sam FC · Written automatically from match data</p>
        <div className="article-body">
          {day.matches.map((m) => (
            <section key={m.id} className="article-section">
              <h3 className="article-subhead">
                <button className="article-match" onClick={() => onOpenMatch(m)}>
                  {m.home} {m.homeScore}–{m.awayScore} {m.away}
                </button>
                <span className="article-comp">{m.competition}</span>
              </h3>
              <p>{linkNames(m.sentences.join(' '), m.players, playersById)}</p>
            </section>
          ))}
        </div>
      </article>
    </div>,
    document.body,
  );
}

export default function NewsTab({ players }) {
  const [filter, setFilter] = useState('all');
  const [news, setNews] = useState(null);
  const [error, setError] = useState(null);
  const [openDay, setOpenDay] = useState(null);
  const [selectedMatch, setSelectedMatch] = useState(null);

  useEffect(() => {
    fetchNews().then(setNews).catch((e) => setError(e.message));
  }, []);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  // Roundup articles and outside headlines in one date-ordered list. The
  // newest roundup is pinned to the top (it covers yesterday's or today's
  // games, so by date it would sink below this morning's links); on the same
  // date a roundup comes before links.
  const items = useMemo(() => {
    const keep = (cats) => filter === 'all' || cats.includes(filter);
    const roundups = (news?.roundup || []).filter((d) => keep(d.categories))
      .map((d) => ({ kind: 'roundup', date: d.date, key: `roundup-${d.date}`, day: d }));
    const rest = [
      ...roundups.slice(1),
      ...(news?.headlines || []).filter((h) => keep([h.category]))
        .map((h) => ({ kind: 'link', date: h.published, key: h.url, h })),
    ].sort((a, b) => b.date.localeCompare(a.date) ||
      (a.kind === b.kind ? 0 : a.kind === 'roundup' ? -1 : 1));
    return roundups.length ? [roundups[0], ...rest] : rest;
  }, [news, filter]);

  return (
    <div>
      <div className="preset-row" role="group" aria-label="Filter news">
        {FILTERS.map((f) => (
          <button key={f.key} className={filter === f.key ? 'preset active' : 'preset'}
            onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="empty">Couldn’t load the news: {error}</p>}
      {!news && !error && <p className="empty">Loading news…</p>}

      {news && (
        items.length > 0 ? (
          <section>
            <h2>Latest</h2>
            <ul className="headline-list">
              {items.map((it) => (it.kind === 'roundup'
                ? <RoundupTeaser key={it.key} day={it.day} onOpen={setOpenDay} />
                : <Headline key={it.key} h={it.h} playersById={playersById} />))}
            </ul>
          </section>
        ) : <p className="empty">No news here yet — new headlines are added each morning.</p>
      )}

      <footer className="news-footer">
        <p>
          Headlines link to stories on each publisher’s own website. Uncle Sam FC doesn’t
          host, copy, or summarize their articles — all rights belong to the publishers.
          Daily Roundups are written automatically from match data.
        </p>
        <p>
          Uncle Sam FC is an independent fan app, not affiliated with or endorsed by
          U.S. Soccer or any club, league, or publisher.
        </p>
        <p>
          Publisher or rights holder and want a link removed? Email{' '}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
        </p>
      </footer>

      {openDay && (
        <RoundupArticle day={openDay} playersById={playersById}
          onClose={() => setOpenDay(null)} onOpenMatch={setSelectedMatch} />
      )}
      {selectedMatch && (
        <MatchSheet match={selectedMatch} playersById={playersById} onClose={() => setSelectedMatch(null)} />
      )}
    </div>
  );
}
