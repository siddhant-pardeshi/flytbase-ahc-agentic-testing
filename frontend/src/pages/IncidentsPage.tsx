import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Incident } from '@cockpit/protocol';
import { ApiError, apiFetch } from '../api/client';
import { useIncidentStore } from '../store/incident.store';
import { TESTIDS } from '../testids';

const KINDS = ['fire', 'security', 'missing-person', 'infrastructure', 'storm', 'general'] as const;

interface CreateResponse {
  incident: Incident;
  joinToken: string;
}

function duration(from: number, to: number | null): string {
  const end = to ?? Date.now();
  const s = Math.max(0, Math.floor((end - from) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function IncidentsPage() {
  const navigate = useNavigate();
  const resetIncident = useIncidentStore((s) => s.reset);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('fire');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    resetIncident();
    const load = (): void => {
      apiFetch<{ incidents: Incident[] }>('/api/incidents')
        .then((r) => setIncidents(r.incidents))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 3000);
    const tick = setInterval(() => force((n) => n + 1), 1000);
    return () => {
      clearInterval(t);
      clearInterval(tick);
    };
  }, [resetIncident]);

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<CreateResponse>('/api/incidents', { method: 'POST', body: { title, kind } });
      navigate(`/incident/${res.incident.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not create the incident');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (incident: Incident): Promise<void> => {
    try {
      const { token } = await apiFetch<{ token: string }>(`/api/incidents/${incident.id}/join-link`);
      const link = `${window.location.origin}/join/${token}`;
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        window.prompt('Copy the joining link', link);
      }
    } catch {
      setError('could not fetch the joining link');
    }
  };

  return (
    <div className="page" data-testid={TESTIDS.incidentsPage}>
      <h1>Incidents</h1>
      <p className="muted">One shared view for everyone responding. Start an incident or re-open a past one.</p>

      <form className="panel create-row" onSubmit={create}>
        <label className="field grow">
          <span>What is happening?</span>
          <input
            placeholder="e.g. Warehouse fire — north industrial site"
            value={title}
            data-testid={TESTIDS.incidentTitleInput}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={kind} data-testid={TESTIDS.incidentKindSelect} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary" disabled={busy || !title.trim()} data-testid={TESTIDS.incidentCreateSubmit}>
          Start incident
        </button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}

      <ul className="incident-list">
        {incidents.map((incident) => (
          <li key={incident.id} className="panel incident-row" data-testid={TESTIDS.incidentRow(incident.id)}>
            <div className="incident-main">
              <Link className="incident-title" to={`/incident/${incident.id}`} data-testid={TESTIDS.incidentOpen(incident.id)}>
                {incident.title}
              </Link>
              <span className="muted">
                {incident.kind} · started by {incident.createdByName} · {duration(incident.createdAt, incident.endedAt)}
              </span>
            </div>
            <div className="incident-actions">
              <span className={`pill pill-${incident.status}`} data-status={incident.status}>
                {incident.status}
              </span>
              <button
                type="button"
                data-testid={TESTIDS.incidentCopyLink(incident.id)}
                onClick={() => void copyLink(incident)}
                title={`Joining link: ${window.location.origin}/join/${incident.id}`}
              >
                Copy join link
              </button>
              <Link className="ghost-link" data-testid={TESTIDS.incidentHistoryLink(incident.id)} to={`/history/${incident.id}`}>
                History
              </Link>
            </div>
          </li>
        ))}
        {incidents.length === 0 && <li className="muted panel">No incidents yet — start the first one.</li>}
      </ul>
    </div>
  );
}
