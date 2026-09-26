import { create } from 'zustand';
import type { ChatMessage, Incident, IncidentEvent, MapMarker, Participant } from '@cockpit/protocol';
import type { IncidentStatePayload } from '@cockpit/protocol';

export interface ParticipantFrame {
  dataUrl: string;
  at: number;
}

export interface HistoryPayload {
  incident: Incident;
  participants: Participant[];
  events: IncidentEvent[];
  chat: ChatMessage[];
  markers: MapMarker[];
}

interface IncidentState {
  incident: Incident | null;
  participants: Participant[];
  chat: ChatMessage[];
  markers: MapMarker[];
  events: IncidentEvent[];
  frames: Record<string, ParticipantFrame>;
  applyState: (payload: IncidentStatePayload) => void;
  applyChat: (message: ChatMessage) => void;
  applyMarker: (marker: MapMarker) => void;
  applyEvent: (event: IncidentEvent) => void;
  applyFrame(participantId: string, dataUrl: string, at: number): void;
  seedHistory: (data: HistoryPayload) => void;
  reset: () => void;
}

const MAX_EVENTS = 500;

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = item;
    return next;
  }
  return [...list, item];
}

export const useIncidentStore = create<IncidentState>((set, get) => ({
  incident: null,
  participants: [],
  chat: [],
  markers: [],
  events: [],
  frames: {},

  applyState(payload) {
    set({ incident: payload.incident, participants: payload.participants });
  },

  applyChat(message) {
    set({ chat: upsert(get().chat, message) });
  },

  applyMarker(marker) {
    set({ markers: upsert(get().markers, marker) });
  },

  applyEvent(event) {
    const events = upsert(get().events, event);
    events.sort((a, b) => a.at - b.at);
    set({ events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events });
  },

  applyFrame(participantId, dataUrl, at) {
    set({ frames: { ...get().frames, [participantId]: { dataUrl, at } } });
  },

  seedHistory({ incident, participants, chat, markers, events }) {
    const current = get().incident;
    // A live state payload may already be newer than the history snapshot.
    if (current && current.status !== incident.status) return;
    set({ incident, participants, chat, markers, events: events.slice(-MAX_EVENTS) });
  },

  reset() {
    set({ incident: null, participants: [], chat: [], markers: [], events: [], frames: {} });
  },
}));
