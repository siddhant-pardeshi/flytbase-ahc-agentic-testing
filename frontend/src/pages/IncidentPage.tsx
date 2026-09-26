import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DEVICES_TOPIC } from '@cockpit/protocol';
import type { DeviceInfo } from '@cockpit/protocol';
import { Suspense, lazy } from 'react';
import { ApiError, apiFetch } from '../api/client';
import { currentToken, useSession } from '../auth/session';
import { config } from '../config';
import { useDeviceSubscriptions } from '../hooks/useDeviceSubscriptions';
import { socketClient } from '../socket/socket-client';
import { useIncidentStore, type HistoryPayload } from '../store/incident.store';
import { useTelemetryStore } from '../store/telemetry.store';
import { AlertToasts } from '../components/AlertToasts';
import { DeviceList } from '../components/DeviceList';
import { SocketBadge } from '../components/SocketBadge';
import { TelemetryPanel } from '../components/TelemetryPanel';
import { VideoTile } from '../components/VideoTile';
import { ChatPanel, CommandBar, FreshnessBadge, IncidentHeader, ObservationsPanel, ParticipantsPanel } from '../components/IncidentPanels';
import { TESTIDS } from '../testids';

const CesiumMap = lazy(() => import('../components/CesiumMap').then((m) => ({ default: m.CesiumMap })));

export function IncidentPage() {
  const { id = '' } = useParams();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.clear);

  const incident = useIncidentStore((s) => s.incident);
  const participants = useIncidentStore((s) => s.participants);
  const applyState = useIncidentStore((s) => s.applyState);
  const applyChat = useIncidentStore((s) => s.applyChat);
  const applyMarker = useIncidentStore((s) => s.applyMarker);
  const applyEvent = useIncidentStore((s) => s.applyEvent);
  const applyFrame = useIncidentStore((s) => s.applyFrame);

  const devices = useTelemetryStore((s) => s.devices);
  const setDevices = useTelemetryStore((s) => s.setDevices);
  const selectedDeviceId = useTelemetryStore((s) => s.selectedDeviceId);

  const [participantId, setParticipantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareLocation, setShareLocation] = useState(false);
  const [shareVideo, setShareVideo] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastLocationSent = useRef(0);

  const active = incident?.status === 'active';
  const me = participants.find((p) => p.id === participantId) ?? null;

  // Join (idempotent), then load history to seed the dashboard.
  useEffect(() => {
    let cancelled = false;
    useIncidentStore.getState().reset();
    useTelemetryStore.getState().reset();
    (async () => {
      try {
        const join = await apiFetch<{ participant: { id: string } }>(`/api/incidents/${id}/join`, {
          method: 'POST',
          body: {},
        });
        const history = await apiFetch<HistoryPayload>(`/api/incidents/${id}/history`);
        if (cancelled) return;
        useIncidentStore.getState().seedHistory(history);
        setParticipantId(join.participant.id);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'could not open this incident');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Devices + telemetry subscriptions, same shape as the cockpit.
  useEffect(() => {
    if (!participantId) return;
    socketClient.connect(config.apiUrl, config.orgId, {
      'session-token': currentToken() ?? '',
      'incident-id': id,
      'participant-id': participantId,
    });
    const unsubs = [
      socketClient.subscribe(`incident/${id}/state`, (payload) => applyState(payload as never)),
      socketClient.subscribe(`incident/${id}/chat`, (payload) => applyChat(payload as never)),
      socketClient.subscribe(`incident/${id}/markers`, (payload) => applyMarker(payload as never)),
      socketClient.subscribe(`incident/${id}/events`, (payload) => applyEvent(payload as never)),
      socketClient.on('incident-frame', (payload) => {
        const f = payload as { participantId: string; dataUrl: string; at: number };
        applyFrame(f.participantId, f.dataUrl, f.at);
      }),
    ];
    apiFetch<{ devices: DeviceInfo[] }>('/api/devices')
      .then((res) => {
        if (useTelemetryStore.getState().devices.length === 0) setDevices(res.devices);
      })
      .catch(() => undefined);
    const devicesUnsub = socketClient.subscribe(DEVICES_TOPIC, (payload) => {
      if (Array.isArray(payload)) setDevices(payload as DeviceInfo[]);
    });
    // Refresh authoritative state once connected (retained values already cover it).
    apiFetch<{ incident: never; participants: never }>(`/api/incidents/${id}`)
      .then((r) => applyState(r))
      .catch(() => undefined);
    return () => {
      for (const u of unsubs) u();
      devicesUnsub();
      socketClient.disconnect();
    };
  }, [id, participantId, applyState, applyChat, applyMarker, applyEvent, applyFrame, setDevices]);

  useDeviceSubscriptions(devices, config.orgId);

  // Share my location with the team while the toggle is on.
  useEffect(() => {
    if (!shareLocation || !participantId || !navigator.geolocation) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastLocationSent.current < 2000) return;
        lastLocationSent.current = now;
        void apiFetch(`/api/incidents/${id}/location`, {
          method: 'POST',
          body: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        }).catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 },
    );
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    };
  }, [shareLocation, participantId, id]);

  // Share my camera as low-rate frames while the toggle is on.
  useEffect(() => {
    if (!shareVideo || !participantId) return;
    let cancelled = false;
    void apiFetch(`/api/incidents/${id}/video`, { method: 'POST', body: { on: true } }).catch(() => undefined);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          await localVideoRef.current.play().catch(() => undefined);
        }
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const ctx = canvas.getContext('2d');
        frameTimerRef.current = setInterval(() => {
          const video = localVideoRef.current;
          if (!video || !ctx || video.readyState < 2) return;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
          socketClient.emit('incident-frame', { incidentId: id, participantId, dataUrl, at: Date.now() });
        }, 1000);
      } catch {
        setShareVideo(false);
      }
    })();
    return () => {
      cancelled = true;
      if (frameTimerRef.current) clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void apiFetch(`/api/incidents/${id}/video`, { method: 'POST', body: { on: false } }).catch(() => undefined);
    };
  }, [shareVideo, participantId, id]);

  const leave = async (): Promise<void> => {
    try {
      await apiFetch(`/api/incidents/${id}/leave`, { method: 'POST', body: {} });
    } catch {
      // Leaving is best-effort.
    }
    window.location.href = '/incidents';
  };

  if (error) {
    return (
      <div className="page" data-testid={TESTIDS.incidentPage}>
        <h1>Incident</h1>
        <p className="error-text" role="alert">{error}</p>
        <Link to="/incidents" className="ghost-link">← All incidents</Link>
      </div>
    );
  }

  if (!incident || !me) {
    return (
      <div className="page" data-testid={TESTIDS.incidentPage}>
        <p className="muted">Opening the incident…</p>
      </div>
    );
  }

  return (
    <div className="cockpit incident" data-testid={TESTIDS.incidentPage}>
      <header className="cockpit-top">
        <div className="brand">
          <Link to="/incidents" data-testid={TESTIDS.navIncidents}>FirstResponder</Link>
        </div>
        <IncidentHeader incident={incident} participant={me} />
        <div className="top-right">
          <SocketBadge />
          <span className="user-chip" data-testid={TESTIDS.userChip}>{user?.name}</span>
          <button type="button" className="linkish" data-testid={TESTIDS.signOut} onClick={() => { void leave(); }}>
            Leave
          </button>
          <button
            type="button"
            className="linkish"
            data-testid="hard-signout"
            onClick={() => {
              void apiFetch('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
              signOut();
              window.location.href = '/signin';
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {incident.status === 'ended' && (
        <div className="ended-banner" data-testid="incident-ended-banner">
          This incident has ended. The dashboard is read-only —{' '}
          <Link to={`/history/${incident.id}`}>open the full history →</Link>
        </div>
      )}

      <aside className="cockpit-left">
        <ParticipantsPanel participants={participants} />
        <div className="share-row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={shareLocation}
              data-testid={TESTIDS.shareLocationToggle}
              onChange={(e) => setShareLocation(e.target.checked)}
            />
            Share my location
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={shareVideo}
              data-testid={TESTIDS.shareVideoToggle}
              onChange={(e) => setShareVideo(e.target.checked)}
            />
            Share my camera
          </label>
        </div>
        <ObservationsPanel incidentId={id} active={active} myLocation={me.location} />
      </aside>

      <main className="cockpit-map">
        <Suspense fallback={<div className="map-loading">Loading map…</div>}>
          <CesiumMap />
        </Suspense>
        <VideoTile />
        <video ref={localVideoRef} muted playsInline className="local-video" data-testid="local-video" style={{ display: shareVideo ? 'block' : 'none' }} />
      </main>

      <aside className="cockpit-right">
        <DeviceList />
        <div className="freshness-row">
          {selectedDeviceId && <FreshnessBadge deviceId={selectedDeviceId} />}
          <span className="muted small">data freshness of the selected drone</span>
        </div>
        <CommandBar active={active} />
        <TelemetryPanel />
        <ChatPanel incidentId={id} active={active} />
      </aside>

      <AlertToasts />
    </div>
  );
}
