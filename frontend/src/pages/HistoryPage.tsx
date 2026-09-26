import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ChatMessage, Incident, IncidentEvent, MapMarker, Participant } from '@cockpit/protocol';
import { ApiError, apiFetch } from '../api/client';
import { TESTIDS } from '../testids';

interface HistoryPayload {
  incident: Incident;
  participants: Participant[];
  events: IncidentEvent[];
  chat: ChatMessage[];
  markers: MapMarker[];
}

function clock(at: number): string {
  return new Date(at).toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const EVENT_ICON: Partial<Record<IncidentEvent['type'], string>> = {
  'incident-created': '🚨',
  'incident-ended': '🏁',
  'participant-joined': '➕',
  'participant-left': '➖',
  'participant-connected': '🟢',
  'participant-disconnected': '🔴',
  'command-sent': '🎮',
  alert: '⚠️',
  chat: '💬',
  marker: '📍',
  'location-update': '📡',
  'video-state': '🎥',
};

/** Read-only review of a closed (or running) incident. */
export function HistoryPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<HistoryPayload>(`/api/incidents/${id}/history`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'could not load the history'));
  }, [id]);

  if (error) {
    return (
      <div className="page" data-testid={TESTIDS.historyPage}>
        <p className="error-text" role="alert">{error}</p>
        <Link to="/incidents" className="ghost-link">← All incidents</Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page" data-testid={TESTIDS.historyPage}>
        <p className="muted">Loading history…</p>
      </div>
    );
  }

  const { incident, participants, events, chat, markers } = data;
  const ended = incident.status === 'ended';

  return (
    <div className="page" data-testid={TESTIDS.historyPage}>
      <div className="history-header">
        <h1>{incident.title}</h1>
        <span className={`pill pill-${incident.status}`} data-status={incident.status}>
          {incident.status}
        </span>
        {!ended && <Link className="ghost-link" to={`/incident/${incident.id}`}>Open live dashboard →</Link>}
      </div>
      <p className="muted">
        {incident.kind} · started {clock(incident.createdAt)} by {incident.createdByName}
        {incident.endedAt ? ` · ended ${clock(incident.endedAt)}` : ''}
      </p>
      {ended && (
        <p className="muted" data-testid={TESTIDS.historyReadOnly}>
          🔒 This history is read-only.
        </p>
      )}

      <div className="history-grid">
        <section className="panel history-events-panel">
          <h2>Timeline</h2>
          <ul className="history-events" data-testid={TESTIDS.historyEvents}>
            {events.map((e) => (
              <li key={e.id} data-testid={TESTIDS.historyEvent(e.id)} data-event-type={e.type}>
                <span className="history-time">{clock(e.at)}</span>
                <span className="history-icon">{EVENT_ICON[e.type] ?? '•'}</span>
                <span>{e.summary}</span>
              </li>
            ))}
            {events.length === 0 && <li className="muted">No activity recorded.</li>}
          </ul>
        </section>

        <div className="history-side">
          <section className="panel">
            <h2>Responders</h2>
            <ul className="participant-list">
              {participants.map((p) => (
                <li key={p.id} className="participant-row">
                  <div className="participant-line">
                    <span className="participant-name">{p.name}{p.role === 'commander' ? ' · commander' : ''}</span>
                    <span className="muted">
                      joined {clock(p.joinedAt)}
                      {p.leftAt ? ` · left ${clock(p.leftAt)}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Chat log</h2>
            <ul className="history-chat" data-testid={TESTIDS.historyChat}>
              {chat.map((m) => (
                <li key={m.id}>
                  <strong>{m.authorName}</strong> <span className="muted">{clock(m.createdAt)}</span>
                  <div>{m.text}</div>
                </li>
              ))}
              {chat.length === 0 && <li className="muted">No messages.</li>}
            </ul>
          </section>

          <section className="panel">
            <h2>Map observations</h2>
            <ul className="marker-list" data-testid={TESTIDS.historyMarkers}>
              {markers.map((m) => (
                <li key={m.id}>
                  <strong>{m.label}</strong> <span className="muted">by {m.authorName} · {clock(m.createdAt)}</span>
                </li>
              ))}
              {markers.length === 0 && <li className="muted">No observations.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
