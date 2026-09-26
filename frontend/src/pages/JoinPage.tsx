import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Incident } from '@cockpit/protocol';
import { ApiError, apiFetch } from '../api/client';
import { useSession } from '../auth/session';
import { TESTIDS } from '../testids';

/** Landing page for a joining link: shows what you are joining, then joins in one click. */
export function JoinPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ incident: Incident }>(`/api/join/${token}`)
      .then((r) => setIncident(r.incident))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'this joining link is not valid'));
  }, [token]);

  const join = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { incident: resolved } = await apiFetch<{ incident: Incident }>(`/api/join/${token}`);
      await apiFetch(`/api/incidents/${resolved.id}/join`, { method: 'POST', body: {} });
      navigate(`/incident/${resolved.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'could not join');
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap" data-testid={TESTIDS.joinPage}>
      <div className="panel auth-card">
        <h1>Join incident</h1>
        {error && (
          <p className="error-text" data-testid={TESTIDS.joinError} role="alert">
            {error}
          </p>
        )}
        {incident && (
          <>
            <p className="join-title" data-testid={TESTIDS.joinTitle}>
              {incident.title}
            </p>
            <p className="muted">
              {incident.kind} · started by {incident.createdByName} ·{' '}
              <span className={`pill pill-${incident.status}`}>{incident.status}</span>
            </p>
            <p className="muted">You will join as {user?.name ?? 'a responder'}.</p>
            {incident.status === 'ended' ? (
              <p className="error-text">This incident has ended — the history is read-only.</p>
            ) : (
              <button type="button" className="primary" disabled={busy} data-testid={TESTIDS.joinConfirm} onClick={() => void join()}>
                Join incident
              </button>
            )}
          </>
        )}
        {!incident && !error && <p className="muted">Checking the link…</p>}
      </div>
    </div>
  );
}
