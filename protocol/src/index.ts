export const ORG_ID = 'flytbase';

export type FlightStatus = 'standby' | 'taking_off' | 'in_flight' | 'landing';

export type DroneAttribute =
  | 'heartbeat'
  | 'global_position'
  | 'attitude'
  | 'battery'
  | 'flight_status'
  | 'alerts'
  | 'video';

export type DockAttribute = 'heartbeat' | 'dock';

export type TelemetryAttribute = DroneAttribute | DockAttribute;

export const DRONE_ATTRIBUTES: DroneAttribute[] = [
  'heartbeat',
  'global_position',
  'attitude',
  'battery',
  'flight_status',
  'alerts',
  'video',
];

export const DOCK_ATTRIBUTES: DockAttribute[] = ['heartbeat', 'dock'];

export function topic(orgId: string, deviceId: string, attribute: TelemetryAttribute): string {
  return `${orgId}/${deviceId}/telemetry/${attribute}`;
}

export interface ParsedTopic {
  orgId: string;
  deviceId: string;
  attribute: TelemetryAttribute;
}

export function parseTopic(t: string): ParsedTopic | null {
  const parts = t.split('/');
  if (parts.length !== 4 || parts[2] !== 'telemetry') return null;
  return { orgId: parts[0], deviceId: parts[1], attribute: parts[3] as TelemetryAttribute };
}

export interface HeartbeatPayload {
  connected: boolean;
  system_time: number;
  device_heartbeat_timestamp: number;
}

export interface GlobalPositionPayload {
  position: {
    latitude: number;
    longitude: number;
    height: number;
    elevation: number;
    gps_satellites: number;
  };
  speed: { horizontal: number; vertical: number };
  home_position: { latitude: number; longitude: number; distance: number };
  timestamp: number;
}

export interface AttitudePayload {
  roll: number;
  pitch: number;
  yaw: number;
}

export interface BatteryPayload {
  percent: number;
  voltage: number;
  temperature: number;
  remaining_flight_time: number;
}

export interface FlightStatusPayload {
  flight_status: FlightStatus;
  mode: 'auto' | 'manual';
  in_air: boolean;
  armed: boolean;
}

export interface AlertPayload {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  timestamp: number;
}

export interface VideoPayload {
  enabled: boolean;
  url: string | null;
}

export type DockStatus = 'closed' | 'opening' | 'open' | 'closing';

export interface DockPayload {
  status: DockStatus;
  dock_location: { latitude: number; longitude: number; altitude: number };
  weather: {
    temperature: number;
    humidity: number;
    rainfall: number;
    wind: { speed: number; direction: number };
  };
}

export type CommandType = 'takeoff' | 'land';

export interface Command {
  deviceId: string;
  type: CommandType;
}

export interface CommandAck {
  ok: boolean;
  error?: string;
}

export interface SimControl {
  action: 'start' | 'stop' | 'reset';
  speed?: number;
}

export interface VideoControl {
  action: 'start' | 'stop';
  deviceId?: string;
}

export interface DeviceInfo {
  id: string;
  type: 'drone' | 'dock';
  name: string;
  dockId?: string;
  droneId?: string;
}

export interface DroneSnapshot {
  id: string;
  status: FlightStatus;
  latitude: number;
  longitude: number;
  height: number;
  heading: number;
  battery: number;
}

export interface SimSnapshot {
  running: boolean;
  speed: number;
  tick: number;
  drones: Record<string, DroneSnapshot>;
}

export const DEVICES_TOPIC = 'devices';

export interface AddDroneRequest {
  name?: string;
  latitude?: number;
  longitude?: number;
}

export interface PublishMessage {
  topic: string;
  payload: unknown;
}

export const CLIENT_EVENTS = {
  SUBSCRIBE: 'Subscribe',
  UNSUBSCRIBE: 'Unsubscribe',
  COMMAND: 'command',
} as const;

export const SIM_EVENTS = {
  PUBLISH: 'publish',
} as const;

export type FaultKind =
  | 'socket-kick'
  | 'socket-refuse'
  | 'socket-delay'
  | 'socket-drop'
  | 'sim-offline'
  | 'video-freeze'
  | 'video-stutter'
  | 'video-degrade'
  | 'video-flicker';

export const FAULT_KINDS: FaultKind[] = [
  'socket-kick',
  'socket-refuse',
  'socket-delay',
  'socket-drop',
  'sim-offline',
  'video-freeze',
  'video-stutter',
  'video-degrade',
  'video-flicker',
];

export interface FaultRequest {
  kind: FaultKind;
  /** Video faults only: one drone, or every drone when omitted. */
  deviceId?: string;
  /** How long the fault stays active. Omitted = until cleared (kick is instantaneous). */
  seconds?: number;
  /** socket-delay: milliseconds; socket-drop: percent 0..100; video-flicker: restart period in seconds. */
  value?: number;
}

export interface ActiveFault {
  kind: FaultKind;
  deviceId?: string;
  /** Epoch ms when it clears itself, or null when it stays until cleared. */
  until: number | null;
  value?: number;
}

// ---------------------------------------------------------------------------
// Live Incident Response
// ---------------------------------------------------------------------------

export type IncidentStatus = 'active' | 'ended';

export type ParticipantRole = 'commander' | 'responder';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Participant {
  id: string;
  userId: string;
  name: string;
  role: ParticipantRole;
  joinedAt: number;
  /** Set when the participant explicitly left or the incident ended. */
  leftAt: number | null;
  /** Live socket presence: false while the browser is closed or reconnecting. */
  connected: boolean;
  lastSeenAt: number;
  location: { latitude: number; longitude: number } | null;
  locationUpdatedAt: number | null;
  videoOn: boolean;
}

export interface ChatMessage {
  id: string;
  incidentId: string;
  participantId: string;
  authorName: string;
  text: string;
  replyToId: string | null;
  createdAt: number;
}

export interface MapMarker {
  id: string;
  incidentId: string;
  participantId: string;
  authorName: string;
  label: string;
  latitude: number;
  longitude: number;
  createdAt: number;
}

export type IncidentEventType =
  | 'incident-created'
  | 'incident-ended'
  | 'participant-joined'
  | 'participant-left'
  | 'participant-connected'
  | 'participant-disconnected'
  | 'command-sent'
  | 'alert'
  | 'chat'
  | 'marker'
  | 'location-update'
  | 'video-state';

export interface IncidentEvent {
  id: string;
  incidentId: string;
  at: number;
  type: IncidentEventType;
  actor: string;
  summary: string;
  data?: unknown;
}

export interface Incident {
  id: string;
  title: string;
  kind: string;
  status: IncidentStatus;
  createdByUserId: string;
  createdByName: string;
  createdAt: number;
  endedAt: number | null;
}

/** Secret suffix of the joining link; /join/:token resolves to one incident. */
export interface JoinLink {
  incidentId: string;
  token: string;
}

export interface IncidentStatePayload {
  incident: Incident;
  participants: Participant[];
}

export interface Session {
  token: string;
  user: User;
}

export interface AuthOtpRequest {
  email: string;
}

export interface AuthOtpResponse {
  ok: boolean;
  /** Demo environments have no mail service: the code is returned so the flow stays reproducible. */
  dev_otp?: string;
}

export interface AuthVerifyRequest {
  email: string;
  otp: string;
  name?: string;
}

export interface IncidentCreateRequest {
  title: string;
  kind?: string;
}

export interface IncidentJoinRequest {
  name?: string;
}

export interface ChatPostRequest {
  text: string;
  replyToId?: string | null;
}

export interface MarkerPostRequest {
  label: string;
  latitude: number;
  longitude: number;
}

export interface LocationPostRequest {
  latitude: number;
  longitude: number;
}

export interface ParticipantVideoRequest {
  on: boolean;
}

/** Client → server broadcast of one participant video frame (JPEG data URL). */
export interface IncidentFrameMessage {
  incidentId: string;
  participantId: string;
  dataUrl: string;
  at: number;
}
