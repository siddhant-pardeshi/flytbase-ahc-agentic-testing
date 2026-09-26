import { create } from 'zustand';
import type { Session } from '@cockpit/protocol';

const STORAGE_KEY = 'incident-session';

interface SessionState {
  token: string | null;
  user: { id: string; email: string; name: string } | null;
  restore: () => void;
  setSession: (session: Session) => void;
  clear: () => void;
}

/**
 * Read the stored session synchronously so the very first render already knows
 * who is signed in — restoring in an effect would let the auth guard redirect
 * to /signin a tick before the session appears (a real bug this race once caused).
 */
function stored(): { token: string | null; user: SessionState['user'] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, user: null };
    const parsed = JSON.parse(raw) as Session;
    if (parsed?.token && parsed?.user?.id) return { token: parsed.token, user: parsed.user };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return { token: null, user: null };
}

const initial = stored();

export const useSession = create<SessionState>((set) => ({
  token: initial.token,
  user: initial.user,
  restore() {
    set(stored());
  },
  setSession(session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    set({ token: session.token, user: session.user });
  },
  clear() {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null });
  },
}));

export function currentToken(): string | null {
  return useSession.getState().token;
}
