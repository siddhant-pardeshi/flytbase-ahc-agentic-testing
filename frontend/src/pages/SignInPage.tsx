import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@cockpit/protocol';
import { ApiError, apiFetch } from '../api/client';
import { useSession } from '../auth/session';
import { TESTIDS } from '../testids';

export function SignInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setSession = useSession((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = params.get('next') ?? '/incidents';

  const requestOtp = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await apiFetch('/api/auth/otp', { method: 'POST', body: { email }, anonymous: true });
      setOtpRequested(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'could not send the code');
    } finally {
      setBusy(false);
    }
  };

  const signIn = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await apiFetch<Session>('/api/auth/verify', {
        method: 'POST',
        body: { email, otp, name: name || undefined },
        anonymous: true,
      });
      setSession(session);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap" data-testid={TESTIDS.signinPage}>
      <form className="panel auth-card" onSubmit={signIn}>
        <h1>Sign in to respond</h1>
        <p className="muted">Use your email and a one-time code. No passwords, no installs.</p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            required
            placeholder="you@agency.gov"
            value={email}
            data-testid={TESTIDS.signinEmail}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {!otpRequested ? (
          <button type="button" className="primary" disabled={busy || !email} data-testid={TESTIDS.signinOtpRequest} onClick={() => void requestOtp()}>
            Request code
          </button>
        ) : (
          <>
            <p className="muted hint">Code sent to {email}. It expires in 10 minutes.</p>
            <label className="field">
              <span>One-time code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={otp}
                data-testid={TESTIDS.signinOtp}
                onChange={(e) => setOtp(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Your name</span>
              <input
                placeholder="Shown to other responders"
                value={name}
                data-testid={TESTIDS.signinName}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button type="submit" className="primary" disabled={busy || !otp} data-testid={TESTIDS.signinSubmit}>
              Sign in
            </button>
          </>
        )}

        {error && (
          <p className="error-text" data-testid={TESTIDS.signinError} role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
