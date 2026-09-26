import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { CLIENT_EVENTS, SIM_EVENTS } from '@cockpit/protocol';
import type { Command, CommandAck, IncidentFrameMessage, PublishMessage } from '@cockpit/protocol';
import type { RetainedStore } from './retained.js';
import type { FaultController } from '../control/faults.js';
import type { IncidentStore } from '../incidents/store.js';

export interface SocketDeps {
  simSharedSecret: string;
  corsOrigin: string[];
  retained: RetainedStore;
  onCommand: (cmd: Command, socket: Socket) => Promise<CommandAck>;
  onSimStatus: (connected: boolean) => void;
  /** Set after construction so the controller can kick sockets through the hub. */
  faults?: () => FaultController | undefined;
  /** Live Incident Response store; optional so plain telemetry sockets still work. */
  incidents?: () => IncidentStore | undefined;
}

export interface SocketHub {
  io: Server;
  publish: (msg: PublishMessage) => void;
  kickClients: () => void;
  kickSimulator: () => void;
}

const INCIDENT_TOPIC = /^incident\/([^/]+)\//;

export function attachSocket(httpServer: HttpServer, deps: SocketDeps): SocketHub {
  const origin = deps.corsOrigin.includes('*') ? '*' : deps.corsOrigin;
  const io = new Server(httpServer, { cors: { origin } });

  const faults = () => deps.faults?.();
  const incidents = () => deps.incidents?.();

  const publish = (msg: PublishMessage) => {
    const f = faults();
    if (f?.shouldDrop(msg.topic)) return;
    if (!msg.topic.endsWith('/alerts')) deps.retained.set(msg.topic, msg.payload);
    const emit = () => io.of('/').to(msg.topic).emit(msg.topic, msg.payload);
    const delay = f?.delayFor() ?? 0;
    if (delay > 0) setTimeout(emit, delay);
    else emit();
  };

  io.of('/').use((_socket, next) => {
    if (faults()?.socketRefused()) return next(new Error('unavailable'));
    next();
  });

  io.of('/').on('connection', (socket) => {
    // Live Incident Response presence: the handshake carries the participant
    // session, so every connect / reconnect / disconnect updates presence for
    // everyone watching the incident.
    const ctx = incidents()?.resolveSocketAuth(socket.handshake.auth ?? {}) ?? null;
    if (ctx) {
      incidents()!.markConnected(ctx.incidentId, ctx.participantId, true);
      socket.on('disconnect', () => {
        incidents()?.markConnected(ctx.incidentId, ctx.participantId, false);
      });
    }

    socket.on(CLIENT_EVENTS.SUBSCRIBE, ({ topic }: { topic: string }) => {
      if (typeof topic !== 'string') return;
      socket.join(topic);
      // Subscribing to any topic of an incident also joins the incident room,
      // which carries participant video frames.
      const m = topic.match(INCIDENT_TOPIC);
      if (m) socket.join(`incident/${m[1]}`);
      const last = deps.retained.get(topic);
      if (last !== undefined) socket.emit(topic, last);
    });

    socket.on(CLIENT_EVENTS.UNSUBSCRIBE, ({ topic }: { topic: string }) => {
      if (typeof topic === 'string') socket.leave(topic);
    });

    socket.on('incident-frame', (msg: IncidentFrameMessage) => {
      if (!ctx || !incidents()?.canBroadcastFrame(ctx, msg)) return;
      if (typeof msg.dataUrl !== 'string' || msg.dataUrl.length > 200_000) return;
      socket.to(`incident/${ctx.incidentId}`).emit('incident-frame', {
        participantId: ctx.participantId,
        dataUrl: msg.dataUrl,
        at: Date.now(),
      });
    });

    socket.on(CLIENT_EVENTS.COMMAND, async (cmd: Command, ack?: (a: CommandAck) => void) => {
      const reply = (a: CommandAck) => ack?.(a);
      if (!cmd || typeof cmd.deviceId !== 'string' || typeof cmd.type !== 'string') {
        return reply({ ok: false, error: 'invalid command' });
      }
      reply(await deps.onCommand(cmd, socket));
    });
  });

  const sim = io.of('/sim');
  sim.use((socket, next) => {
    if (socket.handshake.auth?.secret !== deps.simSharedSecret) return next(new Error('unauthorized'));
    if (faults()?.simRefused()) return next(new Error('unavailable'));
    next();
  });
  sim.on('connection', (socket) => {
    deps.onSimStatus(true);
    socket.on(SIM_EVENTS.PUBLISH, (msg: PublishMessage) => {
      if (msg && typeof msg.topic === 'string') publish(msg);
    });
    socket.on('disconnect', () => deps.onSimStatus(sim.sockets.size > 0));
  });

  return {
    io,
    publish,
    kickClients: () => io.of('/').disconnectSockets(true),
    kickSimulator: () => sim.disconnectSockets(true),
  };
}
