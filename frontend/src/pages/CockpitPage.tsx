import { Suspense, lazy, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { DEVICES_TOPIC } from '@cockpit/protocol';
import type { DeviceInfo } from '@cockpit/protocol';
import { apiFetch } from '../api/client';
import { config } from '../config';
import { useDeviceSubscriptions } from '../hooks/useDeviceSubscriptions';
import { socketClient } from '../socket/socket-client';
import { useSession } from '../auth/session';
import { useTelemetryStore } from '../store/telemetry.store';
import { AlertToasts } from '../components/AlertToasts';
import { DeviceList } from '../components/DeviceList';
import { SocketBadge } from '../components/SocketBadge';
import { TelemetryPanel } from '../components/TelemetryPanel';
import { VideoTile } from '../components/VideoTile';
import { TESTIDS } from '../testids';

const CesiumMap = lazy(() => import('../components/CesiumMap').then((m) => ({ default: m.CesiumMap })));

export function CockpitPage() {
  const devices = useTelemetryStore((s) => s.devices);
  const setDevices = useTelemetryStore((s) => s.setDevices);
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.clear);

  useEffect(() => {
    socketClient.connect(config.apiUrl, config.orgId);
    const unsubscribe = socketClient.subscribe(DEVICES_TOPIC, (payload) => {
      if (Array.isArray(payload)) setDevices(payload as DeviceInfo[]);
    });
    apiFetch<{ devices: DeviceInfo[] }>('/api/devices')
      .then((res) => {
        if (useTelemetryStore.getState().devices.length === 0) setDevices(res.devices);
      })
      .catch(() => undefined);
    return () => {
      unsubscribe();
      socketClient.disconnect();
    };
  }, [setDevices]);

  useDeviceSubscriptions(devices, config.orgId);

  return (
    <div className="cockpit">
      <header className="cockpit-top">
        <div className="brand">
          <Link to="/incidents" data-testid={TESTIDS.navIncidents}>FirstResponder</Link>
          <span className="brand-sub">Cockpit</span>
        </div>
        <div className="top-right">
          <SocketBadge />
          <a className="dashboard-link" href={`${config.apiUrl}/dashboard`} target="_blank" rel="noreferrer">
            Control panel →
          </a>
          <span className="user-chip" data-testid={TESTIDS.userChip}>{user?.name}</span>
          <button
            type="button"
            className="linkish"
            data-testid={TESTIDS.signOut}
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
      <aside className="cockpit-left">
        <DeviceList />
        <TelemetryPanel />
      </aside>
      <main className="cockpit-map">
        <Suspense fallback={<div className="map-loading">Loading map…</div>}>
          <CesiumMap />
        </Suspense>
        <VideoTile />
      </main>
      <AlertToasts />
    </div>
  );
}
