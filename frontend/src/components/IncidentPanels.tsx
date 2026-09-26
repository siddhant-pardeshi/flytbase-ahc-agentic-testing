import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ChatMessage, Incident, MapMarker, Participant } from '@cockpit/protocol';
import { ApiError, apiFetch } from '../api/client';
import { useSession } from '../auth/session';
import { computeFreshness, freshnessLabel, useNow } from '../hooks/freshness';
import { useIncidentStore } from '../store/incident.store';
import { useTelemetryStore } from '../store/telemetry.store';
import { TESTIDS } from '../testids';

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDuration(from: number, to: number | null, now: number): string {
  const end = to ?? now;
  const s = Math.max(0, Math.floor((end - from) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Live / delayed / stale / disconnected badge for one device's data. */
export function FreshnessBadge({ deviceId }: { deviceId: string }) {
  const heartbeat = useTelemetryStore((s) => s.data[deviceId]?.heartbeat);
  const now = useNow();
  const freshness = computeFreshness(deviceId, heartbeat?.device_heartbeat_timestamp, heartbeat?.connected, now);
  return (
    <span className={`pill pill-fresh-${freshness}`} data-testid={TESTIDS.freshness(deviceId)} data-freshness={freshness}>
      {freshnessLabel(freshness)}
    </span>
  );
}

export function IncidentHeader({ incident, participant }: { incident: Incident; participant: Participant | null }) {
  const now = useNow();
  const [joinLink, setJoinLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCommander = participant?.role === 'commander' && incident.status === 'active';

  useEffect(() => {
    if (!incident || incident.status !== 'active') return;
    apiFetch<{ token: string }>(`/api/incidents/${incident.id}/join-link`)
      .then((r) => setJoinLink(`${window.location.origin}/join/${r.token}`))
      .catch(() => undefined);
  }, [incident]);

  const copy = async (): Promise<void> => {
    if (!joinLink) return;
    try {
      await navigator.clipboard.writeText(joinLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy the joining link', joinLink);
    }
  };

  const end = async (): Promise<void> => {
    if (!window.confirm('End this incident? The dashboard becomes read-only history.')) return;
    try {
      await apiFetch(`/api/incidents/${incident.id}/end`, { method: 'POST', body: {} });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'could not end the incident');
    }
  };

  return (
    <div className="incident-header" data-testid="incident-header">
      <div className="incident-header-main">
        <h1 data-testid={TESTIDS.incidentTitle}>{incident.title}</h1>
        <span className={`pill pill-${incident.status}`} data-testid={TESTIDS.incidentStatus} data-status={incident.status}>
          {incident.status}
        </span>
        <span className="muted" data-testid={TESTIDS.incidentDuration}>
          {formatDuration(incident.createdAt, incident.endedAt, now)}
        </span>
        {incident.status === 'ended' && (
          <Link className="ghost-link" to={`/history/${incident.id}`}>
            Open history →
          </Link>
        )}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="incident-header-actions">
        {incident.status === 'active' && (
          <>
            <input
              readOnly
              className="join-link-input"
              value={joinLink}
              placeholder="joining link…"
              data-testid={TESTIDS.joinLinkValue}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" onClick={() => void copy()} data-testid={TESTIDS.copyJoinLink}>
              {copied ? 'Copied ✓' : 'Copy join link'}
            </button>
            {isCommander && (
              <button type="button" className="danger" onClick={() => void end()} data-testid={TESTIDS.endIncident}>
                End incident
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ParticipantsPanel({ participants }: { participants: Participant[] }) {
  const frames = useIncidentStore((s) => s.frames);
  const now = useNow(2000);

  return (
    <section className="panel" data-testid={TESTIDS.participantsList}>
      <h2>
        Responders <span className="muted">({participants.filter((p) => !p.leftAt).length} on)</span>
      </h2>
      <ul className="participant-list">
        {participants.map((p) => {
          const frame = p.videoOn && frames[p.id] && now - frames[p.id].at < 6000 ? frames[p.id] : undefined;
          const presence = p.leftAt ? 'left' : p.connected ? 'connected' : 'disconnected';
          return (
            <li key={p.id} className="participant-row" data-testid={TESTIDS.participantRow(p.id)}>
              <div className="participant-line">
                <span className={`presence-dot presence-${presence}`} data-testid={TESTIDS.participantPresence(p.id)} data-presence={presence} title={presence} />
                <span className="participant-name">
                  {p.name}
                  {p.role === 'commander' ? ' · commander' : ''}
                </span>
                <span className={`pill pill-presence-${presence}`}>{presence}</span>
              </div>
              {p.location && !p.leftAt && (
                <div className="participant-geo muted" data-testid={TESTIDS.participantLocation(p.id)}>
                  @ {p.location.latitude.toFixed(5)}, {p.location.longitude.toFixed(5)}
                </div>
              )}
              {frame && (
                <img
                  className="participant-video"
                  src={frame.dataUrl}
                  alt={`${p.name} video`}
                  data-testid={TESTIDS.participantVideo(p.id)}
                />
              )}
            </li>
          );
        })}
        {participants.length === 0 && <li className="muted">Nobody has joined yet.</li>}
      </ul>
    </section>
  );
}

export function ChatPanel({ incidentId, active }: { incidentId: string; active: boolean }) {
  const user = useSession((s) => s.user);
  const chat = useIncidentStore((s) => s.chat);
  const participants = useIncidentStore((s) => s.participants);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => [...chat].sort((a, b) => a.createdAt - b.createdAt), [chat]);
  const byId = useMemo(() => new Map(chat.map((m) => [m.id, m])), [chat]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [sorted.length]);

  const send = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setError(null);
    try {
      await apiFetch(`/api/incidents/${incidentId}/chat`, {
        method: 'POST',
        body: { text: value, replyToId: replyTo?.id ?? null },
      });
      setText('');
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not send');
    }
  };

  const mentionsMe = (m: ChatMessage): boolean =>
    !!user?.name && new RegExp(`@${user.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(m.text);

  return (
    <section className="panel chat-panel" data-testid={TESTIDS.chatPanel}>
      <h2>Chat</h2>
      <div className="chat-messages" ref={listRef} data-testid={TESTIDS.chatMessages}>
        {sorted.map((m) => (
          <div
            key={m.id}
            className={`chat-message ${m.participantId && user?.name && m.authorName === user.name ? 'mine' : ''} ${mentionsMe(m) ? 'mentions-me' : ''}`}
            data-testid={TESTIDS.chatMessage(m.id)}
          >
            <div className="chat-meta">
              <strong>{m.authorName}</strong>
              <span className="muted">{formatClock(m.createdAt)}</span>
              {active && (
                <button type="button" className="linkish" data-testid={TESTIDS.chatReply(m.id)} onClick={() => setReplyTo(m)}>
                  reply
                </button>
              )}
            </div>
            {m.replyToId && byId.get(m.replyToId) && (
              <blockquote className="chat-quote">↩ {byId.get(m.replyToId)!.authorName}: {byId.get(m.replyToId)!.text}</blockquote>
            )}
            <div className="chat-text">{m.text}</div>
          </div>
        ))}
        {sorted.length === 0 && <p className="muted">No messages yet. Keep everyone posted.</p>}
      </div>
      {active ? (
        <form className="chat-form" onSubmit={send}>
          {replyTo && (
            <div className="chat-reply-preview" data-testid={TESTIDS.chatReplyPreview}>
              replying to {replyTo.authorName}: {replyTo.text.slice(0, 60)}
              <button type="button" className="linkish" onClick={() => setReplyTo(null)}>
                cancel
              </button>
            </div>
          )}
          <input
            placeholder="Message the team… use @name to mention"
            value={text}
            data-testid={TESTIDS.chatInput}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="primary" disabled={!text.trim()} data-testid={TESTIDS.chatSend}>
            Send
          </button>
        </form>
      ) : (
        <p className="muted">The incident has ended — chat is read-only.</p>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}

export function ObservationsPanel({
  incidentId,
  active,
  myLocation,
}: {
  incidentId: string;
  active: boolean;
  myLocation: { latitude: number; longitude: number } | null;
}) {
  const markers = useIncidentStore((s) => s.markers);
  const [label, setLabel] = useState('');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => [...markers].sort((a, b) => b.createdAt - a.createdAt), [markers]);

  const useMyLocation = (): void => {
    setError(null);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => {
          // Fall back to the location already shared with the team, if any.
          if (myLocation) {
            setCoords(myLocation);
            return;
          }
          setError('location unavailable — allow location access or share your location first');
        },
        { timeout: 10000 },
      );
      return;
    }
    if (myLocation) {
      setCoords(myLocation);
      return;
    }
    setError('this browser has no location');
  };

  const add = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!coords || !label.trim()) return;
    setError(null);
    try {
      await apiFetch(`/api/incidents/${incidentId}/markers`, {
        method: 'POST',
        body: { label: label.trim(), latitude: coords.latitude, longitude: coords.longitude },
      });
      setLabel('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not add the observation');
    }
  };

  return (
    <section className="panel" data-testid={TESTIDS.markersList}>
      <h2>Map observations</h2>
      {active && (
        <form className="marker-form" onSubmit={add}>
          <input
            placeholder="e.g. Smoke spotted"
            value={label}
            data-testid={TESTIDS.markerLabel}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="button" data-testid={TESTIDS.markerUseMyLocation} onClick={useMyLocation}>
            {coords ? `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}` : 'Use my location'}
          </button>
          <button type="submit" className="primary" disabled={!label.trim() || !coords} data-testid={TESTIDS.markerAdd}>
            Mark
          </button>
        </form>
      )}
      <ul className="marker-list">
        {sorted.map((m: MapMarker) => (
          <li key={m.id} data-testid={TESTIDS.markerRow(m.id)}>
            <strong>{m.label}</strong> <span className="muted">by {m.authorName} · {formatClock(m.createdAt)}</span>
            <span className="muted geo">{m.latitude.toFixed(5)}, {m.longitude.toFixed(5)}</span>
          </li>
        ))}
        {sorted.length === 0 && <li className="muted">No observations yet.</li>}
      </ul>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}

export function CommandBar({ active }: { active: boolean }) {
  const selected = useTelemetryStore((s) => s.selectedDeviceId);
  const flight = useTelemetryStore((s) => (selected ? s.data[selected]?.flight_status?.flight_status : undefined));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (type: 'takeoff' | 'land'): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const { socketClient } = await import('../socket/socket-client');
      const ack = await socketClient.emitWithAck<{ ok: boolean; error?: string }>('command', { deviceId: selected, type });
      if (!ack?.ok) setError(ack?.error ?? 'command rejected');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'command failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="command-bar">
      <button
        type="button"
        data-testid={TESTIDS.commandTakeoff}
        disabled={!active || !selected || busy || flight === 'in_flight' || flight === 'taking_off'}
        onClick={() => void send('takeoff')}
      >
        Take off
      </button>
      <button
        type="button"
        data-testid={TESTIDS.commandLand}
        disabled={!active || !selected || busy || flight === 'standby' || flight === 'landing'}
        onClick={() => void send('land')}
      >
        Land
      </button>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
