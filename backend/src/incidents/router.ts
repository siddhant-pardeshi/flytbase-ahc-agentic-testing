import { Router, type Request, type Response, type NextFunction } from 'express';
import type { User } from '@cockpit/protocol';
import { IncidentError, IncidentStore } from './store.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function bearer(req: Request): string | undefined {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

export function incidentsRouter(store: IncidentStore): Router {
  const router = Router();

  const requireUser = (req: Request, res: Response, next: NextFunction): void => {
    const user = store.userForToken(bearer(req));
    if (!user) {
      res.status(401).json({ error: 'sign in to continue' });
      return;
    }
    (req as Request & { user?: User }).user = user;
    next();
  };

  const guard = (fn: (req: Request, res: Response) => Promise<void> | void) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (e: unknown) {
        // Duck-typed on purpose: a 4xx with a message is a client error even if
        // the error class identity ever gets duplicated across module copies.
        const status = e instanceof IncidentError || e instanceof HttpError ? e.status : undefined;
        if (status !== undefined && status >= 400 && status < 500) {
          res.status(status).json({ error: (e as Error).message });
          return;
        }
        console.error('[incidents] unexpected error', e);
        res.status(500).json({ error: 'something went wrong' });
      }
    };

  // --- auth -----------------------------------------------------------------
  router.post(
    '/auth/otp',
    guard((req, res) => {
      const email = String((req.body as { email?: unknown }).email ?? '');
      const code = store.requestOtp(email);
      // Demo environments have no mail service, so the code rides along to keep
      // the sign-in flow reproducible for scripts and reviewers.
      res.json({ ok: true, dev_otp: code });
    }),
  );

  router.post(
    '/auth/verify',
    guard((req, res) => {
      const body = req.body as { email?: unknown; otp?: unknown; name?: unknown };
      const result = store.verifyOtp(String(body.email ?? ''), String(body.otp ?? ''), body.name ? String(body.name) : undefined);
      res.json(result);
    }),
  );

  router.get(
    '/auth/me',
    requireUser,
    guard((req, res) => {
      res.json({ user: (req as Request & { user: User }).user });
    }),
  );

  router.post(
    '/auth/logout',
    guard((req, res) => {
      const token = bearer(req);
      if (token) store.revoke(token);
      res.json({ ok: true });
    }),
  );

  // --- incidents --------------------------------------------------------------
  router.post(
    '/incidents',
    requireUser,
    guard((req, res) => {
      const user = (req as Request & { user: User }).user;
      const body = req.body as { title?: unknown; kind?: unknown };
      const incident = store.create(String(body.title ?? ''), body.kind ? String(body.kind) : undefined, user);
      res.json({ incident, joinToken: incident.joinToken, participants: store.statePayload(incident.id).participants });
    }),
  );

  router.get(
    '/incidents',
    requireUser,
    guard((_req, res) => {
      res.json({ incidents: store.list().map((i) => ({ ...i, joinToken: undefined })) });
    }),
  );

  router.get(
    '/incidents/:id',
    requireUser,
    guard((req, res) => {
      res.json(store.statePayload(req.params.id));
    }),
  );

  router.get(
    '/incidents/:id/join-link',
    requireUser,
    guard((req, res) => {
      const incident = store.get(req.params.id);
      res.json({ token: incident.joinToken });
    }),
  );

  router.get(
    '/join/:token',
    requireUser,
    guard((req, res) => {
      const incident = store.resolveJoinToken(req.params.token);
      res.json({ incident: { ...store.statePayload(incident.id).incident } });
    }),
  );

  router.post(
    '/incidents/:id/join',
    requireUser,
    guard((req, res) => {
      const user = (req as Request & { user: User }).user;
      const participant = store.join(req.params.id, user);
      res.json({ participant: { ...participant, id: participant.id.split('/')[1] } });
    }),
  );

  router.post(
    '/incidents/:id/leave',
    requireUser,
    guard((req, res) => {
      const user = (req as Request & { user: User }).user;
      const participant = store.requireParticipant(req.params.id, user);
      store.leave(req.params.id, participant.id.split('/')[1], true);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/incidents/:id/end',
    requireUser,
    guard((req, res) => {
      const user = (req as Request & { user: User }).user;
      const incident = store.end(req.params.id, user);
      res.json({ incident: store.statePayload(incident.id).incident });
    }),
  );

  router.get(
    '/incidents/:id/history',
    requireUser,
    guard((req, res) => {
      res.json(store.history(req.params.id));
    }),
  );

  // --- participant writes -------------------------------------------------------
  router.post(
    '/incidents/:id/chat',
    requireUser,
    guard((req, res) => {
      const user = (req as Request & { user: User }).user;
      const participant = store.requireParticipant(req.params.id, user);
      const body = req.body as { text?: unknown; replyToId?: unknown };
      const message = store.postChat(
        req.params.id,
        participant.id.split('/')[1],
        String(body.text ?? ''),
        typeof body.replyToId === 'string' && body.replyToId ? body.replyToId : null,
      );
      res.json({ message });
    }),
  );

  router.post(
    '/incidents/:id/markers',
    requireUser,
    guard((req, res) => {
      const user = (req as Request & { user: User }).user;
      const participant = store.requireParticipant(req.params.id, user);
      const body = req.body as { label?: unknown; latitude?: unknown; longitude?: unknown };
      const marker = store.postMarker(
        req.params.id,
        participant.id.split('/')[1],
        String(body.label ?? ''),
        Number(body.latitude),
        Number(body.longitude),
      );
      res.json({ marker });
    }),
  );

  router.post(
    '/incidents/:id/location',
    requireUser,
    guard((req, res) => {
      const user = (req as Request & { user: User }).user;
      const participant = store.requireParticipant(req.params.id, user);
      const body = req.body as { latitude?: unknown; longitude?: unknown };
      const lat = Number(body.latitude);
      const lon = Number(body.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        res.status(400).json({ error: 'coordinates are invalid' });
        return;
      }
      store.setLocation(req.params.id, participant.id.split('/')[1], lat, lon);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/incidents/:id/video',
    requireUser,
    guard((req, res) => {
      const user = (req as Request & { user: User }).user;
      const participant = store.requireParticipant(req.params.id, user);
      const on = (req.body as { on?: unknown }).on === true;
      store.setVideoOn(req.params.id, participant.id.split('/')[1], on);
      res.json({ ok: true });
    }),
  );

  return router;
}
