import { randomBytes, randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  Incident,
  IncidentEvent,
  IncidentEventType,
  IncidentStatePayload,
  MapMarker,
  Participant,
  PublishMessage,
  User,
} from '@cockpit/protocol';
import { topic } from '@cockpit/protocol';

export interface PublishFn {
  (msg: PublishMessage): void;
}

export class IncidentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface StoredIncident extends Incident {
  joinToken: string;
}

interface StoredParticipant extends Participant {}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;

interface PendingOtp {
  code: string;
  expiresAt: number;
}

/**
 * In-memory store for the Live Incident Response product: users, sessions,
 * incidents, participants, chat, markers and the audit timeline. Everything is
 * published to `incident/{id}/...` socket topics so every browser stays in
 * sync without polling.
 */
export class IncidentStore {
  private usersByEmail = new Map<string, User & { name: string }>();
  private otpsByEmail = new Map<string, PendingOtp>();
  private sessionsByToken = new Map<string, { user: User; expiresAt: number }>();
  private incidents = new Map<string, StoredIncident>();
  private participants = new Map<string, StoredParticipant>(); // key `${incidentId}/${participantId}`
  private chat = new Map<string, ChatMessage[]>(); // per incident
  private markers = new Map<string, MapMarker[]>(); // per incident
  private events = new Map<string, IncidentEvent[]>(); // per incident
  private seq = 0;

  constructor(
    private orgId: string,
    private publish: PublishFn,
  ) {}

  private id(prefix: string): string {
    return `${prefix}-${++this.seq}-${randomUUID().slice(0, 8)}`;
  }

  // --- auth ---------------------------------------------------------------

  requestOtp(emailRaw: string): string {
    const email = emailRaw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IncidentError(400, 'enter a valid email');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.otpsByEmail.set(email, { code, expiresAt: Date.now() + OTP_TTL_MS });
    // No mail service in the demo: the code is logged and returned to the caller.
    console.log(`[incidents] OTP for ${email}: ${code}`);
    return code;
  }

  verifyOtp(emailRaw: string, otp: string, nameRaw?: string): { token: string; user: User } {
    const email = emailRaw.trim().toLowerCase();
    const pending = this.otpsByEmail.get(email);
    if (!pending || pending.expiresAt < Date.now()) throw new IncidentError(400, 'request a new code');
    if (pending.code !== String(otp).trim()) throw new IncidentError(401, 'wrong code');
    this.otpsByEmail.delete(email);

    let user = this.usersByEmail.get(email);
    if (!user) {
      const name = nameRaw?.trim() || email.split('@')[0];
      if (!name) throw new IncidentError(400, 'enter your name');
      user = { id: this.id('user'), email, name };
      this.usersByEmail.set(email, user);
    } else if (nameRaw?.trim() && nameRaw.trim() !== user.name) {
      user = { ...user, name: nameRaw.trim() };
      this.usersByEmail.set(email, user);
    }
    const token = randomBytes(24).toString('hex');
    this.sessionsByToken.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS });
    return { token, user };
  }

  userForToken(token: string | undefined | null): User | null {
    if (!token) return null;
    const session = this.sessionsByToken.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessionsByToken.delete(token);
      return null;
    }
    // Return the live user record so a renamed user is reflected everywhere.
    return this.usersByEmail.get(session.user.email) ?? session.user;
  }

  revoke(token: string): void {
    this.sessionsByToken.delete(token);
  }

  // --- incidents ----------------------------------------------------------

  create(titleRaw: string, kindRaw: string | undefined, user: User): StoredIncident {
    const title = titleRaw.trim();
    if (!title) throw new IncidentError(400, 'give the incident a title');
    const incident: StoredIncident = {
      id: this.id('inc'),
      title,
      kind: kindRaw?.trim() || 'general',
      status: 'active',
      createdByUserId: user.id,
      createdByName: user.name,
      createdAt: Date.now(),
      endedAt: null,
      joinToken: randomBytes(12).toString('hex'),
    };
    this.incidents.set(incident.id, incident);
    this.chat.set(incident.id, []);
    this.markers.set(incident.id, []);
    this.events.set(incident.id, []);
    this.addParticipant(incident.id, user, 'commander');
    this.record(incident.id, 'incident-created', user.name, `Incident "${title}" created (${incident.kind})`);
    this.publishState(incident.id);
    return incident;
  }

  list(): StoredIncident[] {
    return [...this.incidents.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(incidentId: string): StoredIncident {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new IncidentError(404, 'incident not found');
    return incident;
  }

  resolveJoinToken(token: string): StoredIncident {
    const incident = [...this.incidents.values()].find((i) => i.joinToken === token);
    if (!incident) throw new IncidentError(404, 'this joining link is not valid');
    return incident;
  }

  statePayload(incidentId: string): IncidentStatePayload {
    const incident = this.get(incidentId);
    return { incident: this.publicIncident(incident), participants: this.participantsFor(incidentId) };
  }

  private publicIncident(incident: StoredIncident): Incident {
    const { joinToken: _joinToken, ...rest } = incident;
    return rest;
  }

  // --- participants -------------------------------------------------------

  private pkey(incidentId: string, participantId: string): string {
    return `${incidentId}/${participantId}`;
  }

  private participantsFor(incidentId: string): StoredParticipant[] {
    return [...this.participants.values()]
      .filter((p) => p.id.startsWith(`${incidentId}/`))
      .map((p) => ({ ...p, id: p.id.split('/')[1] }))
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }

  /** Real stored key is `incidentId/participantId`; payloads carry the bare id. */
  private addParticipant(incidentId: string, user: User, role: Participant['role']): StoredParticipant {
    const existing = [...this.participants.values()].find(
      (p) => p.id.startsWith(`${incidentId}/`) && p.userId === user.id,
    );
    if (existing) {
      existing.leftAt = null;
      existing.lastSeenAt = Date.now();
      this.publishState(incidentId);
      return existing;
    }
    const participant: StoredParticipant = {
      id: `${incidentId}/${this.id('part')}`,
      userId: user.id,
      name: user.name,
      role,
      joinedAt: Date.now(),
      leftAt: null,
      connected: false,
      lastSeenAt: Date.now(),
      location: null,
      locationUpdatedAt: null,
      videoOn: false,
    };
    this.participants.set(participant.id, participant);
    return participant;
  }

  join(incidentId: string, user: User): StoredParticipant {
    const incident = this.get(incidentId);
    if (incident.status === 'ended') throw new IncidentError(409, 'this incident has ended');
    const returning = this.participantForUser(incidentId, user);
    const wasLeft = returning ? returning.leftAt !== null : false;
    const role: Participant['role'] = incident.createdByUserId === user.id ? 'commander' : 'responder';
    const participant = this.addParticipant(incidentId, user, role);
    if (!returning || wasLeft) {
      this.record(incidentId, 'participant-joined', participant.name, `${participant.name} joined the incident`);
    }
    this.publishState(incidentId);
    return participant;
  }

  /**
   * Validate the handshake auth of a socket that wants live incident presence.
   * Returns the composite key parts when the session is genuine.
   */
  resolveSocketAuth(
    auth: Record<string, unknown> | undefined,
  ): { incidentId: string; participantId: string } | null {
    const token = auth?.['session-token'];
    const incidentId = auth?.['incident-id'];
    const participantId = auth?.['participant-id'];
    if (typeof token !== 'string' || typeof incidentId !== 'string' || typeof participantId !== 'string') {
      return null;
    }
    const user = this.userForToken(token);
    if (!user || !this.incidents.has(incidentId)) return null;
    const participant = this.participants.get(this.pkey(incidentId, participantId));
    if (!participant || participant.userId !== user.id) return null;
    return { incidentId, participantId };
  }

  /** True when a frame broadcast genuinely comes from the socket's participant. */
  canBroadcastFrame(
    ctx: { incidentId: string; participantId: string },
    msg: { incidentId?: unknown; participantId?: unknown },
  ): boolean {
    return msg.incidentId === ctx.incidentId && msg.participantId === ctx.participantId;
  }

  /** Resolve the participant record for a user inside one incident, if any. */
  participantForUser(incidentId: string, user: User): StoredParticipant | undefined {
    return [...this.participants.values()].find((p) => p.id.startsWith(`${incidentId}/`) && p.userId === user.id);
  }

  requireParticipant(incidentId: string, user: User): StoredParticipant {
    const participant = this.participantForUser(incidentId, user);
    if (!participant) throw new IncidentError(403, 'join the incident first');
    return participant;
  }

  leave(incidentId: string, participantId: string, explicit: boolean): void {
    const participant = this.participants.get(this.pkey(incidentId, participantId));
    if (!participant) return;
    participant.lastSeenAt = Date.now();
    if (explicit) {
      participant.leftAt = Date.now();
      participant.connected = false;
      this.record(incidentId, 'participant-left', participant.name, `${participant.name} left the incident`);
    }
    this.publishState(incidentId);
  }

  markConnected(incidentId: string, participantId: string, connected: boolean): void {
    const participant = this.participants.get(this.pkey(incidentId, participantId));
    if (!participant || participant.connected === connected) return;
    participant.connected = connected;
    participant.lastSeenAt = Date.now();
    this.record(
      incidentId,
      connected ? 'participant-connected' : 'participant-disconnected',
      participant.name,
      connected
        ? `${participant.name} is connected`
        : `${participant.name} lost connection`,
    );
    this.publishState(incidentId);
  }

  setLocation(incidentId: string, participantId: string, latitude: number, longitude: number): void {
    const participant = this.participants.get(this.pkey(incidentId, participantId));
    if (!participant) return;
    participant.location = { latitude, longitude };
    participant.locationUpdatedAt = Date.now();
    participant.lastSeenAt = Date.now();
    this.publishState(incidentId);
  }

  setVideoOn(incidentId: string, participantId: string, on: boolean): void {
    const participant = this.participants.get(this.pkey(incidentId, participantId));
    if (!participant || participant.videoOn === on) return;
    participant.videoOn = on;
    this.record(
      incidentId,
      'video-state',
      participant.name,
      on ? `${participant.name} started sharing video` : `${participant.name} stopped sharing video`,
    );
    this.publishState(incidentId);
  }

  // --- chat / markers -----------------------------------------------------

  postChat(incidentId: string, participantId: string, textRaw: string, replyToId: string | null): ChatMessage {
    const participant = this.participants.get(this.pkey(incidentId, participantId));
    if (!participant) throw new IncidentError(403, 'join the incident first');
    const text = textRaw.trim();
    if (!text) throw new IncidentError(400, 'message is empty');
    if (this.get(incidentId).status === 'ended') throw new IncidentError(409, 'the incident is closed');
    if (replyToId) {
      const target = this.chat.get(incidentId)?.find((m) => m.id === replyToId);
      if (!target) throw new IncidentError(404, 'the message you reply to no longer exists');
    }
    const message: ChatMessage = {
      id: this.id('msg'),
      incidentId,
      participantId,
      authorName: participant.name,
      text,
      replyToId,
      createdAt: Date.now(),
    };
    this.chat.set(incidentId, [...(this.chat.get(incidentId) ?? []), message]);
    this.record(incidentId, 'chat', participant.name, `${participant.name}: ${text}`, {
      messageId: message.id,
      replyToId,
    });
    this.publish({ topic: `incident/${incidentId}/chat`, payload: message });
    return message;
  }

  chatFor(incidentId: string): ChatMessage[] {
    return [...(this.chat.get(incidentId) ?? [])];
  }

  postMarker(incidentId: string, participantId: string, label: string, latitude: number, longitude: number): MapMarker {
    const participant = this.participants.get(this.pkey(incidentId, participantId));
    if (!participant) throw new IncidentError(403, 'join the incident first');
    if (this.get(incidentId).status === 'ended') throw new IncidentError(409, 'the incident is closed');
    const clean = label.trim();
    if (!clean) throw new IncidentError(400, 'give the observation a label');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new IncidentError(400, 'coordinates are invalid');
    const marker: MapMarker = {
      id: this.id('mark'),
      incidentId,
      participantId,
      authorName: participant.name,
      label: clean,
      latitude,
      longitude,
      createdAt: Date.now(),
    };
    this.markers.set(incidentId, [...(this.markers.get(incidentId) ?? []), marker]);
    this.record(incidentId, 'marker', participant.name, `${participant.name} marked "${clean}" on the map`, {
      markerId: marker.id,
    });
    this.publish({ topic: `incident/${incidentId}/markers`, payload: marker });
    return marker;
  }

  markersFor(incidentId: string): MapMarker[] {
    return [...(this.markers.get(incidentId) ?? [])];
  }

  // --- commands / alerts (audit only) --------------------------------------

  recordCommand(incidentId: string, participantId: string | null, deviceId: string, command: string): void {
    if (!this.incidents.has(incidentId)) return;
    const actor = participantId
      ? (this.participants.get(this.pkey(incidentId, participantId))?.name ?? 'unknown')
      : 'control panel';
    this.record(incidentId, 'command-sent', actor, `${actor} sent ${command} to ${deviceId}`, {
      deviceId,
      command,
    });
  }

  recordAlert(incidentId: string, deviceId: string, message: string, level: string): void {
    if (!this.incidents.has(incidentId)) return;
    this.record(incidentId, 'alert', 'system', `${deviceId}: ${message}`, { level, deviceId });
  }

  /** Simulator alerts land in the timeline of every active incident. */
  recordAlertAll(deviceId: string, message: string, level: string): void {
    for (const incident of this.incidents.values()) {
      if (incident.status === 'active') this.recordAlert(incident.id, deviceId, message, level);
    }
  }

  // --- end + history -------------------------------------------------------

  end(incidentId: string, user: User): StoredIncident {
    const incident = this.get(incidentId);
    if (incident.status === 'ended') throw new IncidentError(409, 'already ended');
    if (incident.createdByUserId !== user.id) throw new IncidentError(403, 'only the commander can end the incident');
    incident.status = 'ended';
    incident.endedAt = Date.now();
    for (const p of this.participants.values()) {
      if (p.id.startsWith(`${incidentId}/`)) {
        p.connected = false;
        p.leftAt = p.leftAt ?? incident.endedAt;
      }
    }
    this.record(incidentId, 'incident-ended', user.name, `Incident ended by ${user.name}`);
    this.publishState(incidentId);
    return incident;
  }

  history(incidentId: string): {
    incident: Incident;
    participants: Participant[];
    events: IncidentEvent[];
    chat: ChatMessage[];
    markers: MapMarker[];
  } {
    const incident = this.get(incidentId);
    return {
      incident: this.publicIncident(incident),
      participants: this.participantsFor(incidentId),
      events: [...(this.events.get(incidentId) ?? [])],
      chat: this.chatFor(incidentId),
      markers: this.markersFor(incidentId),
    };
  }

  eventsFor(incidentId: string): IncidentEvent[] {
    return [...(this.events.get(incidentId) ?? [])];
  }

  // --- internals -----------------------------------------------------------

  private record(
    incidentId: string,
    type: IncidentEventType,
    actor: string,
    summary: string,
    data?: unknown,
  ): void {
    const event: IncidentEvent = {
      id: this.id('evt'),
      incidentId,
      at: Date.now(),
      type,
      actor,
      summary,
      ...(data !== undefined ? { data } : {}),
    };
    this.events.set(incidentId, [...(this.events.get(incidentId) ?? []), event]);
    this.publish({ topic: `incident/${incidentId}/events`, payload: event });
  }

  private publishState(incidentId: string): void {
    this.publish({ topic: `incident/${incidentId}/state`, payload: this.statePayload(incidentId) });
  }
}
